import { describe, expect, it } from "vitest";
import { buildManualGptPack } from "../src/extract/manual-pack.js";

describe("manual_gpt_pack", () => {
  it("renders the fixed 2026-05-07 template with data gaps and source status", () => {
    const pack = buildManualGptPack({
      date: "2026-05-07",
      packType: "postmarket",
      officialMarketSnapshot: { trade_date: "2026-05-07", market_bias: "neutral", data_quality_score: 70 },
      signalEngineResult: { market_bias: "neutral", market_phase: "pullback", big_money_strategy: ["wait"], risk_flags: [], sector_strength: [], ticker_candidates: [], data_quality_score: 70 },
      sectorStrength: [],
      tickerCandidates: [{ ticker: "2330", candidate_type: "watch", side: "neutral", stage: "未發動", score: 35, confidence_score: 25, triggers: ["需要盤中確認"], risks: ["只有消息催化"], rationale: ["MOPS 重大訊息"], data_gaps: ["ticker_ohlcv_missing"] }],
      mopsMaterialNews: [{ source: "mops", title: "2330 重大訊息", tickers: ["2330"], licenseStatus: "official_public" }],
      lineManualNewsEvents: [{ source: "line", title: "2330 LINE 摘要", tickers: ["2330"], licenseStatus: "user_provided" }],
      uploadedAttachmentsMetadata: [{ file_name: "a.pdf", private_path: "C:/secret/a.pdf", content_sha256: "abc" }],
      dataSourceStatus: { twse: "tls_error", futu: "disabled" },
      costGuardStatus: { ai_mode: "manual", paid_data_api_used: false },
      dataGaps: ["twse_live_fetch_tls_error"],
      riskFlags: [{ flag: "data_quality_gap" }],
      evidence: [{ type: "data_gap", gap: "twse_live_fetch_tls_error" }]
    });
    const markdown = pack.files["manual_gpt_pack.md"] ?? "";
    expect(markdown).toContain("## 1. 今日市場狀態");
    expect(markdown).toContain("## 11. 明日觀察重點");
    expect(markdown).toContain("twse_live_fetch_tls_error");
    expect(markdown).toContain("data_source_status");
    expect(markdown).not.toContain("private_path");
    expect(markdown).not.toContain("win_rate");
  });
});
