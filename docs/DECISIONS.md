# Decision Log

Use this file to record major product and technical decisions.

## 2026-05-14: Product Category

Decision:

Sivraj is a persistent intelligence and identity layer, not a chatbot, memory vault, notes app, or vector database.

Reason:

The durable value is compounding cognitive continuity across AI systems.

## 2026-05-14: Initial Wedge

Decision:

Prioritize Founder OS as the initial market. Superseded by the 2026-05-18 decision that broadens the first wedge to high-leverage independent operators and keeps Founder OS as an expansion path.

Reason:

Founders have high context fragmentation, high willingness to pay, and immediate need for strategic synthesis across product, engineering, fundraising, hiring, and execution.

## 2026-05-18: Product Language and First Persona

Decision:

Sivraj builds and protects the user's sovereign AI Twin. Sivraj is the product and system; the Twin is the user-owned context and intelligence inside it.

The first wedge is high-leverage independent operators. Tunde, an independent consultant, is the first named persona. Founder OS remains an expansion path and premium packaging once graph, synthesis, and reporting capabilities mature.

Reason:

The Twin language matches the existing domain model and API while keeping Sivraj as the clear product brand. Tunde makes the activation moment sharper: Sivraj should recover specific, useful context from the user's own past that they forgot they knew. Founder OS remains valuable, but it asks for broader company/team intelligence than the current product foundation needs to prove first.

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
