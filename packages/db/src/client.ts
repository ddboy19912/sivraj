import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export function createDb(pool: pg.Pool) {
  return drizzle(pool, { schema });
}

export type Db = ReturnType<typeof createDb>;
