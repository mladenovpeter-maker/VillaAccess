---
name: Docker backend deps must be bundled, not external
description: Why a new api-server npm dep can boot fine on Replit but crash the Docker backend container
---

The backend Docker runner stage ships ONLY the esbuild `dist/` bundle — there is
no `node_modules` in the runtime image (`COPY --from=builder .../dist ./dist`).

**Rule:** any npm package the api-server imports must end up *inside* the esbuild
bundle. If a package is listed in esbuild's `external` array (in
`artifacts/api-server/build.mjs`), it is NOT bundled and will be
`ERR_MODULE_NOT_FOUND` at container startup → backend crashes → migrate/frontend/
ai-worker downstream all fail with "dependency failed to start".

**Why it hides on Replit:** the dev workflow runs from the full monorepo
`node_modules`, so an external dep resolves fine there. The breakage only appears
in the Docker runner image. "Builds clean + boots on Replit" does NOT prove it
will run in Docker.

**How to apply:** when adding a new server dependency, make sure it is NOT in the
`external` list. The build already injects a `createRequire` banner
(`globalThis.require`, `__filename`, `__dirname`), so bundled CJS packages that do
dynamic `require()` of Node builtins (e.g. nodemailer requiring "events") work
under the ESM output. Only keep something `external` if it truly can't be bundled
(native `.node` addons, dynamic file/path traversal) — and then it must be copied
into the runner image separately.
