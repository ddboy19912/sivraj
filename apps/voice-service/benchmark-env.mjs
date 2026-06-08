import { readFileSync } from "node:fs";

export function readEnv() {
  return Object.fromEntries(
    readFileSync(new URL("../../.env", import.meta.url), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const value = line.slice(index + 1).replace(/^['"]|['"]$/g, "");
        return [line.slice(0, index), value];
      }),
  );
}
