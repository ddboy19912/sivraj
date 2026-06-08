export const DEFAULT_THEME_COLOR = "#1FD5F9" as const;

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

export function normalizeHexColor(value: string): `#${string}` {
  const trimmed = value.trim();
  const withHash = trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
  const match = withHash.match(HEX_COLOR_PATTERN);

  if (!match) {
    return DEFAULT_THEME_COLOR;
  }

  return `#${match[1]}${match[2]}${match[3]}`.toUpperCase() as `#${string}`;
}

export function hexToRgbChannels(hex: string): string {
  const normalized = normalizeHexColor(hex);
  const match = normalized.match(HEX_COLOR_PATTERN);

  if (!match) {
    return "31, 213, 249";
  }

  const [, r, g, b] = match;
  return `${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}`;
}
