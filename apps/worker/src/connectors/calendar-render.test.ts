import { describe, expect, it } from "vitest";
import {
  readCalendarDate,
  renderCalendarEvents,
  renderOptionalCalendarEventLines,
} from "./calendar-render.js";

describe("renderCalendarEvents", () => {
  it("renders calendar event summaries", () => {
    const text = renderCalendarEvents("primary", [{
      id: "event-1",
      summary: "Standup",
      location: "Zoom",
      description: "Daily sync",
      hangoutLink: "https://meet.example.com/abc",
      organizer: { email: "lead@example.com", displayName: "Lead" },
      start: { dateTime: "2026-01-01T09:00:00Z" },
      end: { dateTime: "2026-01-01T09:15:00Z" },
      attendees: [{ email: "a@example.com", responseStatus: "accepted" }],
    }]);

    expect(text).toContain("Google Calendar: primary");
    expect(text).toContain("Event: Standup");
    expect(text).toContain("a@example.com (accepted)");
    expect(text).toContain("Location: Zoom");
    expect(text).toContain("Meeting link: https://meet.example.com/abc");
  });
});

describe("renderOptionalCalendarEventLines", () => {
  it("renders optional calendar metadata", () => {
    const lines = renderOptionalCalendarEventLines({
      location: "HQ",
      hangoutLink: "https://meet.example.com/room",
      description: "Weekly planning",
      organizer: { email: "lead@example.com" },
      attendees: [{ email: "a@example.com" }],
    });

    expect(lines.join("\n")).toContain("Location: HQ");
    expect(lines.join("\n")).toContain("Weekly planning");
  });
});

describe("readCalendarDate", () => {
  it("prefers dateTime over all-day dates", () => {
    expect(readCalendarDate({ dateTime: "2026-01-01T09:00:00Z" })).toBe("2026-01-01T09:00:00Z");
    expect(readCalendarDate({ date: "2026-01-01" })).toBe("2026-01-01");
  });
});
