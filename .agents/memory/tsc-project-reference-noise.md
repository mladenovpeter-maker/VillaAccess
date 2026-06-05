---
name: tsc project-reference noise
description: Why standalone `tsc --noEmit` floods false "@workspace/db has no exported member" errors; trust esbuild build instead
---

Running `pnpm --filter @workspace/<pkg> exec tsc --noEmit` standalone reports
`Module '"@workspace/db"' has no exported member 'X'` (accessEventsTable,
camerasTable, usersTable, reservationsTable, …) for **every** file that imports
from `@workspace/db`, and similar cross-package resolution errors.

**These are NOT real errors.** They come from TypeScript project-reference
resolution: the `@workspace/db` (and other workspace libs) `.d.ts` outputs aren't
built/visible in that standalone invocation, so tsc can't see the barrel exports.

**Why it matters:** the per-package `dev` script builds with **esbuild**
(`node ./build.mjs`), which bundles and resolves workspace packages correctly —
that build passing + the server starting cleanly is the authoritative signal.
A code-review architect was also fooled by this (and additionally by `includeGitDiff`
surfacing pre-existing uncommitted changes in OTHER files as if they were part of
the changeset — always cross-check `git status --porcelain` to confirm true scope).

**How to apply:** to typecheck real errors in your new code, ignore the bulk
`has no exported member` lines and look only for errors in the files YOU changed
that are unrelated to workspace-package resolution. Or rely on the esbuild dev
build + a runtime smoke test (curl the endpoint). Don't chase the resolution noise.
