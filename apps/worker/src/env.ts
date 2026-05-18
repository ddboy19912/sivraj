import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const currentDir = dirname(fileURLToPath(import.meta.url));

for (const envPath of candidateEnvPaths(currentDir)) {
  if (existsSync(envPath)) {
    config({ path: envPath });
    break;
  }
}

function candidateEnvPaths(startDir: string): string[] {
  const paths: string[] = [];
  let dir = startDir;

  for (let depth = 0; depth < 6; depth += 1) {
    paths.push(join(dir, ".env"));
    const parent = dirname(dir);

    if (parent === dir) {
      break;
    }

    dir = parent;
  }

  return paths;
}
