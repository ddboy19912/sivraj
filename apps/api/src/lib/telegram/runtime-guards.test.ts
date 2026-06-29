import { describe, expect, it } from "vitest";
import {
  readTelegramRateLimitConfig,
  resolveTelegramRateLimit,
  type TelegramRateLimitConfig,
} from "./runtime-guards.js";

const config: TelegramRateLimitConfig = {
  windowMs: 60_000,
  maxUpdates: 2,
  noticeCooldownMs: 30_000,
};

describe("Telegram runtime guards", () => {
  it("allows updates within the configured window limit", () => {
    const first = resolveTelegramRateLimit({
      config,
      nowMs: 1_000,
      previousState: null,
    });
    const second = resolveTelegramRateLimit({
      config,
      nowMs: 2_000,
      previousState: first.state,
    });

    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(second.state.updateCount).toBe(2);
  });

  it("blocks excess updates and throttles rate-limit notices", () => {
    const first = resolveTelegramRateLimit({
      config,
      nowMs: 1_000,
      previousState: null,
    });
    const second = resolveTelegramRateLimit({
      config,
      nowMs: 2_000,
      previousState: first.state,
    });
    const third = resolveTelegramRateLimit({
      config,
      nowMs: 3_000,
      previousState: second.state,
    });
    const fourth = resolveTelegramRateLimit({
      config,
      nowMs: 4_000,
      previousState: third.state,
    });

    expect(third).toMatchObject({
      allowed: false,
      retryAfterSeconds: 58,
      shouldNotify: true,
    });
    expect(fourth).toMatchObject({
      allowed: false,
      shouldNotify: false,
    });
  });

  it("resets counts after the configured window expires", () => {
    const limited = resolveTelegramRateLimit({
      config,
      nowMs: 3_000,
      previousState: {
        windowStartedAtMs: 1_000,
        updateCount: 3,
        noticeSentAtMs: 3_000,
      },
    });
    const reset = resolveTelegramRateLimit({
      config,
      nowMs: 61_000,
      previousState: limited.state,
    });

    expect(reset.allowed).toBe(true);
    expect(reset.state).toEqual({
      windowStartedAtMs: 61_000,
      updateCount: 1,
      noticeSentAtMs: null,
    });
  });

  it("bounds environment-provided rate limit values", () => {
    expect(readTelegramRateLimitConfig({
      TELEGRAM_RATE_LIMIT_WINDOW_SECONDS: "2",
      TELEGRAM_RATE_LIMIT_MAX_UPDATES: "2",
      TELEGRAM_RATE_LIMIT_NOTICE_COOLDOWN_SECONDS: "99999",
    })).toEqual({
      windowMs: 10_000,
      maxUpdates: 5,
      noticeCooldownMs: 3_600_000,
    });
  });
});
