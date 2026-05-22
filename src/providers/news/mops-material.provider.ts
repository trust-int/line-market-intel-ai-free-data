import { config } from "../../config.js";
import { enforceProviderPolicy, type ProviderPolicy } from "../../cost/provider-policy.js";
import { compactDate } from "../../utils/date.js";
import { fetchOfficialJson, rocDateToIso } from "../official/archive.js";
import type { FetchNewsParams, NewsItem, NewsProvider } from "./provider.js";

export type MopsMaterialRaw = {
  date?: string;
  data?: Array<Record<string, unknown>>;
  fields?: string[];
  html?: string;
  [key: string]: unknown;
};

export class MopsMaterialNewsProvider implements NewsProvider {
  name = "mops-material-news";
  policy: ProviderPolicy = {
    name: this.name,
    category: "news",
    enabled: config.enableMopsPublic,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "official_public",
    allowedWhenNoPaidApi: true,
    mode: config.enableMopsPublic ? "automatic" : "disabled",
    note: "MOPS public material information only. Stores summaries and links, not paid full text."
  };

  async fetchRaw(date: string): Promise<MopsMaterialRaw | undefined> {
    if (enforceProviderPolicy(this.policy).status === "disabled") return undefined;
    const rocYear = Number(date.slice(0, 4)) - 1911;
    const month = date.slice(5, 7);
    const day = date.slice(8, 10);
    const url =
      `https://mops.twse.com.tw/mops/web/ajax_t05st02?encodeURIComponent=1&step=1&step00=0&firstin=1&off=1&TYPEK=all&year=${rocYear}&month=${month}&day=${day}`;
    const raw = await fetchOfficialJson({ provider: this.name, dataset: "material-news", tradeDate: date, url });
    return raw as MopsMaterialRaw | undefined;
  }

  normalize(raw: MopsMaterialRaw, fallbackDate: string): NewsItem[] {
    if (Array.isArray(raw.data)) {
      return raw.data.map((row, index) => this.recordToNews(row, fallbackDate, index));
    }
    if (typeof raw.html === "string") return parseMopsHtml(raw.html, fallbackDate, this.name);
    return [];
  }

  async fetchLatest(params: FetchNewsParams): Promise<NewsItem[]> {
    const date = params.until?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const raw = await this.fetchRaw(date);
    return raw ? this.normalize(raw, date) : [];
  }

  private recordToNews(row: Record<string, unknown>, fallbackDate: string, index: number): NewsItem {
    const ticker = String(row["公司代號"] ?? row["co_id"] ?? row["companyCode"] ?? "");
    const company = String(row["公司簡稱"] ?? row["公司名稱"] ?? row["companyName"] ?? "");
    const title = String(row["主旨"] ?? row["title"] ?? row["公告主旨"] ?? "重大訊息");
    const rawDate = String(row["發言日期"] ?? row["日期"] ?? row["date"] ?? fallbackDate);
    const rawTime = String(row["發言時間"] ?? row["時間"] ?? row["time"] ?? "");
    const publishedAt = toPublishedAt(rawDate, rawTime, fallbackDate);
    return {
      source: "mops",
      sourceUrl: mopsDetailUrl(ticker, compactDate(fallbackDate), index),
      title: `${ticker ? `${ticker} ${company} ` : ""}${title}`.trim(),
      summary: title,
      rawText: title,
      publishedAt,
      fetchedAt: new Date().toISOString(),
      topics: ["重大訊息"],
      tickers: ticker ? [ticker] : [],
      macroTags: [],
      credibilityScore: 90,
      licenseStatus: "official_public"
    };
  }
}

function parseMopsHtml(html: string, fallbackDate: string, source: string): NewsItem[] {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const items: Array<NewsItem | undefined> = rows
    .map((match, index): NewsItem | undefined => {
      const cells = [...match[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) =>
        stripHtml(cell[1] ?? "")
      );
      const ticker = cells.find((cell) => /^\d{4}$/.test(cell)) ?? "";
      const title = cells.find((cell) => /公告|董事會|重大|說明|代/.test(cell)) ?? cells.at(-1) ?? "";
      if (!title || !ticker) return undefined;
      return {
        source,
        sourceUrl: mopsDetailUrl(ticker, compactDate(fallbackDate), index),
        title: `${ticker} ${title}`,
        summary: title,
        rawText: title,
        publishedAt: `${fallbackDate}T00:00:00+08:00`,
        fetchedAt: new Date().toISOString(),
        topics: ["重大訊息"],
        tickers: [ticker],
        macroTags: [],
        credibilityScore: 85,
        licenseStatus: "official_public" as const
      };
    });
  return items.filter((item): item is NewsItem => Boolean(item));
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function toPublishedAt(dateValue: string, timeValue: string, fallbackDate: string): string {
  const date = /^\d{2,3}[/-]/.test(dateValue) ? rocDateToIso(dateValue) : /^\d{8}$/.test(dateValue) ? `${dateValue.slice(0, 4)}-${dateValue.slice(4, 6)}-${dateValue.slice(6, 8)}` : fallbackDate;
  const time = /^\d{2}:\d{2}/.test(timeValue) ? timeValue : "00:00:00";
  return `${date}T${time.length === 5 ? `${time}:00` : time}+08:00`;
}

function mopsDetailUrl(ticker: string, yyyymmdd: string, index: number): string {
  return `https://mops.twse.com.tw/mops/web/t05st02?co_id=${encodeURIComponent(ticker)}&date=${yyyymmdd}&seq=${index}`;
}
