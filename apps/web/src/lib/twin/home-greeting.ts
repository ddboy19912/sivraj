type HomeGreetingStorage = Pick<Storage, "getItem" | "setItem">;

export type HomeSessionGreeting = {
  id: string;
  text: string;
};

type HomeSessionGreetingRecord = {
  version: 1;
  greetingId: string;
  attemptedAt: string;
};

const HOME_GREETING_SESSION_KEY_PREFIX = "sivraj.homeGreeting.session.v1";

const HOME_SESSION_GREETING_TEMPLATES = [
  {
    id: "with-you",
    text: "Hi {name}. How's your day going?",
  },
  {
    id: "good-see-you",
    text: "Hey {name}. What are we working on today?",
  },
  {
    id: "settle-in",
    text: "Hi {name}. Need help with anything?",
  },
  {
    id: "welcome-back",
    text: "Welcome back, {name}. What should we look at first?",
  },
  {
    id: "right-here",
    text: "Hey {name}. Anything you want to work through?",
  },
] as const;

export function shouldPlayHomeSessionGreeting({
  twinId,
  storage = browserSessionStorage(),
}: {
  twinId: string;
  storage?: HomeGreetingStorage | null;
}): boolean {
  return readHomeSessionGreetingRecord({ twinId, storage }) === null;
}

export function markHomeSessionGreetingAttempted({
  twinId,
  greetingId,
  storage = browserSessionStorage(),
  attemptedAt = new Date(),
}: {
  twinId: string;
  greetingId: string;
  storage?: HomeGreetingStorage | null;
  attemptedAt?: Date;
}): void {
  if (!storage) {
    return;
  }

  const record: HomeSessionGreetingRecord = {
    version: 1,
    greetingId,
    attemptedAt: attemptedAt.toISOString(),
  };

  try {
    storage.setItem(homeSessionGreetingKey(twinId), JSON.stringify(record));
  } catch {
    // Storage may be disabled or quota-limited. The runtime hook keeps an
    // in-memory guard so unavailable storage does not create refresh loops.
  }
}

export function buildHomeSessionGreeting({
  displayName,
  previousGreetingId = null,
  random = Math.random,
}: {
  displayName: string;
  previousGreetingId?: string | null;
  random?: () => number;
}): HomeSessionGreeting {
  const name = displayName.trim();
  if (!name) {
    throw new Error("Home session greeting requires a display name.");
  }

  const options = HOME_SESSION_GREETING_TEMPLATES.filter(
    (template) => template.id !== previousGreetingId,
  );
  const candidates =
    options.length > 0 ? options : HOME_SESSION_GREETING_TEMPLATES;
  const index = Math.min(
    candidates.length - 1,
    Math.floor(clampRandom(random()) * candidates.length),
  );
  const selected = candidates[index] ?? candidates[0];

  return {
    id: selected.id,
    text: selected.text.replace("{name}", name),
  };
}

export function readHomeSessionGreetingId({
  twinId,
  storage = browserSessionStorage(),
}: {
  twinId: string;
  storage?: HomeGreetingStorage | null;
}): string | null {
  return readHomeSessionGreetingRecord({ twinId, storage })?.greetingId ?? null;
}

export function homeSessionGreetingEventId(
  twinId: string,
  greetingId: string,
): string {
  return safeRuntimeEventId("home-session-greeting", twinId, greetingId);
}

function readHomeSessionGreetingRecord({
  twinId,
  storage,
}: {
  twinId: string;
  storage?: HomeGreetingStorage | null;
}): HomeSessionGreetingRecord | null {
  if (!storage) {
    return null;
  }

  try {
    const value = storage.getItem(homeSessionGreetingKey(twinId));
    if (!value) {
      return null;
    }

    const parsed: unknown = JSON.parse(value);
    if (!isHomeSessionGreetingRecord(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isHomeSessionGreetingRecord(
  value: unknown,
): value is HomeSessionGreetingRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    value.version === 1 &&
    "greetingId" in value &&
    typeof value.greetingId === "string" &&
    "attemptedAt" in value &&
    typeof value.attemptedAt === "string"
  );
}

function homeSessionGreetingKey(twinId: string): string {
  return `${HOME_GREETING_SESSION_KEY_PREFIX}:${twinId}`;
}

function browserSessionStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function safeRuntimeEventId(...parts: string[]): string {
  return parts
    .flatMap((part) => {
      const safePart = part
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

      return safePart ? [safePart] : [];
    },
    )
    .join("-");
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(0.999999, value));
}
