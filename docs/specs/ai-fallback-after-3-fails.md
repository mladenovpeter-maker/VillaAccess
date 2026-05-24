# Spec: AI fallback after 3 consecutive OCR failures

**Status:** 📝 Draft — parked for later. Not started.
**Owner:** to be assigned when we resume.
**Last updated:** 2026-05-24

---

## 1. Goal (in plain words)

Today every detection is decided by the local Python OCR worker (EasyOCR/YOLO).
When OCR fails, the car is denied and nothing else happens.

We want a safety net:

> If the same camera fails to recognise a plate **3 times in a row**,
> bundle the last 3 snapshots and send them to a cloud AI service.
> The AI returns plate + make + color + confidence, and we decide
> allow / deny / ignore based on that.

The local OCR pipeline is **NOT** changed. The AI is a fallback that
runs ONLY when local OCR is repeatedly uncertain.

---

## 2. Requested behaviour (from the user)

1. **Fail counter** — per camera (or per entrance). Increments on every fail.
2. **Ring buffer** — keep the last 3 snapshots per camera. New fail → push,
   oldest evicted. Always ≤ 3.
3. **Local-first** — system first tries to recognise locally (current OCR).
   If confident → proceed normally, never call AI.
4. **AI trigger** — only when 3 consecutive fails occur on the same camera.
5. **AI payload** — 3 snapshots, camera_id, event timestamp.
6. **AI response** — license plate, make, color, confidence.
7. **Decision logic:**
   - Low confidence → ignore, keep watching.
   - Plate in whitelist (has active reservation) → open gate.
   - Plate not in whitelist → deny.
8. **Reset** — after any decision: zero the counter, clear the snapshots,
   start fresh.

---

## 3. Open architectural questions (need answers before coding)

### Q1. Where does the counter + ring buffer live?

**Option A — Backend (Replit, TypeScript)**
- Worker keeps sending normal detections.
- Backend counts consecutive `denied` access_events per camera.
- On the 3rd consecutive denied, backend pulls the 3 most-recent
  `snapshot_url` rows from `access_events` and posts to the AI service.
- "Fail" = an `access_events` row with `status='denied'`.
- ✅ I (main agent) CAN implement this — no Python touched.

**Option B — Python ai-worker**
- Worker accumulates 3 snapshots locally before ever calling backend.
- "Fail" = OCR returned nothing / below confidence.
- ❌ I CANNOT implement this — Python OCR pipeline is protected.

**User's last hint:** sounded more like B (because step 3 says "system
first tries to recognise locally — if confident, continues normally
without AI" — that decision happens in the worker today).

**→ When we resume:** confirm with user. If B, this is a Python worker
task and main agent only adds the AI-call backend endpoint.

### Q2. Which AI service?

Candidates:
1. **OpenAI Vision** (GPT-4o / GPT-4o-mini with images) — cheapest, fastest.
   Use via Replit AI Integration (no API key needed).
2. **Anthropic Claude** (Sonnet vision) — best accuracy on text-in-image.
   Use via Replit AI Integration.
3. **Google Cloud Vision** — purpose-built for ANPR, has dedicated
   license plate detection. Needs explicit billing setup.
4. **Self-hosted model** that user already runs somewhere — needs
   endpoint URL + auth.

**Cost estimate (3 images / call, gpt-4o-mini):** ≈ $0.005 per fallback.
Even at 500 fallbacks/day = $2.50/day = ~$75/month. Acceptable for the
sample size we expect.

**→ When we resume:** ask user which one, and whether to use Replit AI
Integrations (zero key management) or bring-your-own-key.

### Q3. Auto-create vehicles?

If AI returns a plate that is NOT in the `vehicles` table:
- (a) Auto-insert it into `vehicles` (then standard validator runs)?
- (b) Use it for this one decision only, don't persist?

The current code explicitly does NOT auto-create vehicles from OCR
(see `anpr.ts` § 3 — separation of concerns). We should default to
**(b)** to preserve that invariant, but ask user.

### Q4. Other details (defaults proposed)

- **"Consecutive" definition:** counter resets on any `allowed` event
  for the camera, OR after a `RESET_TIMEOUT` of inactivity (proposed:
  5 minutes between fails → ring resets).
- **AI verdict is final** — if AI denies, that denial does NOT count
  as fail #4 (no infinite loop). Counter resets after AI runs.
- **State storage** — Option A needs persistence so counters survive
  restart. Two choices:
  - DB table `camera_anpr_state(camera_id PK, consecutive_fails int, last_fail_at, snapshot_urls text[])`.
  - In-memory `Map<camera_id, …>` — simpler, loses state on restart
    (acceptable: a restart equivalent to a "reset" is fine).

---

## 4. Surfaces that would change (Option A — backend)

```
artifacts/api-server/src/
  ├── services/
  │   ├── anpr.ts                      ← hook AFTER denied-path to bump counter
  │   ├── ai-fallback.ts               ← NEW: counter + ring buffer + AI call
  │   └── ai-fallback-state.ts         ← NEW: in-memory Map (or DB persistence)
  └── routes/
      └── anpr.ts                      ← no change (entry point unchanged)

lib/db/src/schema/
  └── camera_anpr_state.ts             ← NEW (only if we pick DB persistence)

artifacts/dashboard/src/pages/
  └── settings.tsx                     ← add toggle "AI fallback enabled"
                                          + AI confidence threshold (today's
                                          ai_confidence_threshold setting
                                          finally becomes wired!)
```

**Forbidden surfaces (DO NOT TOUCH):**
- `Python ai-worker` (OCR / YOLO / EasyOCR)
- `services/pin-sync.ts`, `hikvision/*`
- `vehicle-archive.ts`, relay code, snapshot flow
- `reservation-validator.ts` (validator stays single source of truth —
  fallback only changes which vehicle_id we validate, never the verdict)

---

## 5. Acceptance criteria (when we eventually ship)

- [ ] After exactly 3 consecutive denials on the same camera, exactly
      one AI call fires; verify with a log marker.
- [ ] On the 4th detection during AI call (still pending) — no second
      AI call fires (in-flight lock).
- [ ] An `allowed` event resets the counter to 0 on that camera.
- [ ] Disabling "AI fallback enabled" setting completely skips the
      fallback path (zero AI calls).
- [ ] AI cost / call latency visible in `domain_events` (new event
      type `ai.fallback_called`).
- [ ] Existing OCR/relay/PIN flows are byte-identical when AI is
      disabled OR when there are < 3 consecutive fails. (Regression
      test on the fuzzy gating chain.)

---

## 6. Resume checklist

When we pick this up, run through in order:

1. Read this file end-to-end with user.
2. Get answers to Q1–Q3 above.
3. Decide on state storage (in-memory vs DB).
4. Confirm AI service + integration path.
5. Write a more detailed implementation plan with concrete file diffs.
6. Implement behind a feature flag (`AI_FALLBACK_ENABLED=false` by default).
7. Test on dev with a mocked AI worker (don't burn credits during dev).
8. Roll out to prod with feature flag OFF; enable per-camera.

---

## 7. Why we parked it

Not blocking anything today. Current OCR + fuzzy matching handles the
common case well. AI fallback is a future optimisation, not a fix —
deferred until we have concrete numbers (how many fails/day in prod
without it) to justify the cost and complexity.
