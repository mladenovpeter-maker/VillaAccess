# ANPR ai-worker — YOLOv8 plate detector + PaddleOCR recognizer (CPU, offline).
#
# Pipeline:
#   snapshot bytes → YOLOv8 plate detection → crop → preprocess → PaddleOCR
#
# Required env:
#   API_BASE_URL          e.g. http://api-server:8080
#   ANPR_WORKER_TOKEN     shared secret (must match api-server)
# Optional:
#   ANPR_REFRESH_TARGETS_SECONDS  default 30
#   ANPR_PADDLE_LANG              default "en" (Bulgarian plates use Latin)
#   YOLO_PLATE_WEIGHTS            default /app/models/license_plate_detector.pt
#   YOLO_CONF                     default 0.25
#
# Models are baked into the image at build time so the container needs no
# outbound network for inference (only to talk to the api-server).

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
    && rm -rf /var/lib/apt/lists/*

COPY docker/ai-worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# --- Pre-download models so runtime is offline -------------------------------
# YOLOv8 plate detector weights (small, ~6 MB). Override via --build-arg if you
# host the weights internally.
ARG YOLO_PLATE_WEIGHTS_URL=https://github.com/Muhammad-Zeerak-Khan/Automatic-License-Plate-Recognition-using-YOLOv8/raw/main/license_plate_detector.pt
RUN mkdir -p /app/models && \
    curl -fsSL "$YOLO_PLATE_WEIGHTS_URL" -o /app/models/license_plate_detector.pt && \
    test -s /app/models/license_plate_detector.pt

# Warm PaddleOCR so its detection + recognition models are cached in the image.
RUN python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='en', use_angle_cls=False, show_log=False)"

COPY docker/ai-worker/worker.py ./worker.py

ENV PYTHONUNBUFFERED=1 \
    YOLO_PLATE_WEIGHTS=/app/models/license_plate_detector.pt

CMD ["python", "-u", "worker.py"]
