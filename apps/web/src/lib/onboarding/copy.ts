export function parseCommaList(value: string): string[] {
  return Array.from(new Set(value.split(",").flatMap((item) => {
    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  })));
}
