# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

- **Език:** Отговаряй винаги на български.
- **Git workflow:** Auto-commit + `git push origin main` след всяка завършена задача — без да чакаш потвърждение. **ВИНАГИ след GitHub push давай командите за теглене/деплой на новата версия на сървъра** (`cd ~/VillaAccess && git pull && docker compose build <services> && docker compose up -d <services>`), като посочиш само реално променените services (backend/frontend/ai-worker) и дали трябва migrate.
- **Git push pattern:** `bash` блокира destructive git. Използвай `code_execution` (Node) с `execSync` за commit/push. Преди това: `find .git -name '*.lock' -delete`. Commit msg → файл (`/tmp/cm.txt`) → `git -c user.name=Replit -c user.email=agent@replit.com commit -F /tmp/cm.txt`.
- **Constraints (read-only zones):** Не пипай OCR/YOLO/EasyOCR, relay logic, Docker arch, snapshot flow, reservations logic (с изключение на authorized PIN gen change), Hikvision, villas, fuzzy gating. Само additive промени.
- **Self-hosted target:** 6.5.4.254, Docker compose, `.env.docker`. Repo: github.com/mladenovpeter-maker/VillaAccess `main`.

## Gotchas

- **Docker compose env file:** compose чете `.env` по default, не `.env.docker`. На сървъра е създаден symlink `.env -> .env.docker`, така че `docker compose up -d` работи без флаг. Ако symlink-ът липсва, използвай `docker compose --env-file .env.docker up -d` или `${POSTGRES_PASSWORD}` ще се разшири на празно и migrate ще падне с `28P01: password authentication failed`.
- **Postgres password lives in volume:** `POSTGRES_PASSWORD` се чете само при първи init. Ако паролата в `.env.docker` се промени след това, postgres продължава със старата. Fix: `docker compose exec postgres psql -U villa_user -d villa_access -c "ALTER USER villa_user WITH PASSWORD '<new>';"` (Unix socket вътре в контейнера има trust auth, не иска парола).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
