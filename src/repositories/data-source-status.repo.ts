import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";

export type DataSourceStatus = {
  name: string;
  status: "ok" | "empty" | "error" | "too_large" | string;
  reason: string | null;
  last_updated: string | null;
  payload_size_bytes: number | null;
};

export async function upsertDataSourceStatus(
  input: {
    sourceName: string;
    status: DataSourceStatus["status"];
    reason?: string | null;
    lastUpdated?: string | Date | null;
    payloadSizeBytes?: number | null;
  },
  database: Queryable = db
): Promise<void> {
  await database.query(
    `insert into data_source_status (
       source_name, status, reason, last_updated, payload_size_bytes
     ) values ($1,$2,$3,$4,$5)
     on conflict (source_name) do update set
       status = excluded.status,
       reason = excluded.reason,
       last_updated = excluded.last_updated,
       payload_size_bytes = excluded.payload_size_bytes,
       created_at = now()`,
    [
      input.sourceName,
      input.status,
      input.reason ?? null,
      input.lastUpdated ?? new Date(),
      input.payloadSizeBytes ?? null
    ]
  );
}

export async function listDataSourceStatuses(database: Queryable = db): Promise<DataSourceStatus[]> {
  const rows = await database.query<DataSourceStatus>(
    `select source_name as name, status, reason,
            last_updated::text as last_updated,
            payload_size_bytes
     from data_source_status
     order by source_name`
  );
  return rows.rows;
}
