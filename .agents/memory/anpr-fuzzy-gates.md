---
name: ANPR fuzzy/partial match gates
description: How the partial-plate matcher decides to open, and the non-obvious Tesseract-confidence trap
---
The partial (fuzzy) access path runs ONLY after an exact-match NO_RESERVATION/VEHICLE_NOT_FOUND denial, and only if `cameras.allow_partial_match=true`. It then requires ALL THREE per-camera gates to pass:
- similarity ≥ `partial_match_threshold` (% , SequenceMatcher.ratio equivalent; default 85)
- OCR confidence ≥ `partial_min_confidence` (0–100; default 50)
- shared digits in left-aligned common positions ≥ `min_matching_digits` (default 4)

**Why it matters / traps:**
- **Tesseract reports confidence ~0 even on correct reads.** So `partial_min_confidence` > 0 silently disables fuzzy entirely (it never runs). To use fuzzy at all you must set it ~0. The plausibility gate (`isPlausiblePlate`) already ignores confidence for the same reason; only structural checks (len 5–10, alphanumeric, has letter+digit) drop reads.
- **`min_matching_digits=4` blocks ANY single-digit OCR misread** (e.g. plate 2780 read as 2760 → only 3 shared digits → denied) no matter how high similarity is. This is a deliberate "high similarity but numbers differ" safety gate. Lowering to 3 allows exactly one wrong digit.

**How to apply:** these are DB config columns on `cameras` (data, not code) — tunable per camera without touching the off-limits recognition/matching code. Relaxing them (digits 4→3, threshold 85→75, conf 50→0) lets a chronically-misread plate through but lets a stranger sharing 3/4 digits + ~75% shape open the gate; acceptable only at tiny villas with few registered cars. The reliable fix for an 8↔6 misread is a clean head-on barrier read, not threshold tuning.
