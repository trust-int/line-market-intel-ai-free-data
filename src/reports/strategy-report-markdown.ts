import type { StrategyReport } from "../analysis/schemas.js";
import type { SignalEngineResult } from "../analysis/signal-engine.js";
import type { SectorStrength } from "../analysis/sector-strength-engine.js";
import type { TickerCandidate } from "../analysis/ticker-candidate-engine.js";
import type { DailyMarketSnapshot } from "../market/daily-market-snapshot.js";
import type { DataQualityResult } from "../analysis/data-quality-engine.js";
import type { InstitutionalFlow, MarginShort } from "../providers/market/provider.js";
import type { NewsItem } from "../providers/news/provider.js";

export type DailyE2EReportMarkdownInput = {
  date: string;
  snapshot: DailyMarketSnapshot;
  signalEngineResult: SignalEngineResult;
  strategyReport: StrategyReport;
  sectorStrength: SectorStrength[];
  tickerCandidates: TickerCandidate[];
  institutionalFlows: InstitutionalFlow[];
  marginShort: MarginShort[];
  mopsMaterialNews: NewsItem[];
  sourceStatus: Record<string, string>;
  dataGaps: string[];
  dataQuality?: DataQualityResult;
  manualPackDir?: string;
};

export function renderDailyE2EReportMarkdown(input: DailyE2EReportMarkdownInput): string {
  const watchCandidates = input.tickerCandidates.filter((item) =>
    ["hold", "reduce", "watch"].includes(item.candidate_type)
  );
  const daytradeCandidates = input.tickerCandidates.filter((item) => item.candidate_type.startsWith("daytrade"));
  const swingCandidates = input.tickerCandidates.filter((item) => item.candidate_type === "swing");
  return [
    `# ${input.date} 台股 Daily E2E Dry Run`,
    "",
    "## 今日市場狀態",
    snapshotSummary(input.snapshot),
    "",
    "## 多空判斷",
    `- 市場判斷：${input.strategyReport.market.bias}`,
    `- market_bias：${input.signalEngineResult.market_bias}`,
    `- market_phase：${phaseLabel(input.signalEngineResult.market_phase)}`,
    `- confidence_score：${input.strategyReport.market.likely_paths[0]?.confidence_score ?? input.signalEngineResult.data_quality_score}`,
    "",
    "## 可能走勢",
    renderLikelyPaths(input.strategyReport.market.likely_paths),
    "",
    "## 大戶策略推估",
    renderBigMoney(input.signalEngineResult),
    "",
    "## 強勢族群",
    input.sectorStrength.length ? renderSectors(input.sectorStrength) : "- 資料不足，未列強勢族群。",
    "",
    "## 續抱觀察",
    watchCandidates.length ? renderTickerCandidates(watchCandidates) : "- 資料不足，未列續抱觀察標的。",
    "",
    "## 當沖候選",
    daytradeCandidates.length ? renderTickerCandidates(daytradeCandidates) : "- 資料不足，未列當沖候選。",
    "",
    "## 波段候選",
    swingCandidates.length ? renderTickerCandidates(swingCandidates) : "- 資料不足，未列波段候選。",
    "",
    "## 風險警訊",
    input.signalEngineResult.risk_flags.length
      ? input.signalEngineResult.risk_flags.map((flag) => `- ${flag}`).join("\n")
      : "- 無明確風險旗標；仍需以資料品質為準。",
    "",
    "## 資料品質",
    input.dataQuality ? renderDataQuality(input.dataQuality) : `- data_quality_score：${input.snapshot.data_quality_score}`,
    "",
    "## 資料缺口",
    input.dataGaps.length ? input.dataGaps.map((gap) => `- ${gap}`).join("\n") : "- 無資料缺口。",
    "",
    "## 明日觀察重點",
    renderTomorrowWatch(input.mopsMaterialNews, input.tickerCandidates),
    "",
    "## 官方資料",
    "### data_source_status",
    jsonBlock(input.sourceStatus),
    "### daily_market_snapshot",
    jsonBlock(input.snapshot),
    "### Institutional Flows",
    jsonBlock(input.institutionalFlows),
    "### Margin / Short",
    jsonBlock(input.marginShort),
    "### MOPS Material News",
    jsonBlock(input.mopsMaterialNews),
    "",
    "## cost_guard_status",
    jsonBlock(input.strategyReport.cost_guard),
    "",
    "## manual_gpt_pack",
    input.manualPackDir ? `- ${input.manualPackDir}` : "- not_written",
    "",
    "## 重要限制",
    "- 不使用付費資料 API。",
    "- Futu 維持 disabled；只標示狀態，不提示購買行情卡。",
    "- 僅供研究，沒有交易執行指令。",
    "- 未提供合格回測樣本時，只輸出 confidence_score，不輸出勝率欄位。"
  ].join("\n");
}

function renderDataQuality(dataQuality: DataQualityResult): string {
  return [
    `- score：${dataQuality.score}`,
    `- level：${dataQuality.level}`,
    ...dataQuality.reasons.map((reason) => `- reason：${reason}`)
  ].join("\n");
}

function snapshotSummary(snapshot: DailyMarketSnapshot): string {
  return [
    `- TAIEX close：${formatValue(snapshot.taiex_close)}`,
    `- TAIEX change pct：${formatValue(snapshot.taiex_change_pct)}`,
    `- TPEx close：${formatValue(snapshot.otc_close)}`,
    `- TPEx change pct：${formatValue(snapshot.otc_change_pct)}`,
    `- advance / decline：${formatValue(snapshot.advance_count)} / ${formatValue(snapshot.decline_count)}`,
    `- risk_level：${snapshot.risk_level}`,
    `- data_quality_score：${snapshot.data_quality_score}`
  ].join("\n");
}

function renderLikelyPaths(paths: StrategyReport["market"]["likely_paths"]): string {
  if (!paths.length) return "- 資料不足，未列可能走勢。";
  return paths
    .map((path) => [
      `- ${path.scenario}，confidence_score ${path.confidence_score}`,
      `  - confirmation: ${path.confirmation.join(" / ") || "資料不足"}`,
      `  - rejection: ${path.rejection.join(" / ") || "資料不足"}`
    ].join("\n"))
    .join("\n");
}

function renderBigMoney(signal: SignalEngineResult): string {
  const strategy = signal.big_money_strategy.join(", ");
  if (strategy === "wait") {
    return "- big_money_strategy：wait。無明顯方向，不臆測誘多、誘空、吃貨或出貨。";
  }
  return `- big_money_strategy：${strategy}`;
}

function renderSectors(sectors: SectorStrength[]): string {
  return sectors.map((sector) =>
    [
      `- ${sector.theme}：score ${sector.score}，phase ${sector.phase}`,
      `  - leaders: ${sector.leaders.join(", ") || "資料不足"}`,
      `  - evidence: ${sector.evidence.join(" / ") || "資料不足"}`,
      `  - risks: ${sector.risks.join(" / ") || "無"}`
    ].join("\n")
  ).join("\n");
}

function renderTickerCandidates(candidates: TickerCandidate[]): string {
  return candidates.map((candidate) =>
    [
      `- ${candidate.ticker}${candidate.name ? ` ${candidate.name}` : ""}：${candidate.candidate_type} / ${candidate.side}`,
      `  - score: ${candidate.score}, confidence_score: ${candidate.confidence_score}`,
      `  - triggers: ${candidate.triggers.join(" / ") || "需要確認"}`,
      `  - risks: ${candidate.risks.join(" / ") || "無"}`,
      `  - rationale: ${candidate.rationale.join(" / ") || "資料不足"}`,
      `  - data_gaps: ${candidate.data_gaps.join(" / ") || "無"}`
    ].join("\n")
  ).join("\n");
}

function renderTomorrowWatch(news: NewsItem[], candidates: TickerCandidate[]): string {
  const rows = new Map<string, string>();
  for (const item of news) {
    for (const ticker of item.tickers ?? []) {
      rows.set(ticker, "MOPS 重大訊息催化，需等待量價與籌碼確認，不直接建議買進。");
    }
  }
  for (const candidate of candidates.filter((item) => item.candidate_type === "watch")) {
    rows.set(candidate.ticker, "觀察名單，需等待資料補齊與盤中確認。");
  }
  if (!rows.size) return "- 資料不足，未列明日觀察重點。";
  return [...rows.entries()].map(([ticker, reason]) => `- ${ticker}：${reason}`).join("\n");
}

function phaseLabel(phase: SignalEngineResult["market_phase"]): string {
  const labels: Record<SignalEngineResult["market_phase"], string> = {
    trend_up: "trend_up / 趨勢向上",
    pullback: "pullback / 拉回整理",
    distribution: "distribution / 分配",
    panic: "panic / 恐慌",
    rebound: "rebound / 反彈"
  };
  return labels[phase];
}

function jsonBlock(value: unknown): string {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

function formatValue(value: unknown): string {
  return value == null ? "資料不足" : String(value);
}
