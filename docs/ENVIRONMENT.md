# Environment Contract

## Purpose

Environment variables are shared contract across:

- `apps/web`
- `apps/api`
- `apps/worker`
- shared packages
- `apps/mcp-server`
- local development
- deployment

Root `.env.example` is source of truth.

## Rules

- Do not commit `.env`.
- Add every new variable to `.env.example`.
- Add variable to `@sivraj/config` before using it in app code.
- Secrets stay server-side only.
- Web app may only receive public values explicitly exposed by build config.

## Required By Service

### Web

- `APP_URL`
- `API_URL`
- `VITE_API_URL`
- `VITE_SUI_NETWORK`
- `VITE_SUI_RPC_URL`
- `VITE_SEAL_PACKAGE_ID`
- `VITE_SEAL_POLICY_ID`
- `VITE_SEAL_KEY_SERVERS`
- `VITE_SEAL_THRESHOLD`

### API

- `NODE_ENV`
- `API_HOST`
- `API_PORT`
- `CORS_ORIGINS`
- `MEMORY_SEARCH_SHORTLIST_LIMIT`
- `MEMORY_SEARCH_FALLBACK_LIMIT`
- `MEMORY_SEARCH_DECRYPT_CONCURRENCY`
- `MEMORY_SEARCH_DECRYPT_EVIDENCE_LIMIT`
- `DATABASE_URL`
- `JWT_SECRET`
- `TOKEN_ISSUER`
- `LOG_LEVEL`

### Worker

- `NODE_ENV`
- `DATABASE_URL`
- `REDIS_URL`
- `WORKER_CONCURRENCY`
- `ARTIFACT_RECONCILE_INTERVAL_MS`
- `ARTIFACT_RECONCILE_LIMIT`
- `CONNECTOR_RECONCILE_INTERVAL_MS`
- `CONNECTOR_RECONCILE_LIMIT`
- `CONNECTOR_SYNC_CONCURRENCY`
- `TRANSIENT_CIPHERTEXT_MAX_BYTES`
- `INTELLIGENCE_CHUNK_CHARS`
- `INTELLIGENCE_CHUNK_CONCURRENCY`
- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_REQUEST_TIMEOUT_MS`
- `SPEECH_TO_TEXT_PROVIDER`
- `SPEECH_TO_TEXT_API_KEY`
- `SPEECH_TO_TEXT_MODEL`
- `EMBEDDING_MODEL`
- `WALRUS_NETWORK`
- `WALRUS_EPOCHS`
- `WALRUS_DELETABLE`
- `WALRUS_UPLOAD_RELAY_URL`
- `WALRUS_UPLOAD_RELAY_TIP_MAX_MIST`
- `WALRUS_AGGREGATOR_URL`
- `SEAL_PACKAGE_ID`
- `SEAL_POLICY_ID`
- `SEAL_KEY_SERVERS`
- `SEAL_THRESHOLD`
- `SUI_NETWORK`
- `SUI_RPC_URL`
- `SUI_PRIVATE_KEY`
- `LOG_LEVEL`
- `NOTION_API_TOKEN`
- `SLACK_BOT_TOKEN`
- `GMAIL_ACCESS_TOKEN`
- `GOOGLE_CALENDAR_ACCESS_TOKEN`
- `GOOGLE_DRIVE_ACCESS_TOKEN`
- `MICROSOFT_GRAPH_ACCESS_TOKEN`

### MCP Server

- `SIVRAJ_API_URL`
- `SIVRAJ_TWIN_ID`
- `SIVRAJ_TOKEN`
- `SIVRAJ_PROJECT_NAME`
- `SIVRAJ_PROJECT_ID`
- `SIVRAJ_INCLUDE_CANDIDATES`
- `SIVRAJ_MAX_ITEMS_PER_SECTION`

## Contract Groups

### App

- `NODE_ENV`: `development`, `test`, or `production`.
- `APP_URL`: Web app URL.
- `API_URL`: API base URL.
- `VITE_API_URL`: Browser-facing API base URL for the Vite app.
- `VITE_SUI_NETWORK`: Browser/client Sui network for first-party encryption.
- `VITE_SUI_RPC_URL`: Browser/client Sui RPC URL for Seal encryption.
- `VITE_SEAL_PACKAGE_ID`: Seal package ID exposed to the client for encryption.
- `VITE_SEAL_POLICY_ID`: Seal policy object ID exposed to the client for encryption.
- `VITE_SEAL_KEY_SERVERS`: Seal key server object IDs exposed to the client for encryption.
- `VITE_SEAL_THRESHOLD`: Seal key server threshold for client-side encryption.

### API

- `API_HOST`: Bind host.
- `API_PORT`: Bind port.
- `CORS_ORIGINS`: Comma-separated allowed browser origins. Local dev should include both `http://localhost:5173` and `http://127.0.0.1:5173` if you use either host in the browser.
- `MEMORY_SEARCH_SHORTLIST_LIMIT`: Max indexed memory fragment IDs to shortlist before private evidence decrypt. Defaults to `25`.
- `MEMORY_SEARCH_FALLBACK_LIMIT`: Max recent encrypted memory fragments to inspect when no index shortlist exists. Defaults to `20`.
- `MEMORY_SEARCH_DECRYPT_CONCURRENCY`: Max concurrent private fragment decrypts during search. Defaults to `3`.
- `MEMORY_SEARCH_DECRYPT_EVIDENCE_LIMIT`: Max unique evidence fragments to decrypt for one search request. Defaults to `3`; keep low while live Walrus/Seal reads are slow.

### Database

- `DATABASE_URL`: Postgres connection string.

### Queue

- `REDIS_URL`: Redis connection string.
- `WORKER_CONCURRENCY`: Max concurrent worker jobs.
- `ARTIFACT_RECONCILE_INTERVAL_MS`: How often the worker scans queued, pending, or stale processing artifacts and resumes them. Defaults to `60000`.
- `ARTIFACT_RECONCILE_LIMIT`: Max artifacts scanned per reconciliation pass. Defaults to `25`.
- `TRANSIENT_CIPHERTEXT_MAX_BYTES`: Maximum encrypted payload size the API/worker may pass through Redis for short-lived processing handoff. Defaults to `2097152`; set `0` to force all worker reads through Walrus.
- `INTELLIGENCE_CHUNK_CHARS`: Target character size for chunking large memory fragments before entity and memory extraction. Defaults to `18000`.
- `INTELLIGENCE_CHUNK_CONCURRENCY`: Max concurrent chunk extraction tasks inside one intelligence job. Defaults to `2`.
- `CANDIDATE_MEMORY_ARCHIVE_CONCURRENCY`: Max concurrent low-priority candidate-memory archive jobs. Defaults to `1`.
- `CONNECTOR_RECONCILE_INTERVAL_MS`: How often the worker scans connected non-manual connector accounts that are due for sync. Defaults to `60000`.
- `CONNECTOR_RECONCILE_LIMIT`: Max connector accounts scanned per reconciliation pass. Defaults to `25`.
- `CONNECTOR_SYNC_CONCURRENCY`: Max concurrent connector sync jobs. Defaults to `1`.

### Connectors

- `NOTION_API_TOKEN`: Server-side Notion integration token for Notion page sync. The integration must have read content access to the selected page or parent workspace.
- `SLACK_BOT_TOKEN`: Server-side Slack bot token for channel sync. The Slack app needs conversation read scopes such as `channels:read`/`channels:history` for public channels and corresponding private/DM scopes when syncing those surfaces.
- `GMAIL_ACCESS_TOKEN`: Server-side Gmail OAuth access token for the first email connector path. The token must allow reading message metadata and raw message bodies.
- `GOOGLE_CALENDAR_ACCESS_TOKEN`: Server-side Google Calendar OAuth access token for the first calendar connector path. The token must allow reading calendar events.
- `GOOGLE_DRIVE_ACCESS_TOKEN`: Server-side Google Drive OAuth access token for Drive/Docs sync. The token must allow file metadata reads and content/export downloads for the selected folder or file.
- `MICROSOFT_GRAPH_ACCESS_TOKEN`: Server-side Microsoft Graph OAuth access token for OneDrive sync. The token must allow reading selected drive items and downloading file content.

### LLM

- `LLM_PROVIDER`: Model provider key.
- `LLM_API_KEY`: Provider API key.
- `LLM_MODEL`: Main synthesis model.
- `LLM_REQUEST_TIMEOUT_MS`: Per structured-generation request timeout in milliseconds. Defaults to `45000`; prevents worker jobs from sitting in `processing` indefinitely when an OpenAI-compatible provider hangs.
- `EMBEDDING_MODEL`: Embedding model.

### Speech To Text

- `SPEECH_TO_TEXT_PROVIDER`: Voice note transcription provider. Use `openai` or `none`.
- `SPEECH_TO_TEXT_API_KEY`: Optional dedicated transcription API key. Falls back to `LLM_API_KEY` when unset.
- `SPEECH_TO_TEXT_MODEL`: Audio transcription model. Defaults to `gpt-4o-mini-transcribe`.

### Voice Synthesis

- `VOICE_SERVICE_KIND`: Voice service transport. Use `cartesia` for fast hosted Sonic TTS, `http` for the local Chatterbox FastAPI service, and `gradio` for a Hugging Face Chatterbox Space. Defaults to `http` when unset.
- `VOICE_SERVICE_URL`: Internal URL for the standalone Chatterbox voice service. For Hugging Face Spaces, use the public Space runtime URL like `https://owner-space-name.hf.space`.
- `VOICE_SERVICE_API_KEY`: Optional shared token with the voice service. For local FastAPI this is sent as a bearer token. For the Gradio Space this is sent as a hidden function input. For Cartesia, prefer `CARTESIA_API_KEY`; `VOICE_SERVICE_API_KEY` is accepted as a fallback.
- `VOICE_SERVICE_TIMEOUT_MS`: Voice synthesis timeout in milliseconds. Defaults to `45000`.
- `CARTESIA_API_KEY`: Server-side Cartesia API key. Required when `VOICE_SERVICE_KIND=cartesia`.
- `CARTESIA_VERSION`: Cartesia API version header. Defaults to `2026-03-01`.
- `CARTESIA_MODEL_ID`: Cartesia TTS model. Defaults to `sonic-3.5`.

### Walrus

- `WALRUS_NETWORK`: Target network.
- `WALRUS_EPOCHS`: Number of Walrus epochs to store encrypted private memory.
- `WALRUS_DELETABLE`: Whether Walrus blobs should be deletable.
- `WALRUS_UPLOAD_RELAY_URL`: Optional upload relay URL. Recommended on testnet to avoid direct storage-node confirmation failures.
- `WALRUS_UPLOAD_RELAY_TIP_MAX_MIST`: Optional max relay tip in MIST.
- `WALRUS_AGGREGATOR_URL`: Optional HTTP aggregator URL for worker reads. Recommended on testnet as a fallback when direct SDK storage-node reads fail.

### Seal

- `SEAL_PACKAGE_ID`: Sui package ID containing the Seal approval policy.
- `SEAL_POLICY_ID`: Seal identity/policy ID used for private memory encryption.
- `SEAL_KEY_SERVERS`: Comma-separated key server object IDs, or JSON array of key server configs.
- `SEAL_THRESHOLD`: Number of key server weight units required for decryption.

### Sui

- `SUI_NETWORK`: Target Sui network.
- `SUI_RPC_URL`: Sui RPC endpoint.
- `SUI_PRIVATE_KEY`: Server-side key for Walrus storage transactions.

### Auth

- `JWT_SECRET`: Token signing secret.
- `TOKEN_ISSUER`: Expected issuer.

JWTs are API session tokens issued after Sui wallet verification. They are not the source of user ownership.
Access tokens are short-lived. Refresh sessions are stored in Postgres as hashed opaque tokens and rotate through `/v1/auth/refresh`.

### MCP Server

- `SIVRAJ_API_URL`: API base URL for the local coding-agent MCP server. Defaults to `API_URL`, then `http://127.0.0.1:3000`.
- `SIVRAJ_TWIN_ID`: Twin ID the coding agent is allowed to query.
- `SIVRAJ_TOKEN`: Scoped Sivraj API bearer token. Use `memory:read` for context/search and `artifact:upload` for writeback.
- `SIVRAJ_PROJECT_NAME`: Optional project name used when generating context packets.
- `SIVRAJ_PROJECT_ID`: Optional project ID used when generating context packets.
- `SIVRAJ_INCLUDE_CANDIDATES`: Whether testing MCP context includes candidate engineering memories. Defaults to `true`; production delegated agents should use approved-only mode later.
- `SIVRAJ_MAX_ITEMS_PER_SECTION`: Max context items per exported section. Defaults to `12`.
- `SIVRAJ_WRITEBACK_ENCRYPTION`: `api` or `client`. Defaults to `api` for local development. Use `client` for remote MCP deployments so writeback bodies are Seal-encrypted before crossing the network.
- `SIVRAJ_SEAL_PACKAGE_ID`: Seal package ID for client-side MCP writeback encryption.
- `SIVRAJ_SEAL_POLICY_ID`: Seal policy object ID for client-side MCP writeback encryption.
- `SIVRAJ_SEAL_KEY_SERVERS`: Comma-separated or JSON Seal key server config for client-side MCP writeback encryption.
- `SIVRAJ_SEAL_THRESHOLD`: Seal threshold for client-side MCP writeback encryption. Defaults to `1`.
- `SIVRAJ_SUI_NETWORK`: Sui network for client-side MCP writeback encryption. Defaults to `SUI_NETWORK`, then `testnet`.
- `SIVRAJ_SUI_RPC_URL`: Sui RPC URL used by the MCP process for client-side Seal encryption.

### Observability

- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error`.
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Optional OpenTelemetry collector.
