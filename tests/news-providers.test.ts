import { describe, expect, it } from "vitest";
import { Jin10ManualProvider } from "../src/providers/news/jin10-manual.provider.js";
import { WallStreetCnManualProvider } from "../src/providers/news/wallstreetcn-manual.provider.js";

describe("manual news providers", () => {
  it("accepts Jin10 manual and LINE inputs only", () => {
    const provider = new Jin10ManualProvider();
    const item = provider.fromManualInput({ sourceChannel: "line", rawText: "金十消息：Fed 利率影響 2330" });
    expect(item.licenseStatus).toBe("user_provided");
    expect(item.tickers).toContain("2330");
    expect(() => provider.fromManualInput({ sourceChannel: "web_scrape" as never, rawText: "bad" })).toThrow();
  });

  it("accepts WallStreetCN manual summaries without crawling VIP content", () => {
    const provider = new WallStreetCnManualProvider();
    const item = provider.fromManualInput({ sourceChannel: "manual", title: "華爾街見聞摘要", summary: "美元與利率變化" });
    expect(item.source).toBe("wallstreetcn");
    expect(item.licenseStatus).toBe("user_provided");
  });
});
