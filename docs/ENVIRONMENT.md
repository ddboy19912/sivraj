# Environment Contract

## Purpose

Environment variables are shared contract across:

- `apps/web`
- `apps/api`
- `apps/worker`
- shared packages
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

### API

- `NODE_ENV`
- `API_HOST`
- `API_PORT`
- `CORS_ORIGINS`
- `DATABASE_URL`
- `JWT_SECRET`
- `TOKEN_ISSUER`
- `LOG_LEVEL`

### Worker

- `NODE_ENV`
- `DATABASE_URL`
- `REDIS_URL`
- `WORKER_CONCURRENCY`
- `LLM_PROVIDER`
- `LLM_API_KEY`
- `LLM_MODEL`
- `EMBEDDING_MODEL`
- `WALRUS_ENDPOINT`
- `WALRUS_API_KEY`
- `WALRUS_NETWORK`
- `SEAL_PROJECT_ID`
- `SEAL_API_KEY`
- `SUI_NETWORK`
- `SUI_RPC_URL`
- `SUI_PRIVATE_KEY`
- `LOG_LEVEL`

## Contract Groups

### App

- `NODE_ENV`: `development`, `test`, or `production`.
- `APP_URL`: Web app URL.
- `API_URL`: API base URL.
- `VITE_API_URL`: Browser-facing API base URL for the Vite app.

### API

- `API_HOST`: Bind host.
- `API_PORT`: Bind port.
- `CORS_ORIGINS`: Comma-separated allowed browser origins. Local dev should include both `http://localhost:5173` and `http://127.0.0.1:5173` if you use either host in the browser.

### Database

- `DATABASE_URL`: Postgres connection string.

### Queue

- `REDIS_URL`: Redis connection string.
- `WORKER_CONCURRENCY`: Max concurrent worker jobs.

### LLM

- `LLM_PROVIDER`: Model provider key.
- `LLM_API_KEY`: Provider API key.
- `LLM_MODEL`: Main synthesis model.
- `EMBEDDING_MODEL`: Embedding model.

### Walrus

- `WALRUS_NETWORK`: Target network.
- `WALRUS_EPOCHS`: Number of Walrus epochs to store encrypted private memory.
- `WALRUS_DELETABLE`: Whether Walrus blobs should be deletable.
- `WALRUS_UPLOAD_RELAY_URL`: Optional upload relay URL. Recommended on testnet to avoid direct storage-node confirmation failures.
- `WALRUS_UPLOAD_RELAY_TIP_MAX_MIST`: Optional max relay tip in MIST.

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

### Observability

- `LOG_LEVEL`: `debug`, `info`, `warn`, or `error`.
- `OTEL_EXPORTER_OTLP_ENDPOINT`: Optional OpenTelemetry collector.
