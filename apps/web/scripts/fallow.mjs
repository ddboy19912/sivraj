import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const monorepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = ["fallow", "-w", "@sivraj/web", ...process.argv.slice(2)];
const result = spawnSync("npx", args, {
  cwd: monorepoRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
