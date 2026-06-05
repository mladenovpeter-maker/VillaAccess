---
name: SSE endpoints + auth middleware
description: Why SSE routes must not sit behind header-based requireAuth, and how to mount them
---

# SSE endpoints cannot use header-based auth middleware

**Rule:** An SSE endpoint (Content-Type `text/event-stream`, consumed by the browser
`EventSource` API) must NOT be mounted behind a blanket `requireAuth` that checks the
`Authorization: Bearer` header. `EventSource` cannot send custom headers, so it
authenticates via a `?token=` query param and the handler verifies the JWT itself.

**Why:** The live "Поток от събития / Event Stream" feed was permanently stuck
"connecting/offline" because the whole `/events` router was mounted with
`router.use("/events", requireAuth, eventsRouter)`. The blanket middleware rejected
`GET /events/stream` with 401 before the stream handler (which reads `?token=`) ran.
Easy to miss because `/events` and `/events/stats` (called via fetch with the bearer
header) worked fine — only the SSE stream broke.

**How to apply:** Mount the events router WITHOUT blanket `requireAuth`. Protect the
non-SSE sub-routes individually inside the router (`GET /`, `GET /stats` each call
`requireAuth`); let the SSE route self-authenticate via `jwt.verify` on the query
token. Note the SSE self-auth verifies the JWT signature but does not re-check the
user row like `requireAuth` does — acceptable, but harden later if needed.
