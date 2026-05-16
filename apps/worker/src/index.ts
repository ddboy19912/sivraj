import { runHealthJob } from "./jobs/health";

export const serviceName = "sivraj-worker";

async function main() {
  console.log(`${serviceName} booting`);

  await runHealthJob();

  console.log(`${serviceName} ready`);
}

main().catch((error: unknown) => {
  console.error(`${serviceName} failed`, error);
  process.exitCode = 1;
});
