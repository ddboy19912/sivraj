import { createDb, createPool } from "@sivraj/db";

export function createWorkerDb(connectionString: string) {
  const pool = createPool(connectionString);

  return {
    db: createDb(pool),
    async close() {
      await pool.end();
    },
  };
}
