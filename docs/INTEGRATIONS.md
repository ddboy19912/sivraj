# External Integrations

Sivraj is designed to make external AI tools more useful without giving them unrestricted access to private memory.

## Integration Principle

External tools should receive scoped context packets, not raw memory dumps. Every integration should be bounded by:

- User identity.
- Permission scope.
- Purpose.
- Source-backed evidence.
- Revocation and audit requirements.

## Current Integration Surfaces

### Web App

The web app is the primary first-party surface for onboarding, memory management, uploads, chat, provider settings, and permissions.

### API

The API is the primary integration contract for applications and agents that need permissioned context from a Twin.

See [API Usage](./API.md).

### CLI

The CLI is intended for developer workflows, local capture, scripting, and future agent handoff.

### MCP Server

The MCP server is the integration path for MCP-compatible tools. Its job is to expose bounded Sivraj capabilities to agents without bypassing user permission boundaries.

### Coding Agents

Coding agents should receive engineering context packets that are relevant to the current repository or task. They should not receive unrelated private memory by default.

### Telegram Bot

The Telegram bot is the private capture and memory Q&A surface for quick mobile workflows. Users link a Telegram account from the web app, then send or forward notes, links, screenshots, PDFs, docs, CSVs, Markdown, and text files to the bot. Sivraj stores each supported drop as an encrypted source artifact before queueing normal memory processing. Text captures also run through the app's hot-memory intake path; when that path commits memory, the bot can say the memory was remembered and `/ask` can retrieve it immediately. Users can also ask from existing Sivraj memory with `/ask <question>`; those turns are persisted in a hidden Telegram chat thread and answered through the same chat retrieval/generation pipeline as the app.

Server-side environment variables:

- `TELEGRAM_BOT_TOKEN`: bot token from BotFather. Required for Sivraj to send bot replies.
- `TELEGRAM_BOT_USERNAME`: bot username without `@`. Used to generate deep links in the web app.
- `TELEGRAM_WEBHOOK_SECRET`: shared secret configured with Telegram's webhook and verified from the `X-Telegram-Bot-Api-Secret-Token` header.
- `TELEGRAM_LINK_TOKEN_TTL_SECONDS`: optional one-time link token lifetime. Defaults to `900`.
- `TELEGRAM_FRESH_CAPTURE_WINDOW_SECONDS`: optional window for `/ask` to include recent Telegram captures before worker extraction completes. Defaults to `3600`.
- `TELEGRAM_FRESH_CAPTURE_CACHE_TTL_SECONDS`: optional encrypted-ciphertext cache lifetime for immediate `/ask` after capture. Defaults to `3600`.
- `TELEGRAM_RATE_LIMIT_WINDOW_SECONDS`: optional per Telegram user/chat rate-limit window. Defaults to `60`.
- `TELEGRAM_RATE_LIMIT_MAX_UPDATES`: optional max updates per user/chat within the rate-limit window. Defaults to `30`.
- `TELEGRAM_RATE_LIMIT_NOTICE_COOLDOWN_SECONDS`: optional cooldown for sending rate-limit warning replies. Defaults to `60`.

Webhook endpoint:

- `POST /v1/integrations/telegram/webhook`

The API also exposes twin-scoped first-party routes for connection state, link-token creation, and revoke:

- `GET /v1/twins/:twinId/integrations/telegram`
- `POST /v1/twins/:twinId/integrations/telegram/link-token`
- `POST /v1/twins/:twinId/integrations/telegram/revoke`

Bot account-management commands:

- `/start`: start the bot or finish linking from a Telegram deep link.
- `/ask`: ask your Twin from memory.
- `/remember`: save a memory explicitly.
- `/status`: show which Sivraj Twin the current Telegram account is linked to.
- `/whoami`: alias for `/status`.
- `/unlink`: disconnect this Telegram account without deleting memories.
- `/switch`: explain how to move this Telegram account to another Sivraj wallet/user.
- `/help`: show the command list. A bare `/start` without a link token also shows help.

Register the Telegram command autocomplete menu after creating or changing bot commands:

```sh
pnpm --filter @sivraj/api telegram:commands:set
pnpm --filter @sivraj/api telegram:commands:get
```

Register the Telegram bot profile text and, when desired, the Sivraj bot avatar:

```sh
pnpm --filter @sivraj/api telegram:profile:set
pnpm --filter @sivraj/api telegram:profile:set -- --with-profile-photo
pnpm --filter @sivraj/api telegram:profile:get
```

#### Telegram v1 Local Test Plan

Local testing uses Telegram long polling as a bridge into the local API webhook route. This verifies the same webhook handler and secret-header path without deploying or creating an HTTPS tunnel.

1. Run `pnpm --filter @sivraj/api telegram:check` and confirm all Telegram env vars are set.
2. Run `pnpm --filter @sivraj/api telegram:get-me` and confirm the bot username matches `TELEGRAM_BOT_USERNAME`.
3. Run `pnpm --filter @sivraj/api telegram:profile:set -- --dry-run` and confirm the bot profile copy reads correctly.
4. Run `pnpm --filter @sivraj/api telegram:commands:set`, then `pnpm --filter @sivraj/api telegram:commands:get`, and confirm Telegram has `/start`, `/ask`, `/remember`, `/status`, `/whoami`, `/switch`, `/unlink`, and `/help`.
5. If the bot already has a webhook configured, run `pnpm --filter @sivraj/api telegram:webhook:delete`.
6. Start local infrastructure and services:
   - `pnpm db:up`
   - `pnpm db:migrate`
   - `pnpm dev:api`
   - `pnpm dev:worker`
   - `pnpm dev`
7. In a separate terminal, run `pnpm --filter @sivraj/api telegram:poll -- --api-url http://127.0.0.1:3000`.
8. In Telegram, type `/` in the bot chat and confirm Telegram shows autocomplete suggestions for the registered commands.
9. In the web app, open Settings -> Apps and choose Connect Telegram. The app creates a one-time token and opens the bot deep link.
10. Confirm Telegram opens the bot with the link payload and the bot replies that Telegram is linked. If the client does not open the link, copy the fallback `/start <token>` command from the pairing link controls.
11. Send a plain text message to the bot and confirm the bot replies with either a memory acknowledgement or `Captured. I'll process this into memory shortly.`
12. Send a link and confirm the bot replies `Captured link. I'll read and process it shortly.`
13. Send a screenshot/photo, PDF, `.docx`, `.csv`, `.md`, or `.txt` file and confirm the bot replies that the file was captured and will be processed into the Twin.
14. Confirm the web Apps panel shows the recent capture and the database has a `telegram_ingested_messages` row linked to a queued `source_artifacts` row. The capture metadata should include safe Telegram provenance and no raw message body or caption.
15. Immediately send `/ask What do I prefer for investor calls?` and confirm the bot first replies `Checking your Sivraj memory...`, then answers using either processed memory or the recent encrypted Telegram capture fallback.
16. Confirm the database has a `chat_threads` row with `metadata.surface = telegram` and completed user/assistant `chat_messages` rows with `metadata.sourceKind = telegram_qa`.
17. Send `/ask` without a question and confirm the bot returns the usage hint instead of capturing the command as memory.
18. Send `/status` and confirm the bot shows the linked Twin name, Telegram display name, linked date, and unlink/switch guidance.
19. Send `/whoami` and confirm it returns the same linked-account status.
20. Send `/switch` and confirm it explains that switching is done by signing into the target Sivraj account and connecting Telegram again.
21. Send `/help` and confirm it lists capture, ask, unlink, status, and switch commands.
22. Send a voice note and confirm the bot says voice ingestion is coming next, with a `deferred` ingested-message row.
23. Send `/unlink` from Telegram and confirm the bot replies that Telegram is disconnected, the web Apps panel moves out of linked state after refresh, and a follow-up text message asks the user to link before capture.
24. Reconnect from Settings -> Apps, confirm `/status` points to the new active Twin, then revoke Telegram in Settings -> Apps and confirm the bot sends a disconnect notice.

#### Telegram Production Deployment

Production Telegram requires the API to be publicly reachable over HTTPS. Local polling is only for development.

1. Deploy the API and worker with the production environment variables above.
2. Run database migrations against the production database.
3. Confirm the public API health endpoint works:
   ```sh
   curl https://api.example.com/health
   ```
4. Register the bot profile text, command autocomplete menu, and webhook:
   ```sh
   pnpm --filter @sivraj/api telegram:production:setup -- --url https://api.example.com
   ```
   Add `--with-profile-photo` the first time you want the setup command to upload the default Sivraj bot avatar.
5. Verify production health after setup:
   ```sh
   pnpm --filter @sivraj/api telegram:health -- --url https://api.example.com
   ```

The production setup command performs:

- `setMyName`, `setMyShortDescription`, and `setMyDescription` for bot profile UX.
- `setMyCommands` for Telegram command autocomplete.
- `setWebhook` with `TELEGRAM_WEBHOOK_SECRET`.
- health verification for API `/health`, Telegram `getMe`, bot profile text drift, command menu drift, webhook URL, allowed updates, pending updates, and Telegram webhook errors.

You can also run the individual webhook commands:

```sh
pnpm --filter @sivraj/api telegram:webhook:set -- --url https://api.example.com
pnpm --filter @sivraj/api telegram:webhook:info
```

The webhook registration uses `TELEGRAM_WEBHOOK_SECRET` as Telegram's secret token, and the API verifies it from the `X-Telegram-Bot-Api-Secret-Token` header.

#### Telegram Operational Logs

The API emits structured Telegram webhook logs without storing message text or secrets:

- `telegram.webhook.received`: a valid Telegram JSON body reached the webhook.
- `telegram.webhook.routed`: the update normalized into a bot event kind.
- `telegram.reply.sent`: Sivraj replied to Telegram.
- `telegram.reply.failed`: Telegram reply delivery failed.
- `telegram.webhook.completed`: the handler completed with an action.
- `telegram.webhook.rate_limited`: a user/chat exceeded the configured rate limit.
- `telegram.webhook.failed`: an unexpected handler failure occurred.

Telegram user and chat identifiers are logged as short hashes so operators can correlate events without printing raw Telegram IDs.

#### Telegram Production Checks

Use these after every deploy that touches the bot:

```sh
pnpm --filter @sivraj/api telegram:health -- --url https://api.example.com
pnpm --filter @sivraj/api telegram:commands:get
pnpm --filter @sivraj/api telegram:webhook:info
```

Expected results:

- API `/health` returns `{ ok: true }`.
- `getMe` matches `TELEGRAM_BOT_USERNAME`.
- command menu contains `/start`, `/ask`, `/remember`, `/status`, `/whoami`, `/switch`, `/unlink`, and `/help`.
- webhook URL is `https://api.example.com/v1/integrations/telegram/webhook`.
- allowed updates includes `message`.
- pending update count is low.
- Telegram reports no `last_error_message`.

## Planned Integrations

- SDKs for JavaScript and Python.
- Desktop capture and context review.
- Mobile companion capture.
- Additional document and productivity connectors.
- Agent writeback flows where user-reviewed outputs can become new memory.

## Integration Safety

An integration should be considered unsafe if it:

- Requests all user memory by default.
- Stores raw private context outside Sivraj without user approval.
- Cannot explain why each context item was included.
- Cannot be revoked.
- Cannot distinguish source evidence from inferred memory.
