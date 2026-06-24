# Getting Started

Sivraj is a memory-first personal AI workspace. Users connect a wallet, create a Twin, add private context, and use that context through chat, tools, and permissioned integrations.

This guide is for developers and early users who want to run Sivraj locally or understand the main product flow.

## What You Can Do

- Create or resume a wallet-backed Twin.
- Add personal or work context through the web app.
- Upload documents for source-grounded recall.
- Chat with the Twin over saved memory and uploaded material.
- Review memory, provider, and processing state from the app.
- Use the API and future SDKs to request scoped context from the Twin.

## Local Requirements

- Node.js 22 or newer.
- pnpm 10.
- Docker, for local Postgres and Redis.
- Access to the provider credentials needed by the services you enable locally.

Keep local secrets in `.env`. Use `.env.example` as the implementation reference, but do not publish real environment values.

## Install

```bash
pnpm install
```

## Start Local Services

```bash
pnpm db:up
pnpm db:migrate
```

## Run The App

Run the web app:

```bash
pnpm dev
```

Run the API:

```bash
pnpm dev:api
```

Run the worker:

```bash
pnpm dev:worker
```

## Common Checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

For frontend changes, also run:

```bash
npx react-doctor@latest --verbose
```

## First Product Path

1. Connect a supported wallet.
2. Create or resume a Twin.
3. Add profile context during onboarding.
4. Upload or add source material.
5. Ask a question that depends on prior context.
6. Review source-backed answers and memory state.

## Troubleshooting

If the database cannot start, check whether local Postgres or Redis is already using the expected ports. If API calls fail, confirm that the API process is running and the web app is pointing at the same local API URL.
