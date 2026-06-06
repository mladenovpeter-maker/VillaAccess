---
name: Self-hosted .env.docker required keys & recovery
description: The self-hosted server's .env.docker is gitignored, lives only on the server, and has been lost/truncated before — what it must contain and how to recover lost values without data loss.
---

# Self-hosted `.env.docker` — required keys & recovery

The production stack is self-hosted via Docker on the user's own server
(`docker compose --env-file .env.docker up --build -d`). `.env.docker` is **gitignored** —
it exists ONLY on that server, never in the repo, and we never have its values.
It has been found reduced/truncated more than once (only `TUYA_*` lines survived), which
silently breaks services because compose substitutes missing vars with blank strings.

**Never store the actual secret values in memory.** Only the key list and recovery method.

## Keys the stack needs (from docker-compose.yml)
- `POSTGRES_PASSWORD` — required; DB auth.
- `JWT_SECRET` — required; login. Changing it logs everyone out (must re-login).
- `ANPR_WORKER_TOKEN` — required; backend↔ai-worker auth. Value is arbitrary but both read the
  same file, so a fresh value is fine as long as it's consistent.
- `CF_TUNNEL_TOKEN` — required for the public Cloudflare tunnel (`app.villaaccess.com`).
  Missing → cloudflared runs with blank token → **Cloudflare Error 1033**.
- `OPENAI_API_KEY` + `AI_FALLBACK_ENABLED=true` — needed for AI license-plate fallback.
- `TUYA_ACCESS_ID` / `TUYA_ACCESS_SECRET` / `TUYA_REGION` — Tuya cloud.
- Optional: `CORS_ALLOWED_ORIGINS` (not needed — frontend nginx proxies /api same-origin),
  `AI_FALLBACK_COOLDOWN_SECONDS`, `ANPR_LANGUAGES`, `ANPR_REFRESH_TARGETS_SECONDS`, `ANPR_MIN_BOX_ASPECT`.

## Symptom → cause map
- `migrate` exits 1 / backend unhealthy, with `WARN The "POSTGRES_PASSWORD" variable is not set`
  → blank DB password. Postgres still shows Healthy because `pg_isready` doesn't check auth and
  the existing `postgres_data` volume keeps the ORIGINAL password.
- Cloudflare **Error 1033** → missing/blank `CF_TUNNEL_TOKEN`.
- Health page "AI Engine" card shows `N/A` / "AI fallback disabled" and the ON/OFF toggle is GONE
  → the toggle is gated (health.tsx): shows only when admin AND `env_enabled===true` AND
  `has_api_key===true`. Missing env HIDES it; it is NOT removed from code.

## Recovery without data loss
1. **Find lost tokens on the server** (they often survive in shell history / files):
   - CF tunnel token starts with `eyJhIjoi`: `grep -rhoE 'eyJhIjoi[A-Za-z0-9_=.-]{60,}' ~/.bash_history ~/VillaAccess`
   - OpenAI key: `grep -rhoE 'sk-[A-Za-z0-9_-]{20,}' ~/.bash_history ~/VillaAccess` (ignore false `sk-docker-stats...` matches; real one is `sk-proj-...`).
   - Container env: `docker inspect villaaccess-backend-1 | grep -oE 'OPENAI_API_KEY=[^"]*'`.
2. **DB password** (when original is unknown): postgres uses `local ... trust`, so reset via socket
   without the old password and put the same value in `.env.docker` — no data loss:
   `docker compose --env-file .env.docker exec postgres psql -U villa_user -d villa_access -c "ALTER USER villa_user PASSWORD '<new>';"`
3. Re-apply env safely without duplicate lines:
   `sed -i '/^KEY=/d' .env.docker` then append, then `docker compose --env-file .env.docker up -d <service>`.

**Why:** the file is the single source of truth on the server and is fragile (gitignored, lost before).
**How to apply:** before giving server update commands, verify `.env.docker` has all required keys;
if a service breaks after `up`, check the WARN lines about unset variables first — they are the tell.
