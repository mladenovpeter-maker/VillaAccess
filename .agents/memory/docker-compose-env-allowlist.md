---
name: docker-compose env allowlist (backend & ai-worker)
description: Why putting a var in .env.docker is NOT enough for it to reach a container
---

In this project's `docker-compose.yml`, both the `backend` and `ai-worker`
services declare their env via an explicit `environment:` block using
`${VAR:-default}` substitution. There is **no** `env_file: .env.docker` on
these services.

**Rule:** A variable added to `.env.docker` only reaches a container if that
service's `environment:` block explicitly lists it (e.g.
`AI_FALLBACK_COOLDOWN_SECONDS: ${AI_FALLBACK_COOLDOWN_SECONDS:-60}`).
Compose substitutes `${...}` from `.env.docker`, but a var absent from the
allowlist is simply never passed into the process.

**Why:** This bit us twice — (1) `ANPR_MIN_BOX_ASPECT` set in `.env.docker`
didn't reach `ai-worker` until added to its `environment:` block; (2) the
AI-fallback cooldown var didn't reach `backend` until added to its block.

**How to apply:** To expose a new tunable, do BOTH: add
`NAME: ${NAME:-default}` to the right service's `environment:` block in
`docker-compose.yml`, then set `NAME=value` in `.env.docker`. After deploy,
verify with `docker exec <container> printenv NAME`.
