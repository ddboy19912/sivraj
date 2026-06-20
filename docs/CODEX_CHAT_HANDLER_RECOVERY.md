# Codex Prompt: Recover and Continue Chat Handler Work

Copy everything inside the **Prompt block** below into Codex when starting a new session on this repo.

---

## Prompt block (copy from here)

You are working in `/Users/apple/Documents/Fortune Stuff/sivraj` on branch `feature/llm-provider-support`.

### Incident you must know about

A prior agent session attempted to split `apps/api/src/routes/chat-message-handler.ts` into domain modules under `apps/api/src/lib/chat/`. During a failed automated extraction, it ran:

```sh
git checkout -- apps/api/src/routes/chat-message-handler.ts
```

That **destroyed an uncommitted ~6,277-line working copy** of the handler and restored the last committed version (**~400 lines**, commit `deb3b7f feat: onboarding`).

**Do not run destructive git commands** (`checkout --`, `reset`, `clean`, broad `restore`) on any path unless the user explicitly asks. Treat all dirty work as user-owned.

### Current broken state

| Item | Status |
|------|--------|
| `apps/api/src/routes/chat-message-handler.ts` | **WRONG** — 400-line committed stub; missing streaming turns, voice surface, document/memory retrieval, attachments, etc. |
| `apps/api/src/routes/chat.ts` | Still imports `handlePostThreadTurn`, `handleDeleteThread`, `handlePostThreadAttachment` — **will not typecheck/build** against the 400-line handler |
| `apps/api/src/routes/chat-message-handler.test.ts` | Untracked (~1,764 lines); tests the full handler API — **keep and use as contract** after restore |
| Rest of worktree | Still dirty and intact (web chat/voice UI, worker, migrations, etc.) |

### Step 0 — BLOCKED until user restores the handler

**Before any refactor or cleanup**, confirm the handler is restored:

```sh
wc -l apps/api/src/routes/chat-message-handler.ts
# Expected after restore: ~6000+ lines (NOT ~400)

grep -c "handlePostThreadTurn\|readChatSurface\|handlePostThreadTurn" apps/api/src/routes/chat-message-handler.ts
# Expected: matches > 0
```

If the file is still ~400 lines, **stop and help the user restore**:

1. Open `apps/api/src/routes/chat-message-handler.ts` in Cursor.
2. **Timeline / Local History** (right-click tab → Open Timeline, or Command Palette → Local History).
3. Restore the version from **before the accidental `git checkout`** (same day, ~6k lines).
4. Verify with `wc -l` and `grep handlePostThreadTurn`.

Alternative recovery if Timeline is empty: Time Machine, another clone/worktree, or a prior Codex/Cursor chat that still has the file content.

**Never** “fix forward” by reimplementing 6k lines from scratch unless the user explicitly chooses that after confirming no backup exists.

### Partial artifacts from the failed split (keep these)

These new modules were extracted from the lost handler and remain on disk. They are **not wired in** yet; some may have incomplete imports until the handler is restored and integration is redone carefully:

- `apps/api/src/lib/chat/chat-surface.ts` — `web_chat` / `voice_chat`, `NORMAL_CHAT_THREAD_FILTER`
- `apps/api/src/lib/chat/chat-sanitize.ts` — `sanitizeAssistantContent`, `sanitizeSivrajVoiceReply`
- `apps/api/src/lib/chat/chat-json.ts` — `parseJsonObject`, `clampConfidence`
- `apps/api/src/lib/chat/turn-types.ts` — shared turn/document/memory types
- `apps/api/src/lib/chat/thread-title.ts` — semantic title generation
- `apps/api/src/lib/chat/turn-policy.ts` — turn decision helpers (`shouldFast*`, memory intake policy)
- `apps/api/src/lib/chat/voice-reply.ts` — voice reply prompt + generation
- `apps/api/src/lib/chat/chat-learning-artifact.ts` — learning artifact builders
- `apps/api/src/lib/chat/memory-intake.ts` — already existed; memory intake pipeline

**Deleted during failed split (do not assume they exist):**

- `apps/api/src/lib/chat/conversation-context.ts`
- `apps/api/src/lib/chat/document-retrieval.ts`
- `apps/api/src/lib/chat/memory-retrieval.ts`
- `apps/api/src/lib/chat/prompt-builder.ts`
- `apps/api/src/lib/chat/index.ts`

### What to do after restore

Follow `docs/WORKTREE_CLEANUP_PLAN.md` and skill `.codex/skills/sivraj-worktree-cleanup/SKILL.md`.

**Phase 2 — stabilize voice/chat fix first** (must pass before splitting):

```sh
pnpm --filter @sivraj/web test -- chat-api-stream.test.ts
pnpm --filter @sivraj/api test -- src/routes/chat-message-handler.test.ts
pnpm --filter @sivraj/api typecheck
pnpm --filter @sivraj/web build
```

Voice/chat contract to preserve:

- API surface tagging (`web_chat` vs `voice_chat`) and normal chat thread filtering
- Voice hook sending `voice_chat` surface
- Chat stream payload type support
- Completed-stream typing behavior (`TypingText` only while `status === "streaming"`)
- Focused tests in `apps/web/src/tests/lib/chat/chat-api-stream.test.ts`

**Phase 3 — handler split (incremental, safe)**

Goal: shrink `chat-message-handler.ts` (~6k lines) into `apps/api/src/lib/chat/*` per `AGENTS.md` (~300–500 lines per file).

Rules for the split:

1. **One small module at a time** — extract, import in handler, re-export for tests, run typecheck + handler tests, then next module.
2. **No batch scripts** that rewrite the whole handler in one shot.
3. **No `git checkout --`** or other destructive git on dirty files.
4. Prefer **explicit file copies + manual import fixes** over brittle line-range automation.
5. Keep **re-exports** from `chat-message-handler.ts` (or a thin `index.ts`) so `chat-message-handler.test.ts` keeps working during migration.
6. Suggested module order: surface → sanitize/json/types → turn-policy → voice-reply → thread-title → conversation-context → memory-retrieval → document-retrieval → prompt-builder → route handlers only in handler.

### Commit / PR guidance

Do not commit until the user asks. When ready, atomic commits by domain (see cleanup plan): chat API contracts → UI → migrations → worker → docs.

### Success criteria

- `chat-message-handler.ts` is the full restored implementation (~6k lines) or a verified equivalent that passes all handler tests.
- Handler split (if continued) reduces file size without losing tests.
- `git status` dirty groups have clear owners; no silent data loss.

---

## Prompt block (copy to here)

## Related docs

- `docs/WORKTREE_CLEANUP_PLAN.md` — batch cleanup order and verification
- `.codex/skills/sivraj-worktree-cleanup/SKILL.md` — ground rules for dirty worktree work
- `AGENTS.md` — file size and engineering standards
