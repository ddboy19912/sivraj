export type BehaviorPatternMetadata = {
  patternKey: string;
  patternTags: string[];
};

type BehaviorPatternDefinition = {
  subject: string;
  tags: string[];
  matches(text: string): boolean;
};

const BEHAVIOR_PATTERNS: Record<string, BehaviorPatternDefinition> = {
  launch_delay_ui_polish: {
    subject: "Launch delay from UI polish",
    tags: ["launch", "delay", "ui_polish"],
    matches(text) {
      const launch = /\b(launch|launching|launched|ship|shipping|release|released)\b/.test(text);
      const delay = /\b(delay|delayed|delaying|slip|slipping|postpone|postponed|blocked|slow)\b/.test(text);
      const polish = /\b(polish|polishing|redesign|redesigning|dashboard|ui|interface|perfect|perfection)\b/.test(text);

      return launch && delay && polish;
    },
  },
};

export function inferBehaviorPatternMetadata(input: {
  statement: string;
  normalizedStatement?: string | null;
  subject?: string | null;
  metadata?: Record<string, unknown>;
}): BehaviorPatternMetadata | null {
  const text = [
    input.statement,
    input.normalizedStatement ?? "",
    input.subject ?? "",
    ...Object.values(input.metadata ?? {}).filter((value): value is string => typeof value === "string"),
  ].join(" ").toLowerCase();

  for (const [patternKey, definition] of Object.entries(BEHAVIOR_PATTERNS)) {
    if (definition.matches(text)) {
      return {
        patternKey,
        patternTags: definition.tags,
      };
    }
  }

  return null;
}

export function behaviorPatternSubject(patternKey: string): string {
  return BEHAVIOR_PATTERNS[patternKey]?.subject ?? patternKey.replace(/_/g, " ");
}
