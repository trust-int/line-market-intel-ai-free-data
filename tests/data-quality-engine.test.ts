import { describe, expect, it } from "vitest";
import { calculateDataQuality } from "../src/analysis/data-quality-engine.js";

describe("data quality engine", () => {
  it("scores all live official sources as high", () => {
    const result = calculateDataQuality({
      sourceStatus: { twse: "ok", tpex: "ok", mops: "ok" },
      hasMarketData: true,
      dataGaps: []
    });
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.level).toBe("high");
  });

  it("scores all fixture fallback as fixture_only", () => {
    const result = calculateDataQuality({
      sourceStatus: { twse: "network_error", twse_mi_index: "fixture_fallback_from_network_error" },
      hasMarketData: true,
      dataGaps: ["twse_live_fetch_network_error"]
    });
    expect(result.score).toBeLessThanOrEqual(30);
    expect(result.level).toBe("fixture_only");
  });

  it("scores metadata only as low", () => {
    const result = calculateDataQuality({
      sourceStatus: { line_attachments: "metadata_only" },
      hasMarketData: false,
      hasLineOrManualNews: true,
      hasOnlyMetadata: true,
      dataGaps: ["ocr_not_enabled"]
    });
    expect(result.level).toBe("low");
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.score).toBeLessThanOrEqual(25);
  });
});
