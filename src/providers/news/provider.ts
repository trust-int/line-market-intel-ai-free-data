import type { ProviderPolicy } from "../../cost/provider-policy.js";

export type ManualNewsSourceChannel = "line" | "manual" | "csv" | "markdown";

export type FetchNewsParams = {
  since?: string;
  until?: string;
  manualItems?: ManualNewsInput[];
};

export type ManualNewsInput = {
  sourceChannel: ManualNewsSourceChannel;
  title?: string;
  rawText?: string;
  summary?: string;
  sourceUrl?: string;
  publishedAt?: string;
  tickers?: string[];
  topics?: string[];
  macroTags?: string[];
};

export type NewsItem = {
  source: string;
  sourceUrl?: string;
  title: string;
  summary?: string;
  rawText?: string;
  publishedAt?: string;
  fetchedAt: string;
  topics: string[];
  tickers: string[];
  macroTags: string[];
  credibilityScore: number;
  licenseStatus: "official_public" | "user_provided" | "licensed" | "unknown";
};

export interface NewsProvider {
  name: string;
  policy: ProviderPolicy;
  fetchLatest(params: FetchNewsParams): Promise<NewsItem[]>;
}
