---
name: sivraj-worktree-cleanup
description: Use when the Sivraj repository has a large dirty worktree, mixed user/Codex changes, untracked files, broad diffs, or needs a cleanup plan before commits, PRs, rebases, restores, or further feature work. Guides safe inventory, ownership classification, atomic staging, verification, and preservation of user changes.
---

# Sivraj Worktree Cleanup

Use this skill before making broad cleanup changes in `/Users/apple/Documents/Fortune Stuff/sivraj`, especially when `git status --short` shows many modified or untracked files.

## Ground Rules

- Treat all existing changes as user-owned until proven otherwise.
- Do not run destructive git commands (`reset`, `checkout --`, `clean`, broad `restore`) unless the user explicitly asks.
- Prefer inventory and classification before edits.
- Keep cleanup commits atomic by domain and behavior, not by file count.
- Preserve runnable state between batches: test each commit-sized group.
- When a file contains mixed unrelated changes, stage or commit only the intended hunks.

## Workflow

1. Snapshot the state:
   - `git status --short`
   - `git diff --stat`
   - `git diff --name-status`
   - `git ls-files --others --exclude-standard`

2. Classify each path:
   - `active-fix`: changes tied to the current user request.
   - `probable-user-work`: useful but unrelated existing work.
   - `generated-output`: build artifacts, caches, vendored files, or derived files.
   - `unclear`: needs diff inspection or user decision.

3. Group by domain:
   - chat/voice UI
   - API chat/provider/memory routes
   - worker/ingestion/storage
   - database schema/migrations
   - docs/config/dependencies
   - generated/vendor/cache artifacts

4. For each group, inspect before acting:
   - Use `git diff -- <path>` for tracked files.
   - Use `sed -n` or `rg` for untracked source files.
   - Decide whether it belongs in the next commit, a later commit, or a user-review bucket.

5. Stabilize before staging:
   - Run the narrowest relevant tests first.
   - Then run package build/typecheck for affected packages.
   - For React changes, run `npx react-doctor@latest --verbose --scope changed`.

6. Stage carefully:
   - Prefer explicit file paths.
   - Use hunk staging only when a file has mixed domains.
   - After staging, run `git diff --cached --stat` and `git diff --cached --name-status`.

7. Commit order:
   - Contract/model changes first.
   - Backend behavior and tests second.
   - Frontend behavior and tests third.
   - Docs/config cleanup last.

## Cleanup Report Format

When reporting back, include:

- What changed in the cleanup batch.
- What remains dirty and why.
- Tests/builds run.
- Any files that need user decision before cleanup.

Keep the report concise; link exact files when useful.
