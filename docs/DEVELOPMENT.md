# Development

Use this page for local development commands. For the shorter first-run path, see [Getting Started](./GETTING_STARTED.md).

## Workspace

Sivraj uses pnpm workspaces:

- `apps/web`
- `apps/api`
- `apps/worker`
- `apps/cli`
- `apps/mcp-server`
- `packages/*`

Install dependencies:

```bash
pnpm install
```

## Database

Start local Postgres and Redis:

```bash
pnpm db:up
```

Run migrations:

```bash
pnpm db:migrate
```

Stop services:

```bash
pnpm db:down
```

Helpful commands:

```bash
pnpm db:logs
pnpm db:generate
pnpm db:studio
```

## Apps

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

Run the MCP server:

```bash
pnpm dev:mcp
```

## Verification

```bash
pnpm typecheck
pnpm test
pnpm build
```

For React work:

```bash
npx react-doctor@latest --verbose
```

## Documentation Site

Run the docs site:

```bash
pnpm dev:docs
```

Build the docs site:

```bash
pnpm build:docs
```

## Configuration

Use `.env.example` as the local configuration reference. Keep real secrets in `.env`, and never commit deployment credentials, private keys, wallet seeds, or provider tokens.
