"""
ANPR ai-worker — V1 snapshot-polling pipeline.

Loop:
  1. Refresh target list from GET /api/anpr/targets every N seconds.
  2. For each enabled camera, run a per-camera polling task:
       fetch snapshot (base64 data URL)
       run EasyOCR
       pick best plate candidate
       if confidence >= camera.ocr_min_confidence:
           local debounce check (camera_id + plate, cooldown window)
           POST /api/anpr/detection
       discard snapshot bytes either way
  3. Snapshots are NEVER written to disk. Nothing is archived.

Resilient to:
  - api-server restarts (retries on next tick)
  - camera offline (logged, next tick continues)
  - OCR engine load failure (worker exits with non-zero so container restarts)

V1 is intentionally minimal. No async/threading complexity — one sync polling
loop per camera, scheduled by a single dispatcher. Cameras are usually <10
per site at this stage; if scale grows, swap dispatcher for asyncio.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import re
import sys
import threading
import time
from dataclasses import dataclass
from typing import Optional

import requests
from PIL import Image
import numpy as np

# ─── Config ────────────────────────────────────────────────────────────────────

API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8080").rstrip("/")
ANPR_WORKER_TOKEN = os.environ.get("ANPR_WORKER_TOKEN", "")
REFRESH_TARGETS_SECONDS = int(os.environ.get("ANPR_REFRESH_TARGETS_SECONDS", "30"))
LANGUAGES = [s.strip() for s in os.environ.get("ANPR_LANGUAGES", "en").split(",") if s.strip()]
HTTP_TIMEOUT = float(os.environ.get("ANPR_HTTP_TIMEOUT", "5"))

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("anpr-worker")

if not ANPR_WORKER_TOKEN:
    log.error("ANPR_WORKER_TOKEN env var is required")
    sys.exit(1)

# ─── OCR engine (loaded once) ──────────────────────────────────────────────────

log.info("Loading EasyOCR (languages=%s) — this can take 30s on first run...", LANGUAGES)
try:
    import easyocr  # heavy import; only here
    READER = easyocr.Reader(LANGUAGES, gpu=False, verbose=False)
    log.info("EasyOCR ready")
except Exception as e:
    log.error("Failed to load EasyOCR: %s", e)
    sys.exit(2)

# ─── Plate normalisation ───────────────────────────────────────────────────────

_PLATE_CLEAN_RE = re.compile(r"[^A-Z0-9]")


def normalise_plate(raw: str) -> str:
    return _PLATE_CLEAN_RE.sub("", raw.upper())


def is_plausible_plate(p: str) -> bool:
    # Real-world plates are 4–10 alphanumerics and contain at least one digit
    # AND at least one letter. Tighten per-region later.
    return 4 <= len(p) <= 10 and any(c.isdigit() for c in p) and any(c.isalpha() for c in p)


# ─── API client ────────────────────────────────────────────────────────────────

_session = requests.Session()
_session.headers.update({"Authorization": f"Bearer {ANPR_WORKER_TOKEN}"})


def fetch_targets() -> list[dict]:
    r = _session.get(f"{API_BASE_URL}/api/anpr/targets", timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    return r.json().get("cameras", [])


def fetch_snapshot(camera_id: str) -> Optional[bytes]:
    try:
        r = _session.get(
            f"{API_BASE_URL}/api/anpr/snapshot/{camera_id}",
            timeout=HTTP_TIMEOUT + 5,  # snapshot fetch can be slower
        )
        if r.status_code != 200:
            log.warning("snapshot %s → HTTP %s", camera_id, r.status_code)
            return None
        data_url = r.json().get("snapshot_base64", "")
        if "," not in data_url:
            return None
        return base64.b64decode(data_url.split(",", 1)[1])
    except Exception as e:
        log.warning("snapshot %s failed: %s", camera_id, e)
        return None


def post_detection(payload: dict) -> None:
    try:
        r = _session.post(
            f"{API_BASE_URL}/api/anpr/detection",
            json=payload,
            timeout=HTTP_TIMEOUT,
        )
        if r.status_code >= 300:
            log.warning("detection POST → HTTP %s: %s", r.status_code, r.text[:200])
        else:
            body = r.json()
            log.info(
                "detection camera=%s plate=%s → %s (%s)",
                payload["camera_id"], payload["plate"],
                body.get("action"), body.get("reason") or "",
            )
    except Exception as e:
        log.warning("detection POST failed: %s", e)


# ─── OCR ───────────────────────────────────────────────────────────────────────

def ocr_plate(jpeg_bytes: bytes) -> Optional[tuple[str, float, str]]:
    """
    Returns (normalised_plate, confidence_0_100, raw_text) or None.
    """
    try:
        img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        arr = np.asarray(img)
    except Exception as e:
        log.warning("image decode failed: %s", e)
        return None

    try:
        # readtext → [(bbox, text, prob), ...]
        results = READER.readtext(arr, detail=1, paragraph=False)
    except Exception as e:
        log.warning("OCR failed: %s", e)
        return None

    best: Optional[tuple[str, float, str]] = None
    for _bbox, text, prob in results:
        norm = normalise_plate(text)
        if not is_plausible_plate(norm):
            continue
        conf = float(prob) * 100.0
        if best is None or conf > best[1]:
            best = (norm, conf, text)
    return best


# ─── Per-camera polling task ───────────────────────────────────────────────────

@dataclass
class CameraState:
    id: str
    name: str
    polling_interval_ms: int
    ocr_min_confidence: int
    cooldown_seconds: int
    # local debounce
    last_plate: Optional[str] = None
    last_plate_at: float = 0.0
    # task control
    stop: threading.Event = None  # type: ignore[assignment]
    thread: Optional[threading.Thread] = None


def camera_loop(state: CameraState) -> None:
    log.info("[%s] polling started (interval=%dms, min_conf=%d)",
             state.name, state.polling_interval_ms, state.ocr_min_confidence)
    interval = max(0.5, state.polling_interval_ms / 1000.0)
    while not state.stop.is_set():
        t0 = time.time()
        try:
            jpeg = fetch_snapshot(state.id)
            if jpeg is not None:
                hit = ocr_plate(jpeg)
                if hit is not None:
                    plate, conf, raw = hit
                    if conf >= state.ocr_min_confidence:
                        now = time.time()
                        # Local debounce — server has its own too.
                        if state.last_plate == plate and (now - state.last_plate_at) < state.cooldown_seconds:
                            pass  # skip
                        else:
                            state.last_plate = plate
                            state.last_plate_at = now
                            post_detection({
                                "camera_id": state.id,
                                "plate": plate,
                                "confidence": round(conf, 2),
                                "raw_ocr_text": raw,
                            })
                # jpeg goes out of scope here → GC'd
        except Exception as e:
            log.warning("[%s] loop error: %s", state.name, e)

        elapsed = time.time() - t0
        sleep_for = max(0.0, interval - elapsed)
        if state.stop.wait(sleep_for):
            break
    log.info("[%s] polling stopped", state.name)


# ─── Dispatcher: keep one task per enabled camera ─────────────────────────────

def main() -> None:
    log.info("ANPR worker starting · api=%s · refresh=%ds", API_BASE_URL, REFRESH_TARGETS_SECONDS)
    tasks: dict[str, CameraState] = {}

    while True:
        try:
            targets = fetch_targets()
            target_ids = {t["id"] for t in targets}

            # Stop tasks that are no longer enabled
            for cid in list(tasks.keys()):
                if cid not in target_ids:
                    log.info("camera %s removed from target list — stopping", cid)
                    tasks[cid].stop.set()
                    if tasks[cid].thread is not None:
                        tasks[cid].thread.join(timeout=2)
                    del tasks[cid]

            # Start tasks for newly enabled, refresh config for existing
            for t in targets:
                cid = t["id"]
                if cid in tasks:
                    s = tasks[cid]
                    s.polling_interval_ms = int(t.get("polling_interval_ms") or 1500)
                    s.ocr_min_confidence = int(t.get("ocr_min_confidence") or 70)
                    s.cooldown_seconds = int(t.get("anpr_cooldown_seconds") or 30)
                    s.name = t.get("name") or cid
                    continue
                state = CameraState(
                    id=cid,
                    name=t.get("name") or cid,
                    polling_interval_ms=int(t.get("polling_interval_ms") or 1500),
                    ocr_min_confidence=int(t.get("ocr_min_confidence") or 70),
                    cooldown_seconds=int(t.get("anpr_cooldown_seconds") or 30),
                    stop=threading.Event(),
                )
                state.thread = threading.Thread(
                    target=camera_loop, args=(state,), name=f"cam-{cid[:8]}", daemon=True,
                )
                state.thread.start()
                tasks[cid] = state

        except Exception as e:
            log.warning("target refresh failed: %s", e)

        time.sleep(REFRESH_TARGETS_SECONDS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("interrupted")
        sys.exit(0)
