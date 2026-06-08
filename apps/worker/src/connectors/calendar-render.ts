type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
  hangoutLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
};

export function renderCalendarEvents(calendarId: string, events: GoogleCalendarEvent[]): string {
  const lines = [`Google Calendar: ${calendarId}`, ""];

  for (const event of events) {
    lines.push(...renderCalendarEventLines(event));
  }

  return lines.join("\n").trim();
}

function renderCalendarEventLines(event: GoogleCalendarEvent): string[] {
  const title = event.summary?.trim() || "Untitled event";
  const lines = [
    `Event: ${title}`,
    `ID: ${event.id ?? "unknown"}`,
    `When: ${readCalendarDate(event.start)} - ${readCalendarDate(event.end)}`,
    ...renderOptionalCalendarEventLines(event),
    "",
  ];

  return lines;
}

export function renderOptionalCalendarEventLines(event: GoogleCalendarEvent): string[] {
  const lines: string[] = [];

  if (event.location) {
    lines.push(`Location: ${event.location}`);
  }

  if (event.organizer?.email || event.organizer?.displayName) {
    lines.push(
      `Organizer: ${event.organizer.displayName ?? event.organizer.email} <${event.organizer.email ?? "unknown"}>`,
    );
  }

  if (event.attendees?.length) {
    lines.push(`Attendees: ${event.attendees.map(renderCalendarAttendee).join(", ")}`);
  }

  if (event.hangoutLink) {
    lines.push(`Meeting link: ${event.hangoutLink}`);
  }

  if (event.description) {
    lines.push(`Description: ${event.description.replace(/\s+/g, " ").trim()}`);
  }

  return lines;
}

export function readCalendarDate(value: GoogleCalendarEvent["start"]): string {
  return value?.dateTime ?? value?.date ?? "unknown";
}

function renderCalendarAttendee(
  attendee: NonNullable<GoogleCalendarEvent["attendees"]>[number],
): string {
  const label = attendee.displayName ?? attendee.email ?? "unknown";
  return attendee.responseStatus ? `${label} (${attendee.responseStatus})` : label;
}
