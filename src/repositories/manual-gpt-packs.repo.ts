import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";

export type ManualGptPackRecord = {
  pack_date: string;
  pack_type: string;
  markdown: string;
  json_payload?: unknown;
};

export class ManualGptPacksRepo {
  constructor(private readonly database: Queryable = db) {}

  async upsertManualGptPack(record: ManualGptPackRecord): Promise<ManualGptPackRecord> {
    const result = await this.database.query<ManualGptPackRecord>(
      `insert into manual_gpt_packs (pack_date, pack_type, markdown, json_payload)
       values ($1,$2,$3,$4)
       on conflict (pack_date, pack_type) do update set
         markdown = excluded.markdown,
         json_payload = excluded.json_payload,
         created_at = now()
       returning pack_date, pack_type, markdown, json_payload`,
      [record.pack_date, record.pack_type, record.markdown, record.json_payload]
    );
    return result.rows[0] ?? record;
  }

  async getManualGptPack(date: string, packType = "postmarket"): Promise<ManualGptPackRecord | undefined> {
    const result = await this.database.query<ManualGptPackRecord>(
      "select pack_date, pack_type, markdown, json_payload from manual_gpt_packs where pack_date = $1 and pack_type = $2 limit 1",
      [date, packType]
    );
    return result.rows[0];
  }
}
