import { describe, expect, it } from "vitest";
import {
  formatTelegramDate,
  resolveTelegramConnectionSubtitle,
  resolveTelegramStatusPresentation,
  telegramStatusDotClass,
} from "@/lib/telegram/telegram-state";

describe("Telegram integration state", () => {
  it("maps connection statuses to stable presentation", () => {
    expect(resolveTelegramStatusPresentation("linked")).toMatchObject({
      label: "Linked",
      tone: "active",
    });
    expect(resolveTelegramStatusPresentation("pending_link")).toMatchObject({
      label: "Pending",
      tone: "pending",
    });
    expect(resolveTelegramStatusPresentation("revoked")).toMatchObject({
      label: "Revoked",
      tone: "warning",
    });
  });

  it("formats dates without throwing on missing values", () => {
    expect(formatTelegramDate(null)).toBe("No date");
    expect(formatTelegramDate("not-a-date")).toBe("Unknown date");
  });

  it("does not show stale account names while pairing is pending", () => {
    const presentation = resolveTelegramStatusPresentation("pending_link");

    expect(resolveTelegramConnectionSubtitle({
      status: "pending_link",
      botUsername: "sivraj_twin_bot",
      account: {
        id: "account-1",
        status: "disconnected",
        displayName: "Telegram @old",
        externalAccountId: "123",
        metadata: null,
        createdAt: "2026-06-27T10:00:00.000Z",
        updatedAt: "2026-06-27T10:00:00.000Z",
      },
      pendingLink: {
        id: "token-1",
        expiresAt: "2026-06-27T10:15:00.000Z",
      },
      recentCaptures: [],
    }, presentation)).toBe("Waiting for Telegram confirmation.");
  });

  it("returns a visible status dot class for every tone", () => {
    expect(telegramStatusDotClass("active")).toContain("emerald");
    expect(telegramStatusDotClass("pending")).toContain("amber");
    expect(telegramStatusDotClass("warning")).toContain("orange");
    expect(telegramStatusDotClass("error")).toContain("rose");
    expect(telegramStatusDotClass("idle")).toContain("white");
  });
});
