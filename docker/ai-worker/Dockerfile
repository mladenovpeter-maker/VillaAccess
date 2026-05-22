# ANPR ai-worker — V1 (snapshot polling + EasyOCR).
#
# Polls cameras with ocr_enabled=true via the api-server, runs OCR on each
# snapshot, and POSTs valid plate detections back. Snapshots are processed
# in-memory and discarded; nothing is written to disk.
#
# Required env:
#   API_BASE_URL          e.g. http://api-server:8080
#   ANPR_WORKER_TOKEN     shared secret (must match api-server)
# Optional:
#   ANPR_REFRESH_TARGETS_SECONDS  default 30
#   ANPR_LANGUAGES                default "en"

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    libgl1-mesa-glx \
    && rm -rf /var/lib/apt/lists/*

COPY docker/ai-worker/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY docker/ai-worker/worker.py ./worker.py

ENV PYTHONUNBUFFERED=1

CMD ["python", "-u", "worker.py"]
