import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

loadNearestEnv();

function loadNearestEnv() {
  let directory = dirname(fileURLToPath(import.meta.url));
  const root = parse(directory).root;

  while (true) {
    const envPath = join(directory, ".env");

    if (existsSync(envPath)) {
      config({ path: envPath });
      return;
    }

    if (directory === root) {
      config();
      return;
    }

    directory = dirname(directory);
  }
}
