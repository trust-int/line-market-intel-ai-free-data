import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ReportEngine } from "../analysis/report-engine.js";
import { calculateDataQuality, type DataQualityResult } from "../analysis/data-quality-engine.js";
import { config } from "../config.js";
import { SignalEngine } from "../analysis/signal-engine.js";
import { calculateSectorStrengthFromInput } from "../analysis/sector-strength-engine.js";
import { calculateTickerCandidatesFromInput } from "../analysis/ticker-candidate-engine.js";
import { buildManualGptPack, writeManualGptPack } from "../extract/manual-pack.js";
import { buildDailyMarketSnapshot, type DailyMarketSnapshot } from "../market/daily-market-snapshot.js";
import { MopsMaterialNewsProvider, type MopsMaterialRaw } from "../providers/news/mops-material.provider.js";
import type { NewsItem } from "../providers/news/provider.js";
import { TpexPublicProvider } from "../providers/market/tpex-public.provider.js";
import { TwsePublicProvider } from "../providers/market/twse-public.provider.js";
import type {
  IndexDaily,
  InstitutionalFlow,
  MarginShort,
  MarketBreadth,
  MarketInstitutionalSummary,
  MarketMarginSummary,
  StockDaily
} from "../providers/market/provider.js";
import {
  dataGapsFromLiveCheck,
  runLiveFetchCheck,
  sourceStatusFromLiveCheck,
  type LiveFetchCheckResult,
  type LiveFetchStatus
} from "../providers/health/live-fetch-check.js";
import { getOfficialDataMode, officialDataModeNotice, type OfficialDataMode } from "../official-data-mode.js";
import { renderDailyE2EReportMarkdown } from "../reports/strategy-report-markdown.js";
import { todayTaipei } from "../utils/date.js";
import { pushReportJob } from "./push-report.js";
import { saveReportArtifacts } from "./report-persistence.js";

export type E2EOfficialData = {
  indexes: IndexDaily[];
  stockDaily: StockDaily[];
  breadth: MarketBreadth[];
  institutionalSummaries: MarketInstitutionalSummary[];
  institutionalFlows: InstitutionalFlow[];
  marginSummaries: MarketMarginSummary[];
  marginShort: MarginShort[];
  mopsMaterialNews: NewsItem[];
  sourceStatus: Record<string, string>;
  dataGaps: string[];
};

export type DailyE2EDryRunResult = {
  date: string;
  reportPath: string;
  markdown: string;
  snapshot: DailyMarketSnapshot;
  sourceStatus: Record<string, string>;
  dataGaps: string[];
  dataQuality: DataQualityResult;
  paths: {
    reportMarkdown: string;
    reportJson: string;
    manualPackMarkdown: string;
    sourceStatus: string;
    dataQuality: string;
  };
};

export type DailyE2EDryRunOptions = {
  outputDir?: string;
  fixtureDir?: string;
  liveResults?: LiveFetchCheckResult[];
  officialData?: E2EOfficialData;
  writeManualPack?: boolean;
  mode?: OfficialDataMode;
  push?: boolean;
};

const DEFAULT_FIXTURE_DIR = path.resolve(process.cwd(), "tests", "fixtures");

type TwseMiIndexRaw = Parameters<TwsePublicProvider["normalizeMarketIndex"]>[0];
type TwseT86Raw = Parameters<TwsePublicProvider["normalizeInstitutionalFlows"]>[0];
type TwseMarginRaw = Parameters<TwsePublicProvider["normalizeMarginShort"]>[0];
type TpexOpenApiRows = Parameters<TpexPublicProvider["normalizeMarketIndex"]>[0];

export async function runDailyE2EDryRun(
  date = todayTaipei(),
  options: DailyE2EDryRunOptions = {}
): Promise<DailyE2EDryRunResult> {
  const mode = getOfficialDataMode(options.mode);
  const liveResults = options.liveResults ?? await runLiveFetchCheck(date);
  const officialData = options.officialData ?? await collectOfficialDataWithFixtureFallback(date, liveResults, {
    fixtureDir: options.fixtureDir,
    mode
  });
  const sourceStatus = {
    ...sourceStatusFromLiveCheck(liveResults),
    ...officialData.sourceStatus,
    futu: "disabled",
    no_paid_data_api: "ok",
    paid_market_data: "disabled"
  };
  const dataGaps = unique([
    ...dataGapsFromLiveCheck(liveResults),
    ...officialData.dataGaps
  ]);
  const dataQuality = calculateDataQuality({
    sourceStatus,
    dataGaps,
    hasMarketData: officialData.indexes.length > 0 || officialData.stockDaily.length > 0,
    hasLineOrManualNews: officialData.mopsMaterialNews.length > 0,
    hasOnlyMetadata: false
  });
  const snapshot = {
    ...buildDailyMarketSnapshot({
    tradeDate: date,
    indexes: officialData.indexes,
    breadth: officialData.breadth,
    institutional: officialData.institutionalSummaries,
    margin: officialData.marginSummaries,
    dataGaps,
    sourceStatus
    }),
    data_quality_score: dataQuality.score
  };
  const topicEvents = officialData.mopsMaterialNews.map((item) => ({
    tickers: item.tickers,
    topics: item.topics,
    source: item.source,
    official: item.licenseStatus === "official_public"
  }));
  const sectorResult = calculateSectorStrengthFromInput({
    marketDaily: officialData.stockDaily,
    watchlistThemes: [],
    topicEvents,
    institutionalFlows: officialData.institutionalFlows,
    marginShort: officialData.marginShort
  });
  const tickerResult = calculateTickerCandidatesFromInput({
    marketDaily: officialData.stockDaily,
    marketIntraday: [],
    institutionalFlows: officialData.institutionalFlows,
    marginShort: officialData.marginShort,
    newsEvents: officialData.mopsMaterialNews.map((item) => ({
      tickers: item.tickers,
      title: item.title,
      summary: item.summary,
      source: item.source,
      licenseStatus: item.licenseStatus
    })),
    sectorStrength: sectorResult.sectors
  });
  const allDataGaps = unique([
    ...dataGaps,
    ...sectorResult.data_gaps,
    ...tickerResult.data_gaps,
    ...(mode === "fixture" ? ["official_data_mode_fixture_test_data"] : [])
  ]);
  const finalDataQuality = calculateDataQuality({
    sourceStatus,
    dataGaps: allDataGaps,
    hasMarketData: officialData.indexes.length > 0 || officialData.stockDaily.length > 0,
    hasLineOrManualNews: officialData.mopsMaterialNews.length > 0,
    hasOnlyMetadata: false
  });
  snapshot.data_quality_score = finalDataQuality.score;
  const signalEngineResult = new SignalEngine().analyze({
    snapshot,
    sectorStrength: sectorResult.sectors,
    tickerCandidates: tickerResult.candidates,
    dataGaps: allDataGaps
  });
  const manualPack = buildManualGptPack({
    date,
    packType: "postmarket",
    officialMarketSnapshot: snapshot,
    institutionalFlows: officialData.institutionalFlows,
    marginShort: officialData.marginShort,
    mopsMaterialNews: officialData.mopsMaterialNews,
    lineManualNewsEvents: [],
    uploadedAttachmentsMetadata: [],
    signalEngineResult,
    sectorStrength: sectorResult.sectors,
    tickerCandidates: tickerResult.candidates,
    dataSourceStatus: sourceStatus,
    costGuardStatus: {
      ai_mode: "manual",
      openai_requests_today: 0,
      estimated_cost_today: 0,
      paid_data_api_used: false,
      official_data_mode: mode,
      official_data_mode_notice: officialDataModeNotice(mode)
    },
    dataGaps: allDataGaps,
    riskFlags: signalEngineResult.risk_flags.map((flag) => ({ flag })),
    evidence: allDataGaps.map((gap) => ({ type: "data_gap", gap }))
  });
  const manualPackDir = options.writeManualPack === false ? undefined : await writeManualGptPack(manualPack);
  const strategyReport = new ReportEngine().build({
    date,
    reportType: "postmarket",
    signalEngineResult,
    dataGaps: allDataGaps,
    costUsage: {
      date,
      openaiRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0
    }
  });
  let markdown = assertSafeReportMarkdown(renderDailyE2EReportMarkdown({
    date,
    snapshot,
    signalEngineResult,
    strategyReport,
    sectorStrength: signalEngineResult.sector_strength,
    tickerCandidates: signalEngineResult.ticker_candidates,
    institutionalFlows: officialData.institutionalFlows,
    marginShort: officialData.marginShort,
    mopsMaterialNews: officialData.mopsMaterialNews,
    sourceStatus,
    dataGaps: allDataGaps,
    dataQuality: finalDataQuality,
    manualPackDir
  }));
  if (!config.databaseUrl) {
    markdown = `${markdown}\n\n## DB Persistence\n- db_status: db_unavailable\n- note: DATABASE_URL 未設定，報告已保留檔案輸出，尚未寫入 production DB。\n`;
  }
  const outputDir = options.outputDir ?? path.resolve(process.cwd(), "outputs", "reports");
  await mkdir(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, `${date}.md`);
  const reportJsonPath = path.join(outputDir, `${date}.json`);
  const manualPackOutputDir = path.resolve(process.cwd(), "outputs", "manual-packs");
  const sourceStatusOutputDir = path.resolve(process.cwd(), "outputs", "source-status");
  const dataQualityOutputDir = path.resolve(process.cwd(), "outputs", "data-quality");
  await Promise.all([mkdir(manualPackOutputDir, { recursive: true }), mkdir(sourceStatusOutputDir, { recursive: true }), mkdir(dataQualityOutputDir, { recursive: true })]);
  const manualPackMarkdownPath = path.join(manualPackOutputDir, `${date}.md`);
  const sourceStatusPath = path.join(sourceStatusOutputDir, `${date}.json`);
  const dataQualityPath = path.join(dataQualityOutputDir, `${date}.json`);
  await writeFile(reportPath, markdown, "utf8");
  await writeFile(reportJsonPath, JSON.stringify({ strategyReport, signalEngineResult, snapshot, sourceStatus, dataGaps: allDataGaps, dataQuality: finalDataQuality }, null, 2), "utf8");
  await writeFile(manualPackMarkdownPath, manualPack.files["manual_gpt_pack.md"] ?? manualPack.markdown, "utf8");
  await writeFile(sourceStatusPath, JSON.stringify(sourceStatus, null, 2), "utf8");
  await writeFile(dataQualityPath, JSON.stringify(finalDataQuality, null, 2), "utf8");
  const persistence = await saveReportArtifacts(date, "postmarket").catch((error) => ({
    ok: false,
    date,
    report_type: "postmarket",
    error: String(error)
  }));
  await writeFile(reportJsonPath, JSON.stringify({ strategyReport, signalEngineResult, snapshot, sourceStatus, dataGaps: allDataGaps, dataQuality: finalDataQuality, persistence }, null, 2), "utf8");
  if (options.push) {
    await pushReportJob(date, "postmarket", {
      dataQualityPath,
      reportPath,
      enabled: true
    });
  }
  return {
    date,
    reportPath,
    markdown,
    snapshot,
    sourceStatus,
    dataGaps: allDataGaps,
    dataQuality: finalDataQuality,
    paths: {
      reportMarkdown: reportPath,
      reportJson: reportJsonPath,
      manualPackMarkdown: manualPackMarkdownPath,
      sourceStatus: sourceStatusPath,
      dataQuality: dataQualityPath
    }
  };
}

export async function collectOfficialDataWithFixtureFallback(
  date: string,
  liveResults: LiveFetchCheckResult[],
  options: { fixtureDir?: string; mode?: OfficialDataMode } = {}
): Promise<E2EOfficialData> {
  const fixtureDir = options.fixtureDir ?? DEFAULT_FIXTURE_DIR;
  const mode = getOfficialDataMode(options.mode);
  const twse = new TwsePublicProvider();
  const tpex = new TpexPublicProvider();
  const mops = new MopsMaterialNewsProvider();
  const providerStatus = statusByProvider(liveResults);
  const sourceStatus: Record<string, string> = {};
  const dataGaps: string[] = [];

  const twseMi = await loadLiveOrFixture<TwseMiIndexRaw>({
    key: "twse_mi_index",
    providerStatus: providerStatus.TWSE,
    live: () => twse.fetchDailyPricesRaw(date),
    fixture: () => readJson<TwseMiIndexRaw>(path.join(fixtureDir, "twse-mi-index.json")),
    sourceStatus,
    dataGaps,
    mode
  });
  const twseInstitutional = await loadLiveOrFixture<TwseT86Raw>({
    key: "twse_institutional",
    providerStatus: providerStatus.TWSE,
    live: () => twse.fetchInstitutionalRaw(date),
    fixture: () => readJson<TwseT86Raw>(path.join(fixtureDir, "twse-t86.json")),
    sourceStatus,
    dataGaps,
    mode
  });
  const twseMargin = await loadLiveOrFixture<TwseMarginRaw>({
    key: "twse_margin",
    providerStatus: providerStatus.TWSE,
    live: () => twse.fetchMarginRaw(date),
    fixture: () => readJson<TwseMarginRaw>(path.join(fixtureDir, "twse-margin.json")),
    sourceStatus,
    dataGaps,
    mode
  });
  const tpexDaily = await loadLiveOrFixture<TpexOpenApiRows>({
    key: "tpex_daily",
    providerStatus: providerStatus.TPEx,
    live: () => tpex.fetchDailyPricesRaw(date),
    fixture: () => readJson<TpexOpenApiRows>(path.join(fixtureDir, "tpex-daily.json")),
    sourceStatus,
    dataGaps,
    mode
  });
  const tpexIndex = await loadLiveOrFixture<TpexOpenApiRows>({
    key: "tpex_index",
    providerStatus: providerStatus.TPEx,
    live: () => tpex.fetchIndexRaw(date),
    fixture: () => readJson<TpexOpenApiRows>(path.join(fixtureDir, "tpex-index.json")),
    sourceStatus,
    dataGaps,
    mode
  });
  const tpexInstitutional = await loadLiveOrFixture<TpexOpenApiRows>({
    key: "tpex_institutional",
    providerStatus: providerStatus.TPEx,
    live: () => tpex.fetchInstitutionalRaw(date),
    fixture: () => readJson<TpexOpenApiRows>(path.join(fixtureDir, "tpex-3insti.json")),
    sourceStatus,
    dataGaps,
    mode
  });
  const tpexMargin = await loadLiveOrFixture<TpexOpenApiRows>({
    key: "tpex_margin",
    providerStatus: providerStatus.TPEx,
    live: () => tpex.fetchMarginRaw(date),
    fixture: () => readJson<TpexOpenApiRows>(path.join(fixtureDir, "tpex-margin.json")),
    sourceStatus,
    dataGaps,
    mode
  });
  const mopsMaterialRaw = await loadLiveOrFixture<MopsMaterialRaw>({
    key: "mops_material_news",
    providerStatus: providerStatus.MOPS,
    live: () => mops.fetchRaw(date),
    fixture: () => readJson(path.join(fixtureDir, "mops-material.json")),
    sourceStatus,
    dataGaps,
    mode
  });

  const indexes = [
    ...(twseMi ? twse.normalizeMarketIndex(twseMi, date).map((row) => ({ ...row, source: sourceFor("twse", mode, providerStatus.TWSE) })) : []),
    ...(tpexIndex ? tpex.normalizeMarketIndex(tpexIndex, date).map((row) => ({ ...row, source: sourceFor("tpex", mode, providerStatus.TPEx) })) : [])
  ];
  const stockDaily = [
    ...(twseMi ? twse.normalizeDailyPrices(twseMi, date).map((row) => ({ ...row, source: sourceFor("twse", mode, providerStatus.TWSE) })) : []),
    ...(tpexDaily ? tpex.normalizeDailyPrices(tpexDaily, date).map((row) => ({ ...row, source: sourceFor("tpex", mode, providerStatus.TPEx) })) : [])
  ];
  const breadth = [
    ...(twseMi ? [{ ...twse.normalizeMarketBreadth(twseMi, date), source: sourceFor("twse", mode, providerStatus.TWSE) }] : []),
    ...(tpexIndex ? [{ ...tpex.normalizeMarketBreadth(tpexIndex, date), source: sourceFor("tpex", mode, providerStatus.TPEx) }] : [])
  ];
  const institutionalFlows = [
    ...(twseInstitutional ? twse.normalizeInstitutionalFlows(twseInstitutional, date).map((row) => ({ ...row, source: sourceFor("twse", mode, providerStatus.TWSE) })) : []),
    ...(tpexInstitutional ? tpex.normalizeInstitutionalFlows(tpexInstitutional, date).map((row) => ({ ...row, source: sourceFor("tpex", mode, providerStatus.TPEx) })) : [])
  ];
  const marginShort = [
    ...(twseMargin ? twse.normalizeMarginShort(twseMargin, date).map((row) => ({ ...row, source: sourceFor("twse", mode, providerStatus.TWSE) })) : []),
    ...(tpexMargin ? tpex.normalizeMarginShort(tpexMargin, date).map((row) => ({ ...row, source: sourceFor("tpex", mode, providerStatus.TPEx) })) : [])
  ];
  return {
    indexes,
    stockDaily,
    breadth,
    institutionalSummaries: [
      ...(twseInstitutional ? [twse.normalizeInstitutionalSummary(twseInstitutional, date)] : []),
      ...(tpexInstitutional ? [tpex.normalizeInstitutionalSummary(tpexInstitutional, date)] : [])
    ].map((row) => ({ ...row, source: sourceFor(row.market === "TWSE" ? "twse" : "tpex", mode, row.market === "TWSE" ? providerStatus.TWSE : providerStatus.TPEx) })),
    institutionalFlows,
    marginSummaries: [
      ...(twseMargin ? [twse.normalizeMarginSummary(twseMargin, date)] : []),
      ...(tpexMargin ? [tpex.normalizeMarginSummary(tpexMargin, date)] : [])
    ].map((row) => ({ ...row, source: sourceFor(row.market === "TWSE" ? "twse" : "tpex", mode, row.market === "TWSE" ? providerStatus.TWSE : providerStatus.TPEx) })),
    marginShort,
    mopsMaterialNews: mopsMaterialRaw ? mops.normalize(mopsMaterialRaw, date).map((item) => ({ ...item, source: sourceFor("mops", mode, providerStatus.MOPS) })) : [],
    sourceStatus,
    dataGaps: unique(dataGaps)
  };
}

async function loadLiveOrFixture<T>(input: {
  key: string;
  providerStatus: LiveFetchStatus;
  live: () => Promise<T | undefined>;
  fixture: () => Promise<T>;
  sourceStatus: Record<string, string>;
  dataGaps: string[];
  mode: OfficialDataMode;
}): Promise<T | undefined> {
  if (input.mode === "fixture") {
    input.sourceStatus[input.key] = "fixture_only";
    input.dataGaps.push(`${input.key}_fixture_only`);
    return input.fixture();
  }
  if (input.providerStatus === "ok") {
    try {
      const live = await input.live();
      if (live) {
        input.sourceStatus[input.key] = "ok";
        return live;
      }
      input.sourceStatus[input.key] = "fixture_fallback_from_live_empty";
      input.dataGaps.push(`${input.key}_fixture_fallback_from_live_empty`);
    } catch {
      input.sourceStatus[input.key] = "fixture_fallback_from_live_exception";
      input.dataGaps.push(`${input.key}_fixture_fallback_from_live_exception`);
    }
  } else if (input.mode === "auto") {
    input.sourceStatus[input.key] = `fixture_fallback_from_${input.providerStatus}`;
    input.dataGaps.push(`${input.key}_fixture_fallback_from_${input.providerStatus}`);
    return input.fixture();
  }
  input.sourceStatus[input.key] = input.providerStatus;
  input.dataGaps.push(`${input.key}_${input.providerStatus}`);
  return undefined;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

function statusByProvider(results: LiveFetchCheckResult[]): Record<"TWSE" | "TPEx" | "MOPS", LiveFetchStatus> {
  return {
    TWSE: results.find((item) => item.provider === "TWSE")?.status ?? "network_error",
    TPEx: results.find((item) => item.provider === "TPEx")?.status ?? "network_error",
    MOPS: results.find((item) => item.provider === "MOPS")?.status ?? "network_error"
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function sourceFor(provider: "twse" | "tpex" | "mops", mode: OfficialDataMode, status: LiveFetchStatus): string {
  if (mode === "fixture") return `${provider}_fixture`;
  if (status === "ok") return `${provider}_live`;
  return `${provider}_fixture`;
}

function assertSafeReportMarkdown(markdown: string): string {
  if (markdown.includes("win_rate") || markdown.includes("historical_hit_rate")) {
    throw new Error("E2E report must not include win_rate fields without qualified backtest samples.");
  }
  return markdown;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const dateArg = args.find((arg) => !arg.startsWith("--")) ?? todayTaipei();
  const date = dateArg === "today" ? todayTaipei() : dateArg;
  const mode = getOfficialDataMode(args.find((arg) => arg.startsWith("--mode="))?.split("=")[1]);
  const push = args.find((arg) => arg.startsWith("--push="))?.split("=")[1] === "true";
  const result = await runDailyE2EDryRun(date, { mode, push });
  process.stdout.write(JSON.stringify({
    date: result.date,
    reportPath: result.reportPath,
    paths: result.paths,
    sourceStatus: result.sourceStatus,
    dataGaps: result.dataGaps,
    dataQuality: result.dataQuality
  }, null, 2) + "\n");
}
