import type { TelegramInboundEvent } from "../../types/telegram.types.js";

export type TelegramRateLimitConfig = {
  windowMs: number;
  maxUpdates: number;
  noticeCooldownMs: number;
};

export type TelegramRateLimitState = {
  windowStartedAtMs: number;
  updateCount: number;
  noticeSentAtMs: number | null;
};

export type TelegramRateLimitDecision =
  | {
      allowed: true;
      state: TelegramRateLimitState;
    }
  | {
      allowed: false;
      retryAfterSeconds: number;
      shouldNotify: boolean;
      state: TelegramRateLimitState;
    };

const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = 60;
const DEFAULT_RATE_LIMIT_MAX_UPDATES = 30;
const DEFAULT_RATE_LIMIT_NOTICE_COOLDOWN_SECONDS = 60;

export function readTelegramRateLimitConfig(env: NodeJS.ProcessEnv): TelegramRateLimitConfig {
  return {
    windowMs: readBoundedInteger(
      env["TELEGRAM_RATE_LIMIT_WINDOW_SECONDS"],
      DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
      10,
      3600,
    ) * 1000,
    maxUpdates: readBoundedInteger(
      env["TELEGRAM_RATE_LIMIT_MAX_UPDATES"],
      DEFAULT_RATE_LIMIT_MAX_UPDATES,
      5,
      1000,
    ),
    noticeCooldownMs: readBoundedInteger(
      env["TELEGRAM_RATE_LIMIT_NOTICE_COOLDOWN_SECONDS"],
      DEFAULT_RATE_LIMIT_NOTICE_COOLDOWN_SECONDS,
      10,
      3600,
    ) * 1000,
  };
}

export function createInMemoryTelegramRateLimiter(
  config: TelegramRateLimitConfig,
  nowMs: () => number = () => Date.now(),
) {
  const states = new Map<string, TelegramRateLimitState>();

  return {
    check(key: string): TelegramRateLimitDecision {
      const decision = resolveTelegramRateLimit({
        config,
        nowMs: nowMs(),
        previousState: states.get(key) ?? null,
      });

      states.set(key, decision.state);
      return decision;
    },
    clear(): void {
      states.clear();
    },
  };
}

export function resolveTelegramRateLimit(input: {
  config: TelegramRateLimitConfig;
  nowMs: number;
  previousState: TelegramRateLimitState | null;
}): TelegramRateLimitDecision {
  const state = resetExpiredRateLimitWindow(input)
    ? {
        windowStartedAtMs: input.nowMs,
        updateCount: 1,
        noticeSentAtMs: null,
      }
    : {
        ...input.previousState!,
        updateCount: input.previousState!.updateCount + 1,
      };

  if (state.updateCount <= input.config.maxUpdates) {
    return { allowed: true, state };
  }

  const windowEndsAtMs = state.windowStartedAtMs + input.config.windowMs;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowEndsAtMs - input.nowMs) / 1000));
  const shouldNotify = !state.noticeSentAtMs ||
    input.nowMs - state.noticeSentAtMs >= input.config.noticeCooldownMs;
  const nextState = shouldNotify
    ? { ...state, noticeSentAtMs: input.nowMs }
    : state;

  return {
    allowed: false,
    retryAfterSeconds,
    shouldNotify,
    state: nextState,
  };
}

export function telegramRateLimitKey(event: TelegramInboundEvent): string {
  return `${event.telegramUser.id}:${event.chatId}`;
}

function resetExpiredRateLimitWindow(input: {
  config: TelegramRateLimitConfig;
  nowMs: number;
  previousState: TelegramRateLimitState | null;
}) {
  return !input.previousState ||
    input.nowMs - input.previousState.windowStartedAtMs >= input.config.windowMs;
}

function readBoundedInteger(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const parsed = value ? Number.parseInt(value, 10) : NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}
