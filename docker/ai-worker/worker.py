"""
ANPR ai-worker — YOLOv8 plate detector + Tesseract OCR recognizer (CPU).

Loop (unchanged from V1):
  1. Refresh target list from GET /api/anpr/targets every N seconds.
  2. For each enabled camera, run a per-camera polling task:
       fetch snapshot (raw JPEG bytes from /api/anpr/snapshot/:id)
       run YOLOv8 plate detection → crop plate region(s)
       preprocess crop (grayscale, upscale, CLAHE, sharpen, threshold)
       run Tesseract OCR on each cropped plate only
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
# Shrink the YOLO bounding box inward before OCR so Tesseract only sees the
# actual plate characters, not the surrounding bumper/frame text. Values are
# fractions of the YOLO box width / height removed from EACH side.
#   x = 0.12 → keep middle 76 % horizontally
#   y = 0.20 → keep middle 60 % vertically (more aggressive — strips top and
#              bottom country/dealer bands)
ANPR_CROP_SHRINK_X = float(os.environ.get("ANPR_CROP_SHRINK_X", "0.12"))
ANPR_CROP_SHRINK_Y = float(os.environ.get("ANPR_CROP_SHRINK_Y", "0.20"))
# Gentle preprocessing knobs. Defaults chosen to preserve grayscale edges
# and avoid over-binarisation that was killing Tesseract recall.
ANPR_OCR_UPSCALE = float(os.environ.get("ANPR_OCR_UPSCALE", "2.0"))
ANPR_OCR_THRESH_BLOCK = int(os.environ.get("ANPR_OCR_THRESH_BLOCK", "25"))
ANPR_OCR_THRESH_C = int(os.environ.get("ANPR_OCR_THRESH_C", "10"))
ANPR_DEBUG_DIR = os.environ.get("ANPR_DEBUG_DIR", "").strip()  # e.g. /tmp/anpr_debug
TESSERACT_LANG = os.environ.get("TESSERACT_LANG", "eng")
# Plates are a single word/token, not a sentence line, so PSM 8 ("treat the
# image as a single word") usually beats PSM 7. Flip to "13" (raw line, no
# layout analysis) without a rebuild if PSM 8 is still weak.
TESSERACT_PSM = os.environ.get("TESSERACT_PSM", "8")
TESSERACT_WHITELIST = os.environ.get(
    # Bulgarian plates use only the 13 Latin glyphs that match Cyrillic shapes
    # (А В С Е К М Н О Р Т У Х) plus digits. Narrowing the whitelist this hard
    # drops most of Tesseract's wrong-letter guesses (D, G, S, Z, …).
    "TESSERACT_WHITELIST", "ABCEKMHOPCTYX0123456789"
)
# Single text line (PSM 7), LSTM engine (OEM 1).
TESSERACT_CONFIG = (
    f"--oem 1 --psm {TESSERACT_PSM} "
    f"-c tessedit_char_whitelist={TESSERACT_WHITELIST}"
)

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("anpr-worker")

if not ANPR_WORKER_TOKEN:
    log.error("ANPR_WORKER_TOKEN env var is required")
    sys.exit(1)

if ANPR_DEBUG_DIR:
    try:
        os.makedirs(ANPR_DEBUG_DIR, exist_ok=True)
        log.info("ANPR debug crops will be written to %s", ANPR_DEBUG_DIR)
    except Exception as e:
        log.warning("could not create ANPR_DEBUG_DIR=%s: %s", ANPR_DEBUG_DIR, e)
        ANPR_DEBUG_DIR = ""

# ─── Models (loaded once) ──────────────────────────────────────────────────────

log.info("Loading YOLOv8 plate detector from %s ...", YOLO_PLATE_WEIGHTS)
try:
    from ultralytics import YOLO  # heavy import
    DETECTOR = YOLO(YOLO_PLATE_WEIGHTS)
    log.info("YOLOv8 detector ready")
except Exception as e:
    log.error("Failed to load YOLOv8 detector: %s", e)
    sys.exit(2)

log.info("Initialising Tesseract OCR (lang=%s, psm=%s) ...", TESSERACT_LANG, TESSERACT_PSM)
try:
    import pytesseract  # thin wrapper around the tesseract binary
    tess_version = pytesseract.get_tesseract_version()
    log.info("Tesseract OCR ready (version=%s)", tess_version)
except Exception as e:
    log.error("Failed to initialise Tesseract OCR: %s", e)
    sys.exit(2)

# ─── Plate normalisation ───────────────────────────────────────────────────────

# Keep only characters that are valid on a Bulgarian-style plate.
_PLATE_ALLOWED_CHARS = set("ABCEKMHOPCTYX0123456789")
_PLATE_CLEAN_RE = re.compile(
    r"[^" + re.escape("".join(sorted(_PLATE_ALLOWED_CHARS))) + r"]"
)


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

def _shrink_box(x1: int, y1: int, x2: int, y2: int, W: int, H: int) -> tuple[int, int, int, int]:
    """Shrink a YOLO bounding box inward by ANPR_CROP_SHRINK_{X,Y}.

    Returns the shrunken (x1, y1, x2, y2) clipped to image bounds. If the
    shrink would collapse the box, falls back to the original.
    """
    bw = max(1, x2 - x1)
    bh = max(1, y2 - y1)
    dx = int(bw * ANPR_CROP_SHRINK_X)
    dy = int(bh * ANPR_CROP_SHRINK_Y)
    nx1 = max(0, x1 + dx)
    ny1 = max(0, y1 + dy)
    nx2 = min(W, x2 - dx)
    ny2 = min(H, y2 - dy)
    if nx2 - nx1 < 8 or ny2 - ny1 < 8:
        return x1, y1, x2, y2
    return nx1, ny1, nx2, ny2


def _preprocess_plate_crop(bgr: np.ndarray) -> np.ndarray:
    """Minimal, edge-preserving preprocessing for Tesseract.

    Pipeline (gentle on purpose — heavy thresholding/morphology was destroying
    character readability and producing 0 OCR candidates):
      1. grayscale
      2. 2× INTER_CUBIC upscale
      3. mild bilateral filter (preserves edges, removes noise)
      4. light adaptive Gaussian threshold (blockSize=25, C=10)
      5. polarity flip so glyphs are dark on light background

    No erosion, no dilation, no sharpening, no global Otsu.
    """
    h, w = bgr.shape[:2]
    if h == 0 or w == 0:
        return bgr
    # 1. Grayscale.
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    # 2. Mild upscale.
    upscaled = cv2.resize(
        gray, None, fx=ANPR_OCR_UPSCALE, fy=ANPR_OCR_UPSCALE,
        interpolation=cv2.INTER_CUBIC,
    )
    # 3. Edge-preserving denoise.
    denoised = cv2.bilateralFilter(upscaled, d=7, sigmaColor=50, sigmaSpace=50)
    # 4. Light adaptive threshold (must be odd, >= 3).
    block = ANPR_OCR_THRESH_BLOCK if ANPR_OCR_THRESH_BLOCK % 2 == 1 else ANPR_OCR_THRESH_BLOCK + 1
    block = max(3, block)
    binar = cv2.adaptiveThreshold(
        denoised,
        maxValue=255,
        adaptiveMethod=cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        thresholdType=cv2.THRESH_BINARY,
        blockSize=block,
        C=ANPR_OCR_THRESH_C,
    )
    # 5. Ensure dark text on light background for Tesseract.
    if np.mean(binar) < 127:
        binar = cv2.bitwise_not(binar)
    return binar


_debug_seq = 0


def _save_debug_crop(camera_id: str, raw_bgr: np.ndarray, prepped: np.ndarray) -> None:
    """Write the raw YOLO crop and the preprocessed crop.

    Always overwrites /tmp/crop.jpg and /tmp/processed.jpg with the latest
    detection attempt so an operator can `scp` / `docker cp` them off the
    ai-worker container for visual inspection. If ANPR_DEBUG_DIR is set,
    also dumps timestamped PNG history there.
    """
    # Always-on latest-frame snapshots.
    try:
        cv2.imwrite("/tmp/crop.jpg", raw_bgr)
        cv2.imwrite("/tmp/processed.jpg", prepped)
    except Exception as e:
        log.warning("latest-frame debug save failed: %s", e)

    if not ANPR_DEBUG_DIR:
        return
    global _debug_seq
    _debug_seq += 1
    ts = time.strftime("%Y%m%d-%H%M%S")
    prefix = f"{ts}_{camera_id[:8]}_{_debug_seq:04d}"
    try:
        cv2.imwrite(os.path.join(ANPR_DEBUG_DIR, f"{prefix}_raw.png"), raw_bgr)
        cv2.imwrite(os.path.join(ANPR_DEBUG_DIR, f"{prefix}_prepped.png"), prepped)
    except Exception as e:
        log.warning("debug crop save failed: %s", e)


def _run_tesseract_ocr(crop: np.ndarray) -> list[tuple[str, float]]:
    """Return list of (text, prob_0_1) from Tesseract on the given crop."""
    try:
        data = pytesseract.image_to_data(
            crop,
            lang=TESSERACT_LANG,
            config=TESSERACT_CONFIG,
            output_type=pytesseract.Output.DICT,
        )
    except Exception as e:
        log.warning("Tesseract OCR failed: %s", e)
        return []
    out: list[tuple[str, float]] = []
    texts = data.get("text", [])
    confs = data.get("conf", [])
    for text, conf in zip(texts, confs):
        text = (text or "").strip()
        if not text:
            continue
        try:
            c = float(conf)
        except (TypeError, ValueError):
            continue
        if c < 0:  # tesseract uses -1 for words it couldn't score
            continue
        out.append((text, c / 100.0))
    return out


def ocr_plate(jpeg_bytes: bytes, camera_id: str = "unknown") -> Optional[tuple[str, float, str]]:
    """
    YOLOv8 detect → crop → preprocess → Tesseract OCR.
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
                rx1, ry1, rx2, ry2 = [int(v) for v in box.xyxy[0].tolist()]
                det_conf = float(box.conf[0].item()) if hasattr(box, "conf") else -1.0
            except Exception:
                continue
            # Shrink the YOLO box inward so Tesseract only sees the plate
            # characters (not bumper/frame text on either side or country
            # bands above/below).
            x1, y1, x2, y2 = _shrink_box(rx1, ry1, rx2, ry2, W, H)
            if x2 <= x1 or y2 <= y1:
                continue
            crop = bgr[y1:y2, x1:x2]
            prepped = _preprocess_plate_crop(crop)
            _save_debug_crop(camera_id, crop, prepped)
            candidates = _run_tesseract_ocr(prepped)
            log.info(
                "[%s] YOLO box=(%d,%d,%d,%d) shrunk=(%d,%d,%d,%d) det_conf=%.2f → %d OCR candidate(s)",
                camera_id, rx1, ry1, rx2, ry2, x1, y1, x2, y2, det_conf, len(candidates),
            )
            for text, prob in candidates:
                norm = normalise_plate(text)
                plausible = is_plausible_plate(norm)
                log.info(
                    "[%s] OCR raw=%r normalised=%r conf=%.1f plausible=%s",
                    camera_id, text, norm, prob * 100.0, plausible,
                )
                if not plausible:
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
                hit = ocr_plate(jpeg, camera_id=state.id)
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
