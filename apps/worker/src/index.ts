import "./env.js";
import { startWorker } from "./worker-dependencies.js";

export const serviceName = "sivraj-worker";

startWorker(serviceName).catch((error: unknown) => {
  console.error(`${serviceName} failed`, error);
  process.exitCode = 1;
});
