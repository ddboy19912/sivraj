# Decision Log

Use this file to record major product and technical decisions.

## 2026-05-14: Product Category

Decision:

Sivraj is a persistent intelligence and identity layer, not a chatbot, memory vault, notes app, or vector database.

Reason:

The durable value is compounding cognitive continuity across AI systems.

## 2026-05-14: Initial Wedge

Decision:

Prioritize Founder OS as the initial market.

Reason:

Founders have high context fragmentation, high willingness to pay, and immediate need for strategic synthesis across product, engineering, fundraising, hiring, and execution.

## 2026-05-14: Product Moat

Decision:

The moat is intelligence synthesis over long-term personal context.

Reason:

Storage, embeddings, uploads, and generic chat are commodities. Pattern detection, cross-domain reasoning, and durable identity context are where value compounds.

## 2026-05-14: Agent Strategy

Decision:

Sivraj should enhance existing AI systems rather than replace them.

Reason:

The strategic unlock is becoming the shared context layer beneath ChatGPT, Claude, Cursor, OpenClaw, custom agents, and future AI systems.

## 2026-05-14: Application Stack

Decision:

Use Vite + React for the web app, a standalone TypeScript API service, and a standalone worker service.

Reason:

Sivraj's API is a core external platform surface, not a frontend framework backend. Keeping the API separate makes it easier to support external clients, scoped agent context, webhooks, SDKs, rate limits, streaming, audit logs, Walrus persistence, Seal encryption, and Sui identity without coupling those concerns to the web UI.

The web app should stay fast and lightweight. Vite React gives the product dashboard speed without Next.js overhead.

## 2026-05-14: API Runtime Preference

Decision:

Start with Hono for the standalone API unless a concrete operational need pushes the project toward Fastify.

Reason:

Hono is lean, fast, TypeScript-friendly, and suitable for a clean external API surface. Sivraj can revisit Fastify if plugin ecosystem needs, operational hooks, or long-running service requirements become more important.
