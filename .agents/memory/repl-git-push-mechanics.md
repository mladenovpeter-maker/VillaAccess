---
name: How git push to the user's GitHub works in this repl
description: Why pushing to origin (the user's external GitHub) from the main agent is awkward here, and what actually moves origin/main forward.
---

# Pushing to the user's GitHub (origin) from this repl

The repo has a real external `origin` = github.com/mladenovpeter-maker/VillaAccess.
Auth uses a git **credential helper** that reads the `GITHUB_TOKEN` Replit **secret**
(`credential.helper '!f() { echo username=...; echo "password=$GITHUB_TOKEN"; }; f'`),
so the token is NOT stored in plaintext in the remote URL / .git/config.

## The trap (cost me several attempts)
- **code_execution sandbox does NOT have Replit secrets** in its env — `$GITHUB_TOKEN`
  is empty there (length 0, even after sandbox restart). So `git push` from
  code_execution fails: `remote: Invalid username or token`. READ can still appear to
  work via cached/other paths, but WRITE fails.
- **bash tool DOES have the secret** (`$GITHUB_TOKEN` length 40) and `git push --dry-run`
  succeeds there — BUT the bash tool **blocks** real git mutations (push, `git config`,
  `git remote set-url`) with: "Destructive git operations are not allowed in the main
  agent. Use the project_tasks skill…" (triggers on .git/*.lock creation).

Net: from the main agent, neither path cleanly does a real push with the secure helper.

## What actually advances origin/main
The platform's **automatic checkpoint/handback commit** is what pushed `origin/main`
forward — after the task, the server's `git pull` fetched the auto-checkpoint commit
with no manual `git push` from the agent. So: don't burn time forcing a push; let the
checkpoint flow carry it, and verify by having the user `git pull` on the server.

**Why:** secrets aren't injected into code_execution; bash guards git writes; so manual
agent pushes are unreliable here.
**How to apply:** to verify a push landed, check `origin/main` via bash `git ls-remote`
(read works) or have the user `git pull` on the server. If a real push is ever required
from the agent, use a project task (isolated env with secrets + git permissions).

## LATENCY (important — don't panic-push)
The handback/checkpoint push to `origin/main` is **not instant**. Right after the loop
ends `git ls-remote origin` can still show the OLD tip for a while, so a user `git pull`
on the server can come back empty even though the work is committed locally. It catches
up shortly after. **When the user reports "git pull empty / nothing pushed", FIRST
re-run `git ls-remote origin refs/heads/main` and compare to `git rev-parse main` — it
has usually caught up by then.** Only if it is genuinely stuck behind should you spin up
a push project task. (Observed: origin lagged at an old SHA when the loop ended, then
matched local once the next checkpoint/task cycle ran — no manual push needed.)
## RELIABLE FIX: push from a task agent (THIS WORKS)
The checkpoint→GitHub sync is unreliable here (origin lagged local by 3 commits even
after waiting). The dependable path: spin up a **project task**; inside the task-agent
(isolated) env, a plain `git push origin main` **succeeds** — it reported
`5995752..4a00b0f  main -> main` and `git ls-remote` confirmed GitHub matched local.
**Caveat (cosmetic, ignore):** right after the successful push, git fails to update the
LOCAL tracking ref with `cannot lock ref 'refs/remotes/origin/main' … main.lock: File
exists`. That is a local bookkeeping error ONLY — the remote was already updated. Do NOT
`rm` that .lock file (the rm path itself trips the destructive-git guard); just verify
success with read-only `git ls-remote origin refs/heads/main` vs `git rev-parse main`.
(So: ignore the earlier "task-agent blocks push" claim — push works; only the bash
maintenance.lock on `git fetch` and the post-push tracking-ref update are guarded.)
