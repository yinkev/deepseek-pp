# Updating from upstream (zhu DeepSeek++)

How to pull the latest **zhu1090093659/deepseek-pp** into this local fork without losing browser-bridge work or pushing to the wrong remote.

**Repo:** `/Users/kyin/Projects/deepseek-pp`  
**Last reviewed:** 2026-07-09

---

## Remotes (locked)

| Remote | URL | Use |
|---|---|---|
| **`origin`** | `https://github.com/zhu1090093659/deepseek-pp.git` | **Upstream only.** `git fetch origin` is fine. **Never push** (push URL is intentionally disabled). |
| **`fork`** | `https://github.com/yinkev/deepseek-pp.git` | **Our durable remote.** Push feature + checkpoint branches here. |

Check anytime:

```bash
cd /Users/kyin/Projects/deepseek-pp
git remote -v
```

Expected push line for origin:

```text
origin  DISABLED_NEVER_PUSH_TO_ZHU (push)
```

If that is missing, do **not** push to origin until it is restored.

---

## What “best method” means here

| Situation | Best method | Why |
|---|---|---|
| **Committed** bridge work on `local/browser-origin-api` | **`git fetch origin` + `git merge origin/main`** | Safe, reviewable, no history rewrite. Matches “thin hooks + isolated packages.” |
| **Uncommitted** dirty files mid-work | **`git stash -u` → merge → `git stash pop`** | Stash is only for **uncommitted** dirt, not for “updating from upstream” itself. |
| **Huge conflict explosion** after merge | **Replay packages** on a fresh branch from `origin/main` | Don’t force-push; re-apply `core/cursor-bridge` + `packages/cursor-bridge-host` + thin hooks. |
| **Align local `main` to zhu** | **Hard reset local `main` to `origin/main`** (optional, explicit) | Local `main` often diverges; feature work should live on `local/*`, not on `main`. |

**Do not use rebase onto origin/main as the default** for this fork unless you own every commit and are comfortable resolving the full rewrite. Prefer **merge**.

**Do not use stash as the primary “upstream update” strategy** for months of commits. Stash is temporary workspace parking only.

---

## Golden path (committed feature branch) — preferred

Use this when `local/browser-origin-api` is clean (or only has work you are willing to commit first).

```bash
cd /Users/kyin/Projects/deepseek-pp

# 0) Never push to zhu
git remote -v   # origin push must be DISABLED

# 1) Save your branch state to our fork first
git checkout local/browser-origin-api
git status -sb
# if dirty: commit, or use the stash path below
git push -u fork HEAD

# 2) Fetch upstream (zhu) only
git fetch origin

# 3) Merge latest upstream main into the feature branch
git merge origin/main
# resolve conflicts — expect heat only at thin hooks:
#   entrypoints/background.ts
#   wxt.config.ts
#   package.json / lockfile if versions moved
# Prefer keeping:
#   core/cursor-bridge/**
#   packages/cursor-bridge-host/**
#   docs/goals/*browser* docs/roadmap/*browser* docs/UPSTREAM_UPDATE.md

# 4) Verify
npm test
npm run build:chrome   # or your usual build
# optional: npm run compile / tsc if you use it

# 5) Publish our fork (never origin)
git push fork local/browser-origin-api
```

### Conflict triage

| Area | Prefer |
|---|---|
| `core/cursor-bridge/**`, `packages/cursor-bridge-host/**` | **Ours** (local feature) |
| Upstream-only product files we never touched | **Theirs** (`origin/main`) |
| Thin hooks (`background.ts`, manifest/wxt) | **Combine**: keep their changes + re-add our 3–10 line bridge registration |
| Lockfiles | Regenerate with install if messy |

If the merge is a disaster:

```bash
git merge --abort
# then use “Replay packages” below
```

---

## Dirty tree path (stash, then golden path)

Only when you have **uncommitted** changes and need upstream **now**:

```bash
cd /Users/kyin/Projects/deepseek-pp
git checkout local/browser-origin-api

# Park ALL uncommitted work (including untracked)
git stash push -u -m "wip before origin/main $(date +%Y%m%d-%H%M%S)"

git fetch origin
git merge origin/main
# resolve + test as in golden path

# Bring WIP back
git stash pop
# fix any stash conflicts, then test again

git push fork local/browser-origin-api
```

List / recover stashes:

```bash
git stash list
git stash show -p stash@{0}
# if pop went badly:
git stash apply stash@{0}   # keeps stash; safer than pop when unsure
```

**Rule:** if WIP is valuable, **commit to a `wip/` or checkpoint branch and push `fork`** instead of relying on stash across days.

---

## Checkpoint before a scary merge (recommended)

```bash
cd /Users/kyin/Projects/deepseek-pp
git checkout local/browser-origin-api
git branch "checkpoint/pre-upstream-$(date +%Y%m%d-%H%M%S)"
git push fork "checkpoint/pre-upstream-$(date +%Y%m%d-%H%M%S)"
# then run golden path merge
```

You can always reset the feature branch back to that checkpoint if the merge is wrong.

---

## Replay packages (nuclear, still safe)

When `git merge origin/main` conflicts everywhere:

```bash
cd /Users/kyin/Projects/deepseek-pp
git fetch origin

# New branch from pure upstream
git checkout -b "local/browser-origin-api-rebased-$(date +%Y%m%d)" origin/main

# Copy feature trees from the old branch tip (example)
OLD=local/browser-origin-api
git checkout "$OLD" -- \
  core/cursor-bridge \
  packages/cursor-bridge-host \
  docs/goals/browser-origin-cursor-api.md \
  docs/goals/octopus-browser-model-platform.md \
  docs/roadmap/browser-origin-cursor-api-next.md \
  docs/cursor-bridge-try-it-out.md \
  docs/UPSTREAM_UPDATE.md \
  tests/cursor-bridge-protocol.test.ts \
  tests/cursor-bridge-worker.test.ts

# Manually re-apply thin hooks in:
#   entrypoints/background.ts
#   wxt.config.ts
# (search old branch for startCursorBridgeRuntime / cursor-bridge)

npm test
npm run build:chrome
git add -A
git commit -m "feat: re-apply browser-origin bridge onto latest origin/main"
git push -u fork HEAD
```

Do **not** force-push over zhu. Do **not** rewrite `origin/*`.

---

## Optional: make local `main` track zhu again

Local `main` is often **ahead/behind** `fork/main` and is **not** the feature branch. Bridge work lives on `local/browser-origin-api`.

Only if you explicitly want a clean upstream `main` locally:

```bash
cd /Users/kyin/Projects/deepseek-pp
git fetch origin
git checkout main

# WARNING: discards local-only commits on main that are not elsewhere
# First: ensure anything precious is on a branch pushed to fork
git branch "checkpoint/local-main-$(date +%Y%m%d-%H%M%S)"
git push fork "checkpoint/local-main-$(date +%Y%m%d-%H%M%S)"

git reset --hard origin/main
# Do NOT: git push origin main
# Optional: update our fork's main to match zhu (explicit only)
# git push fork main
```

Feature work continues:

```bash
git checkout local/browser-origin-api
git merge origin/main
```

---

## After every successful upstream merge

1. `npm test` + `npm run build:chrome`
2. Reinstall native host if host script path or installer changed:
   ```bash
   npm run cursor-bridge:install -- --browser chrome --extension-id <YOUR_ID>
   ```
3. Reload unpacked extension (`dist/chrome-mv3`)
4. `curl -s http://127.0.0.1:8787/v1/models`
5. `git push fork local/browser-origin-api`

---

## Anti-patterns

| Don’t | Why |
|---|---|
| `git push origin …` | Upstream is zhu; push is disabled / must stay disabled |
| `git push --force` to `main` or shared history | Loses recovery options |
| Stash for weeks as “backup” | Stashes are local and easy to drop |
| Merge upstream into a dirty tree without stash/commit | Conflict soup + lost edits |
| Re-edit large upstream files instead of isolated packages | Future merges get harder |
| Assume `fork/main` == `origin/main` | They can diverge; always `fetch origin` for zhu |

---

## Quick cheat sheet

```bash
# Update feature branch from zhu (clean tree)
git checkout local/browser-origin-api
git push fork HEAD
git fetch origin
git merge origin/main
npm test && npm run build:chrome
git push fork HEAD

# Same, but dirty tree
git stash push -u -m "wip pre-upstream"
git fetch origin && git merge origin/main
# test…
git stash pop
git push fork HEAD
```

---

## Related docs

- `docs/goals/browser-origin-cursor-api.md` — long-horizon goal + isolation rules  
- `docs/goals/octopus-browser-model-platform.md` — model surface (octopus / eyes / squid)  
- `docs/cursor-bridge-try-it-out.md` — operator smoke steps  
- `docs/decisions/2026-07-09-browser-origin-cursor-api.md` — decision record  
