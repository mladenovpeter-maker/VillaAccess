"""
ANPR ai-worker — YOLOv8 plate detector + PaddleOCR recognizer (CPU, offline).

Loop (unchanged from V1):
  1. Refresh target list from GET /api/anpr/targets every N seconds.
  2. For each enabled camera, run a per-camera polling task:
       fetch snapshot (raw JPEG bytes from /api/anpr/snapshot/:id)
       run YOLOv8 plate detection → crop plate region(s)
       preprocess crop (grayscale, upscale, CLAHE, sharpen)
       run PaddleOCR on each cropped plate only
       pick best plausible plate candidate
       if confidence >= camera.ocr_min_confidence:
           local debounce check (camera_id + plate, cooldown window)
           POST /api/anpr/detection
       discard snapshot bytes either way
  3. Snapshots are NEVER written to disk.

Resilient to:
  - api-server restarts (retries on next tick)
  - camera offline (logged, next tick continues)
  - model load failure (worker exits non-zero so container restarts)
"""

from __future__ import annotations

import base64
import logging
import os
import re
import sys
import threading
import time
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np
import requests

# ─── Config ────────────────────────────────────────────────────────────────────

API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:8080").rstrip("/")
ANPR_WORKER_TOKEN = os.environ.get("ANPR_WORKER_TOKEN", "")
REFRESH_TARGETS_SECONDS = int(os.environ.get("ANPR_REFRESH_TARGETS_SECONDS", "30"))
HTTP_TIMEOUT = float(os.environ.get("ANPR_HTTP_TIMEOUT", "5"))

YOLO_PLATE_WEIGHTS = os.environ.get(
    "YOLO_PLATE_WEIGHTS", "/app/models/license_plate_detector.pt"
)
YOLO_CONF = float(os.environ.get("YOLO_CONF", "0.25"))
PADDLE_LANG = os.environ.get("ANPR_PADDLE_LANG", "en")

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("anpr-worker")

if not ANPR_WORKER_TOKEN:
    log.error("ANPR_WORKER_TOKEN env var is required")
    sys.exit(1)

# ─── Models (loaded once) ──────────────────────────────────────────────────────

log.info("Loading YOLOv8 plate detector from %s ...", YOLO_PLATE_WEIGHTS)
try:
    from ultralytics import YOLO  # heavy import
    DETECTOR = YOLO(YOLO_PLATE_WEIGHTS)
    log.info("YOLOv8 detector ready")
except Exception as e:
    log.error("Failed to load YOLOv8 detector: %s", e)
    sys.exit(2)

log.info("Loading PaddleOCR (lang=%s, CPU) ...", PADDLE_LANG)
try:
    from paddleocr import PaddleOCR  # heavy import
    OCR = PaddleOCR(
        lang=PADDLE_LANG,
        use_angle_cls=False,
        show_log=False,
        use_gpu=False,
    )
    log.info("PaddleOCR ready")
except Exception as e:
    log.error("Failed to load PaddleOCR: %s", e)
    sys.exit(2)

# ─── Plate normalisation ───────────────────────────────────────────────────────

_PLATE_CLEAN_RE = re.compile(r"[^A-Z0-9]")


def normalise_plate(raw: str) -> str:
    return _PLATE_CLEAN_RE.sub("", raw.upper())


def is_plausible_plate(p: str) -> bool:
    # Real-world plates are 4–10 alphanumerics and contain at least one digit
    # AND at least one letter.
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
            timeout=HTTP_TIMEOUT + 5,
        )
        if r.status_code != 200:
            log.warning("snapshot %s → HTTP %s", camera_id, r.status_code)
            return None
        ct = r.headers.get("Content-Type", "")
        if ct.startswith("image/"):
            return r.content
        # Backwards-compat: older backend returned JSON with data URL.
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


# ─── OCR pipeline ──────────────────────────────────────────────────────────────

def _preprocess_plate_crop(bgr: np.ndarray) -> np.ndarray:
    """Grayscale → upscale → CLAHE → unsharp; return 3-channel for PaddleOCR."""
    h, w = bgr.shape[:2]
    if h == 0 or w == 0:
        return bgr
    target_h = 96
    if h < target_h:
        scale = target_h / float(h)
        bgr = cv2.resize(
            bgr, (max(1, int(w * scale)), target_h), interpolation=cv2.INTER_CUBIC
        )
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    blurred = cv2.GaussianBlur(gray, (0, 0), sigmaX=1.0)
    sharp = cv2.addWeighted(gray, 1.6, blurred, -0.6, 0)
    return cv2.cvtColor(sharp, cv2.COLOR_GRAY2BGR)


def _run_paddle_ocr(crop_bgr: np.ndarray) -> list[tuple[str, float]]:
    """Return list of (text, prob_0_1) from PaddleOCR on the given crop."""
    try:
        result = OCR.ocr(crop_bgr, cls=False)
    except Exception as e:
        log.warning("PaddleOCR failed: %s", e)
        return []
    out: list[tuple[str, float]] = []
    for page in (result or []):
        if not page:
            continue
        for entry in page:
            try:
                text = str(entry[1][0])
                prob = float(entry[1][1])
            except Exception:
                continue
            out.append((text, prob))
    return out


def ocr_plate(jpeg_bytes: bytes) -> Optional[tuple[str, float, str]]:
    """
    YOLOv8 detect → crop → preprocess → PaddleOCR.
    Returns (normalised_plate, confidence_0_100, raw_text) or None.
    """
    try:
        arr = np.frombuffer(jpeg_bytes, dtype=np.uint8)
        bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if bgr is None:
            log.warning("image decode failed (empty buffer)")
            return None
    except Exception as e:
        log.warning("image decode failed: %s", e)
        return None

    try:
        det = DETECTOR.predict(bgr, conf=YOLO_CONF, verbose=False)
    except Exception as e:
        log.warning("YOLO detect failed: %s", e)
        return None

    H, W = bgr.shape[:2]
    best: Optional[tuple[str, float, str]] = None

    for r in det:
        boxes = getattr(r, "boxes", None)
        if boxes is None:
            continue
        for box in boxes:
            try:
                x1, y1, x2, y2 = [int(v) for v in box.xyxy[0].tolist()]
            except Exception:
                continue
            # small padding helps recognition on tight crops
            pad_x = max(2, (x2 - x1) // 20)
            pad_y = max(2, (y2 - y1) // 10)
            x1 = max(0, x1 - pad_x); y1 = max(0, y1 - pad_y)
            x2 = min(W, x2 + pad_x); y2 = min(H, y2 + pad_y)
            if x2 <= x1 or y2 <= y1:
                continue
            crop = bgr[y1:y2, x1:x2]
            prepped = _preprocess_plate_crop(crop)
            for text, prob in _run_paddle_ocr(prepped):
                norm = normalise_plate(text)
                if not is_plausible_plate(norm):
                    continue
                conf = prob * 100.0
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
    last_plate: Optional[str] = None
    last_plate_at: float = 0.0
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

            for cid in list(tasks.keys()):
                if cid not in target_ids:
                    log.info("camera %s removed from target list — stopping", cid)
                    tasks[cid].stop.set()
                    if tasks[cid].thread is not None:
                        tasks[cid].thread.join(timeout=2)
                    del tasks[cid]

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
