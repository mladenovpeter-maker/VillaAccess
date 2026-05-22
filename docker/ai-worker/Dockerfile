# ANPR ai-worker — YOLOv8 plate detector + Tesseract OCR recognizer (CPU).
#
# Pipeline:
#   snapshot bytes → YOLOv8 plate detection → crop → preprocess → Tesseract
#
# Required env:
#   API_BASE_URL          e.g. http://api-server:8080
#   ANPR_WORKER_TOKEN     shared secret (must match api-server)
# Optional:
#   ANPR_REFRESH_TARGETS_SECONDS  default 30
#   YOLO_PLATE_WEIGHTS            default /app/models/license_plate_detector.pt
#   YOLO_CONF                     default 0.25
#   TESSERACT_PSM                 default 7 (single-line text)
#   TESSERACT_LANG                default "eng" (Bulgarian/EU plates use Latin glyphs)
#
# YOLO weights are baked into the image; tesseract eng traineddata ships with
# the tesseract-ocr-eng apt package — fully offline at runtime.

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1 \
    curl \
    ca-certificates \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

COPY docker/ai-worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# --- Pre-download YOLOv8 plate detector weights (small, ~6 MB) --------------
# Override via --build-arg if you host the weights internally.
ARG YOLO_PLATE_WEIGHTS_URL=https://github.com/Muhammad-Zeerak-Khan/Automatic-License-Plate-Recognition-using-YOLOv8/raw/main/license_plate_detector.pt
RUN mkdir -p /app/models && \
    curl -fsSL "$YOLO_PLATE_WEIGHTS_URL" -o /app/models/license_plate_detector.pt && \
    test -s /app/models/license_plate_detector.pt

COPY docker/ai-worker/worker.py ./worker.py

ENV PYTHONUNBUFFERED=1 \
    YOLO_PLATE_WEIGHTS=/app/models/license_plate_detector.pt

CMD ["python", "-u", "worker.py"]
