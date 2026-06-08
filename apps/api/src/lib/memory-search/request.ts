import { requiredString } from "../http/route-helpers.js";

export function parseMemorySearchRequestBody(body: unknown) {
  if (!body || typeof body !== "object") {
    return {
      ok: false as const,
      error: { status: 400 as const, body: { error: "invalid_json_body" } },
    };
  }

  const query = requiredString((body as Record<string, unknown>)["query"]);

  if (!query) {
    return {
      ok: false as const,
      error: { status: 400 as const, body: { error: "missing_query" } },
    };
  }

  return { ok: true as const, query };
}

export function optionalMemorySearchLimit(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : undefined;
}
