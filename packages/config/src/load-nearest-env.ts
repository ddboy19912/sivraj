import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

export type LoadNearestEnvOptions = {
  quiet?: boolean;
  /** Module URL or file path used as the starting directory for `.env` discovery. */
  from?: string | URL;
};

export function loadNearestEnv(options: LoadNearestEnvOptions = {}): void {
  const startPath = options.from ?? import.meta.url;
  let directory = dirname(
    typeof startPath === "string" && !startPath.startsWith("file:")
      ? startPath
      : fileURLToPath(startPath),
  );
  const root = parse(directory).root;
  const dotenvOptions = options.quiet ? { quiet: true as const } : undefined;

  while (true) {
    const envPath = join(directory, ".env");

    if (existsSync(envPath)) {
      config({ path: envPath, ...dotenvOptions });
      return;
    }

    if (directory === root) {
      config(dotenvOptions);
      return;
    }

    directory = dirname(directory);
  }
}
