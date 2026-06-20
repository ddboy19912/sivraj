import "./env.js";
import { startWorker } from "./worker-dependencies.js";

export const serviceName = "sivraj-worker";

process.on("unhandledRejection", (reason) => {
  console.error(`${serviceName} unhandled rejection`, reason);
});

process.on("uncaughtException", (error) => {
  console.error(`${serviceName} uncaught exception`, error);
  process.exitCode = 1;
});

startWorker(serviceName).catch((error: unknown) => {
  console.error(`${serviceName} failed`, error);
  process.exitCode = 1;
});
