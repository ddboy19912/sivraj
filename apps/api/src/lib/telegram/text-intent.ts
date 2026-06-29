export type TelegramPlainTextRoute =
  | {
      kind: "ask";
      question: string;
      reason: "question_mark" | "question_starter" | "request_starter" | "memory_lookup";
    }
  | {
      kind: "capture";
      reason: "explicit_capture" | "declarative";
    };
type TelegramAskReason = Extract<TelegramPlainTextRoute, { kind: "ask" }>["reason"];

export function routeTelegramPlainText(text: string): TelegramPlainTextRoute {
  const trimmed = text.trim();

  if (isExplicitTelegramCaptureText(trimmed)) {
    return { kind: "capture", reason: "explicit_capture" };
  }

  const askReason = telegramAskReason(trimmed);

  if (askReason) {
    return {
      kind: "ask",
      question: trimmed,
      reason: askReason,
    };
  }

  return { kind: "capture", reason: "declarative" };
}

export function readTelegramRememberCommandText(text: string): { text: string | null } | null {
  const match = /^\/(?:remember|save|note)(?:@\w+)?(?:\s+([\s\S]*))?$/u.exec(text.trim());

  if (!match) {
    return null;
  }

  return { text: readNonEmptyString(match[1]) };
}

export function isExplicitTelegramCaptureText(text: string): boolean {
  const normalized = normalizeTelegramIntentText(text);

  if (!normalized) {
    return false;
  }

  return EXPLICIT_CAPTURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function telegramAskReason(text: string): TelegramAskReason | null {
  const normalized = normalizeTelegramIntentText(text);

  if (!normalized) {
    return null;
  }

  if (/[?؟？]\s*$/u.test(normalized)) {
    return "question_mark";
  }

  if (QUESTION_STARTER_PATTERN.test(normalized)) {
    return "question_starter";
  }

  if (REQUEST_STARTER_PATTERN.test(normalized)) {
    return "request_starter";
  }

  if (MEMORY_LOOKUP_PATTERN.test(normalized)) {
    return "memory_lookup";
  }

  return null;
}

function normalizeTelegramIntentText(text: string) {
  return text
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const EXPLICIT_CAPTURE_PATTERNS = [
  /^(?:please\s+)?(?:save|store|keep|note)\b/u,
  /^(?:please\s+)?(?:make\s+a\s+note|add\s+a\s+note)\b/u,
  /^(?:please\s+)?(?:don't|dont|do\s+not)\s+forget\b/u,
  /^(?:please\s+)?remember(?:\s+(?:that|this|to|i|i'm|im|my|we|we're|were|the|a|an)|\s*[:,-])/u,
  /\b(?:remember\s+that|save\s+this|store\s+this|keep\s+this|note\s+this|make\s+a\s+note|don't\s+forget|dont\s+forget|do\s+not\s+forget)\b/u,
];

const QUESTION_STARTER_PATTERN =
  /^(?:what|who|when|where|why|how|which|whose)\b/u;

const REQUEST_STARTER_PATTERN = /^(?:please\s+)?(?:can|could|would|will|should|do|does|did|is|are|was|were|am|have|has|had)\s+(?:you|i|we|my|the|this|that|there|it|sivraj)\b/u;

const MEMORY_LOOKUP_PATTERN =
  /^(?:please\s+)?(?:tell\s+me|show\s+me|find|search|summari[sz]e|explain|remind\s+me|recall|look\s+up|check|answer|remember\s+(?:what|when|where|who|how|why|which))\b/u;
