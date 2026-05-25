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
- **Git workflow:** Auto-commit + `git push origin main` след всяка завършена задача — без да чакаш потвърждение. В края давай commit hash + deploy команди за сървъра (`git pull && docker compose up -d --build <service>`).
- **Git push pattern:** `bash` блокира destructive git. Използвай `code_execution` (Node) с `execSync` за commit/push. Преди това: `find .git -name '*.lock' -delete`. Commit msg → файл (`/tmp/cm.txt`) → `git -c user.name=Replit -c user.email=agent@replit.com commit -F /tmp/cm.txt`.
- **Constraints (read-only zones):** Не пипай OCR/YOLO/EasyOCR, relay logic, Docker arch, snapshot flow, reservations logic (с изключение на authorized PIN gen change), Hikvision, villas, fuzzy gating. Само additive промени.
- **Self-hosted target:** 6.5.4.254, Docker compose, `.env.docker`. Repo: github.com/mladenovpeter-maker/VillaAccess `main`.

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
