import { resolveDatabaseUrl, type EnvSource } from "@sivraj/config";
import { createDb, createPool } from "@sivraj/db";

const pool = createPool(resolveDatabaseUrl(process.env as EnvSource));

export const db = createDb(pool);
