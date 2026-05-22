import type { Queryable } from "../db/client.js";
import { db } from "../db/client.js";
import type { NewsItem } from "../providers/news/provider.js";

export class NewsEventsRepo {
  constructor(private readonly database: Queryable = db) {}

  async upsertNewsEvents(rows: NewsItem[]): Promise<number> {
    let count = 0;
    for (const row of rows) {
      await this.database.query(
        `insert into news_events (
          source, source_url, source_type, title, summary, raw_text, tickers,
          topics, macro_tags, credibility_score, license_status, published_at, fetched_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        on conflict do nothing`,
        [
          row.source,
          row.sourceUrl,
          "official_public",
          row.title,
          row.summary,
          row.rawText,
          row.tickers ?? [],
          row.topics ?? [],
          row.macroTags ?? [],
          row.credibilityScore,
          row.licenseStatus,
          row.publishedAt,
          row.fetchedAt
        ]
      );
      count += 1;
    }
    return count;
  }
}
