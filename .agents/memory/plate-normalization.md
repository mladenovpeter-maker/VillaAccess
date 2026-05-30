---
name: Bulgarian plate Cyrillic→Latin normalization
description: Every manual license-plate WRITE path must normalize Cyrillic homoglyphs to Latin, or OCR exact-match silently fails.
---

# Plate normalization (Cyrillic→Latin homoglyphs)

Bulgarian plates use 12 letters identical in Latin and Cyrillic (A B E K M H O P C T Y X ↔ А В Е К М Н О Р С Т У Х). On a Bulgarian keyboard layout an operator can silently type Cyrillic code points. Such a plate passes the unique constraint and looks correct in the UI, but will NEVER equal the pure-Latin string the OCR worker emits → ANPR exact-match fails with "No reservation found" even though the car is in the table.

**Rule:** every place where a plate is entered/stored MANUALLY must run `normaliseLicensePlate()` (canonical impl + the `CYR_TO_LAT_PLATE` map live in `artifacts/api-server/src/routes/vehicles.ts`). It maps Cyrillic→Latin, uppercases, strips whitespace/dashes/dots.

**Why:** the fix was first applied only to the vehicles form (`vehicleBodySchema` zod transform). The reservation form path (`resolveLicensePlates` in `routes/reservations.ts`) was missed — it used a weaker inline `trim().toUpperCase().replace(/\s+/g,"")` with no homoglyph mapping, so Cyrillic plates entered via a reservation still broke OCR matching. Now both import the same `normaliseLicensePlate`.

**How to apply:** any NEW manual plate-entry surface must call `normaliseLicensePlate`. Do NOT add normalization to OCR/YOLO/snapshot paths — those emit Latin already and are on the do-not-touch list; this is a write-path-only concern and must leave OCR/fuzzy/reservation-matching logic untouched.
