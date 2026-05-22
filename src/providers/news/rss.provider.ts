import { config } from "../../config.js";
import { enforceProviderPolicy, type ProviderPolicy } from "../../cost/provider-policy.js";
import type { FetchNewsParams, NewsItem, NewsProvider } from "./provider.js";

export class RssProvider implements NewsProvider {
  name = "rss-public";
  policy: ProviderPolicy = {
    name: this.name,
    category: "news",
    enabled: config.enableRssPublic,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: config.enableRssPublic,
    licenseStatus: config.enableRssPublic ? "free_public" : "unknown",
    allowedWhenNoPaidApi: true,
    mode: config.enableRssPublic ? "automatic" : "disabled",
    note: "Only explicitly free public RSS feeds are allowed. Disabled by default."
  };

  constructor(private readonly feedUrls: string[] = []) {}

  async fetchLatest(_params: FetchNewsParams): Promise<NewsItem[]> {
    const resolved = enforceProviderPolicy(this.policy, config);
    if (resolved.status === "disabled" || config.disableNewsScraping) return [];
    if (this.feedUrls.length === 0) return [];
    return [];
  }
}
