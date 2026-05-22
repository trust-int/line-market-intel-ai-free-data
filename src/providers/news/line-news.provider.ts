import { type ProviderPolicy } from "../../cost/provider-policy.js";
import { extractTickers } from "../../normalize/ticker.js";
import { classifyTopics } from "../../normalize/topic.js";
import type { FetchNewsParams, NewsItem, NewsProvider } from "./provider.js";

export type LineNewsRow = {
  raw_text?: string;
  extracted_text?: string;
  message_time?: string;
  tickers?: string[];
  topics?: string[];
};

export class LineNewsProvider implements NewsProvider {
  name = "line-news";
  policy: ProviderPolicy = {
    name: this.name,
    category: "line",
    enabled: true,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "user_provided",
    allowedWhenNoPaidApi: true,
    mode: "manual",
    note: "Normalizes user-provided LINE group content."
  };

  constructor(private readonly rows: LineNewsRow[] = []) {}

  async fetchLatest(_params: FetchNewsParams): Promise<NewsItem[]> {
    return this.rows.map((row) => {
      const text = row.extracted_text ?? row.raw_text ?? "";
      return {
        source: "line",
        title: text.slice(0, 80) || "LINE message",
        summary: text.slice(0, 500),
        rawText: text,
        publishedAt: row.message_time,
        fetchedAt: new Date().toISOString(),
        topics: row.topics ?? classifyTopics(text),
        tickers: row.tickers ?? extractTickers(text),
        macroTags: [],
        credibilityScore: 55,
        licenseStatus: "user_provided"
      };
    });
  }
}
