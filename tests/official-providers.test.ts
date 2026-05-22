import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { TwsePublicProvider } from "../src/providers/market/twse-public.provider.js";
import { TpexPublicProvider } from "../src/providers/market/tpex-public.provider.js";
import { MopsMaterialNewsProvider } from "../src/providers/news/mops-material.provider.js";

async function fixture<T>(name: string): Promise<T> {
  const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  return JSON.parse(text) as T;
}

describe("official market providers", () => {
  it("normalizes TWSE listed daily prices, index, breadth, institutional and margin", async () => {
    const provider = new TwsePublicProvider();
    const mi = await fixture<Record<string, unknown>>("twse-mi-index.json");
    const t86 = await fixture<Record<string, unknown>>("twse-t86.json");
    const margin = await fixture<Record<string, unknown>>("twse-margin.json");
    expect(provider.normalizeDailyPrices(mi, "2026-05-07")[0]).toMatchObject({ symbol: "2330", close: 1005 });
    expect(provider.normalizeMarketIndex(mi, "2026-05-07")[0]).toMatchObject({ symbol: "TAIEX", close: 23500.25 });
    expect(provider.normalizeMarketBreadth(mi, "2026-05-07")).toMatchObject({ advanceCount: 615, declineCount: 362 });
    expect(provider.normalizeInstitutionalFlows(t86, "2026-05-07")[0]).toMatchObject({ ticker: "2330", foreignNet: 1000000 });
    expect(provider.normalizeMarginShort(margin, "2026-05-07")[0]).toMatchObject({ ticker: "2330", marginChange: 20 });
  });

  it("normalizes TPEx OTC daily prices, index, breadth, institutional and margin", async () => {
    const provider = new TpexPublicProvider();
    const daily = await fixture<Record<string, unknown>[]>("tpex-daily.json");
    const index = await fixture<Record<string, unknown>[]>("tpex-index.json");
    const inst = await fixture<Record<string, unknown>[]>("tpex-3insti.json");
    const margin = await fixture<Record<string, unknown>[]>("tpex-margin.json");
    expect(provider.normalizeDailyPrices(daily, "2026-05-07")[0]).toMatchObject({ symbol: "6488", close: 500 });
    expect(provider.normalizeMarketIndex(index, "2026-05-07")[0]).toMatchObject({ symbol: "TPEx", close: 250.5 });
    expect(provider.normalizeMarketBreadth(index, "2026-05-07")).toMatchObject({ advanceCount: 320, declineCount: 410 });
    expect(provider.normalizeInstitutionalFlows(inst, "2026-05-07")[0]).toMatchObject({ ticker: "6488", totalNet: 85000 });
    expect(provider.normalizeMarginShort(margin, "2026-05-07")[0]).toMatchObject({ ticker: "6488", shortChange: -20 });
  });

  it("normalizes MOPS material news", async () => {
    const provider = new MopsMaterialNewsProvider();
    const raw = await fixture<Record<string, unknown>>("mops-material.json");
    const [item] = provider.normalize(raw, "2026-05-07");
    expect(item).toMatchObject({ source: "mops", tickers: ["2330"], licenseStatus: "official_public" });
  });
});
