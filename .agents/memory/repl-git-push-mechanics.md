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
