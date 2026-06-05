---
name: ANPR OCR per-camera quality diagnosis
description: How to read ai-worker logs to tell WHY one camera's OCR is bad while another is fine (angle vs OSD overlay vs plate size)
---

When one ANPR camera reads plates badly but another reads fine, the cause is almost always physical/camera-config, not the OCR code. Diagnose from the per-camera ai-worker logs (`[camera_id] YOLO box=... → N OCR candidate(s)` + `OCR raw=...`):

- **Full-width box at top of frame** e.g. `YOLO box=(0,0,~1378,~224)` reading long digit strings like `9520260P17550257` → YOLO is detecting the camera's **burned-in OSD overlay** (date/time/name banner) and OCR reads the clock as a fake plate. These appear when no car is present (sparse, every 30-90s).
  - **Fix:** disable OSD in the camera web UI (Configuration → Image/OSD → uncheck Display Name + Display Date).
- **Many boxes REJECTED for near-square/vertical aspect** (e.g. `aspect=0.88<1.50`, boxes clustered like (1392,492,1595,723)) → the plate is seen at a strong **oblique angle** (camera not pointed head-on); skewed plates → garbage OCR.
  - **Fix:** re-aim/zoom the camera so plates are framed wide and head-on at the stop point.
- **Tight wide box, stable reads** (e.g. Бариера механа: box always wide, consistently `CB2760P`/`CB2780P`) = healthy. Use the good camera as the reference for angle/mounting on the bad one.
- **Small box (~77px wide)** → too few pixels/char (~11px; Tesseract wants ~20). Means plate too far/small → zoom or move closer.

**Why:** Tesseract `conf` is almost always 0.0 even on clean reads (known quirk) — do NOT use it as a quality signal; the gate relies on plausibility + backend fuzzy match. So OCR garbage can still open the gate for permanent-access vehicles; the "bad reading" mainly hurts reservation/unknown matching + history display.

**How to apply:** never edit OCR/YOLO/capture code for this (project constraint) — all fixes are camera physical aim, zoom, focus, lighting, and OSD settings. Snapshot is pulled from Hikvision main stream `/ISAPI/Streaming/channels/{ch}01/picture`, so stream resolution is set on the camera itself.

**Per-camera on-demand diagnostic (no disruption, no file edits):** `/tmp/crop.jpg` + `/tmp/processed.jpg` are shared/overwritten by ALL cameras (busiest wins), so they can't isolate one camera. Instead:
1. Grab the exact current frame from one camera by ID: `docker compose exec -T ai-worker python -c "import os,requests; r=requests.get('http://backend:8080/api/anpr/snapshot/<CAM_ID>', headers={'Authorization':'Bearer '+os.environ['ANPR_WORKER_TOKEN']}, timeout=10); open('/tmp/x.jpg','wb').write(r.content); print(r.status_code,len(r.content))"`. Backend is NOT host-published (only via nginx frontend:3000 → /api); easiest from inside ai-worker which has the token env + network.
2. Re-run the REAL pipeline on that frame: `docker compose exec -T ai-worker python -c "import worker; d=open('/tmp/x.jpg','rb').read(); print(worker.ocr_plate(d,camera_id='TEST'))"`. Importing `worker` does NOT run main() (guarded by `__main__`) but loads the YOLO model + reuses `ocr_plate`, which writes `/tmp/crop.jpg`+`/tmp/processed.jpg` for that frame. Reuses real logic — no reimplementation, no code change.

**Wide-angle/fisheye surveillance cams are bad for ANPR:** a camera covering a whole courtyard puts the plate small + barrel-distorted + off-center → OCR drops/mangles edge chars (CB2780PO → B7180). Crop-shrink (ANPR_CROP_SHRINK_X~0.12 each side) can clip the first/last char on a tilted small plate. Fix physically: zoom/narrow FOV so the plate is large, head-on, and centered (least distortion) at the stop point — match the working camera.
