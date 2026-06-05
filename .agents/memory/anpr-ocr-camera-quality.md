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
