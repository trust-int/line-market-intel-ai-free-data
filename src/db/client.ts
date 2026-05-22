import pg from "pg";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

const { Pool } = pg;

export type Queryable = {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
};

class NoopDbClient implements Queryable {
  async query<T = unknown>(sql: string): Promise<{ rows: T[]; rowCount: number | null }> {
    logger.debug("DATABASE_URL not set; skipping database query", { sql: sql.slice(0, 80) });
    return { rows: [], rowCount: 0 };
  }
}

export function createDbClient(databaseUrl = config.databaseUrl): Queryable {
  if (!databaseUrl) return new NoopDbClient();
  return new Pool({
    connectionString: databaseUrl,
    max: 5,
    idleTimeoutMillis: 30_000
  });
}

export const db = createDbClient();
