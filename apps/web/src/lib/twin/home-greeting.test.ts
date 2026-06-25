import { describe, expect, it } from "vitest";
import {
  buildHomeSessionGreeting,
  homeSessionGreetingEventId,
  markHomeSessionGreetingAttempted,
  shouldPlayHomeSessionGreeting,
} from "@/lib/twin/home-greeting";

describe("home session greeting", () => {
  it("allows a fresh session greeting", () => {
    const storage = createStorage();

    expect(shouldPlayHomeSessionGreeting({ twinId: "twin-1", storage })).toBe(true);
  });

  it("blocks once the current session has attempted a greeting", () => {
    const storage = createStorage();

    markHomeSessionGreetingAttempted({
      twinId: "twin-1",
      greetingId: "help",
      storage,
      attemptedAt: new Date("2026-06-24T10:00:00.000Z"),
    });

    expect(shouldPlayHomeSessionGreeting({ twinId: "twin-1", storage })).toBe(false);
    expect(shouldPlayHomeSessionGreeting({ twinId: "twin-2", storage })).toBe(true);
  });

  it("treats malformed storage as eligible instead of crashing", () => {
    const storage = createStorage();
    storage.setItem("sivraj.homeGreeting.session.v1:twin-1", "{nope");

    expect(shouldPlayHomeSessionGreeting({ twinId: "twin-1", storage })).toBe(true);
  });

  it("tolerates unavailable storage", () => {
    const storage = createThrowingStorage();

    expect(shouldPlayHomeSessionGreeting({ twinId: "twin-1", storage })).toBe(true);
    expect(() =>
      markHomeSessionGreetingAttempted({
        twinId: "twin-1",
        greetingId: "help",
        storage,
      }),
    ).not.toThrow();
  });

  it("builds a named greeting from the approved set", () => {
    expect(buildHomeSessionGreeting({
      displayName: "Fortune",
      random: () => 0,
    })).toEqual({
      id: "with-you",
      text: "Hi Fortune. How's your day going?",
    });
  });

  it("requires a display name", () => {
    expect(() =>
      buildHomeSessionGreeting({
        displayName: " ",
        random: () => 0.4,
      }),
    ).toThrow("Home session greeting requires a display name.");
  });

  it("avoids the previous greeting id when possible", () => {
    const greeting = buildHomeSessionGreeting({
      displayName: "Fortune",
      previousGreetingId: "with-you",
      random: () => 0,
    });

    expect(greeting.id).toBe("good-see-you");
    expect(greeting.text).toBe("Hey Fortune. What are we working on today?");
  });

  it("builds stable runtime event ids", () => {
    expect(homeSessionGreetingEventId("twin:1", "with-you")).toBe(
      "home-session-greeting-twin-1-with-you",
    );
  });
});

function createStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

function createThrowingStorage(): Storage {
  return {
    get length() {
      return 0;
    },
    clear: () => undefined,
    getItem: () => {
      throw new Error("storage unavailable");
    },
    key: () => null,
    removeItem: () => undefined,
    setItem: () => {
      throw new Error("storage unavailable");
    },
  };
}
