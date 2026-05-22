import { config } from "../../config.js";
import { enforceProviderPolicy, type ProviderPolicy } from "../../cost/provider-policy.js";
import { extractTickers } from "../../normalize/ticker.js";
import { classifyTopics } from "../../normalize/topic.js";
import type { FetchNewsParams, ManualNewsInput, ManualNewsSourceChannel, NewsItem, NewsProvider } from "./provider.js";

export const allowedManualChannels: ManualNewsSourceChannel[] = ["line", "manual", "csv", "markdown"];

export abstract class ManualNewsProvider implements NewsProvider {
  abstract name: string;
  abstract policy: ProviderPolicy;
  protected sourceLabel = "manual";

  async fetchLatest(params: FetchNewsParams): Promise<NewsItem[]> {
    const resolved = enforceProviderPolicy(this.policy, config);
    if (resolved.status === "disabled") return [];
    return (params.manualItems ?? []).map((item) => this.fromManualInput(item));
  }

  fromManualInput(input: ManualNewsInput): NewsItem {
    assertAllowedManualChannel(this.name, input.sourceChannel);
    const rawText = input.rawText ?? input.summary ?? input.title ?? "";
    return {
      source: this.sourceLabel,
      sourceUrl: input.sourceUrl,
      title: (input.title ?? rawText.slice(0, 80)) || `${this.sourceLabel} manual item`,
      summary: input.summary ?? rawText.slice(0, 500),
      rawText,
      publishedAt: input.publishedAt,
      fetchedAt: new Date().toISOString(),
      topics: input.topics ?? classifyTopics(rawText),
      tickers: input.tickers ?? extractTickers(rawText),
      macroTags: input.macroTags ?? [],
      credibilityScore: input.sourceChannel === "line" ? 60 : 70,
      licenseStatus: "user_provided"
    };
  }
}

export function assertAllowedManualChannel(providerName: string, channel: string): void {
  if (!allowedManualChannels.includes(channel as ManualNewsSourceChannel)) {
    throw new Error(`${providerName} only accepts manual/LINE/CSV/Markdown inputs; got ${channel}`);
  }
}
