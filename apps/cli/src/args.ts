export type ParsedCliArgs = {
  command: string | null;
  options: Record<string, string | boolean | string[]>;
  positionals: string[];
};

export function parseArgs(argv: string[]): ParsedCliArgs {
  const [command = null, ...rest] = argv;
  const options: ParsedCliArgs["options"] = {};
  const positionals: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const raw = token.slice(2);
    const equalsIndex = raw.indexOf("=");
    const key = toCamelCase(equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw);
    const inlineValue = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : null;

    if (inlineValue !== null) {
      addOption(options, key, inlineValue);
      continue;
    }

    const next = rest[index + 1];

    if (!next || next.startsWith("--")) {
      addOption(options, key, true);
      continue;
    }

    addOption(options, key, next);
    index += 1;
  }

  return { command, options, positionals };
}

export function readStringOption(
  options: ParsedCliArgs["options"],
  key: string,
): string | undefined {
  const value = options[key];

  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

export function readBooleanOption(
  options: ParsedCliArgs["options"],
  key: string,
  fallback: boolean,
): boolean {
  const value = options[key];

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }
  }

  return fallback;
}

export function readNumberOption(
  options: ParsedCliArgs["options"],
  key: string,
): number | undefined {
  const value = options[key];
  const parsed = typeof value === "string" ? Number(value) : NaN;

  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function readListOption(
  options: ParsedCliArgs["options"],
  key: string,
): string[] | undefined {
  const value = options[key];

  if (Array.isArray(value)) {
    return value.flatMap(splitList).filter(Boolean);
  }

  if (typeof value === "string") {
    return splitList(value);
  }

  return undefined;
}

function addOption(
  options: ParsedCliArgs["options"],
  key: string,
  value: string | boolean,
): void {
  const existing = options[key];

  if (existing === undefined) {
    options[key] = value;
    return;
  }

  options[key] = Array.isArray(existing)
    ? [...existing, String(value)]
    : [String(existing), String(value)];
}

function splitList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}
