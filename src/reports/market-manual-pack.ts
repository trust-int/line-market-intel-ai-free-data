import { SignalEngine } from "../analysis/signal-engine.js";
import { calculateSectorStrength } from "../analysis/sector-strength-engine.js";
import { calculateTickerCandidates } from "../analysis/ticker-candidate-engine.js";
import { CostGuard } from "../cost/cost-guard.js";
import { MopsMaterialNewsProvider } from "../providers/news/mops-material.provider.js";
import { DailyMarketSnapshotsRepo } from "../repositories/daily-market-snapshots.repo.js";
import { generateManualReportPack } from "./manual-pack.js";
import { collectMarketJob } from "../jobs/collect-market.js";
import { todayTaipei } from "../utils/date.js";

export async function generateMarketManualGptPack(date = todayTaipei(), packType: "premarket" | "intraday" | "postmarket" | "weekly" | "ad_hoc" = "postmarket") {
  const repo = new DailyMarketSnapshotsRepo();
  const storedSnapshot = await repo.getDailyMarketSnapshot(date);
  const market = storedSnapshot
    ? {
        snapshot: storedSnapshot,
        institutional: [],
        margin: [],
        dataGaps: storedSnapshot.data_gaps,
        sourceStatus: storedSnapshot.source_status
      }
    : await collectMarketJob(date);
  const sectorResult = await calculateSectorStrength(date);
  const tickerResult = await calculateTickerCandidates(date, {
    sectorStrength: sectorResult.sectors
  });
  const signalEngineResult = new SignalEngine().analyze({
    snapshot: market.snapshot,
    sectorStrength: sectorResult.sectors,
    tickerCandidates: tickerResult.candidates,
    dataGaps: [...market.dataGaps, ...sectorResult.data_gaps, ...tickerResult.data_gaps]
  });
  const mopsNews = await new MopsMaterialNewsProvider().fetchLatest({ until: date });
  const costUsage = await new CostGuard().readUsage();
  const dataGaps = Array.from(new Set([...market.dataGaps, ...sectorResult.data_gaps, ...tickerResult.data_gaps]));

  return generateManualReportPack(packType, {
    date,
    officialMarketSnapshot: market.snapshot,
    institutionalFlows: market.institutional,
    marginShort: market.margin,
    mopsMaterialNews: mopsNews,
    signalEngineResult,
    sectorStrength: sectorResult.sectors,
    tickerCandidates: tickerResult.candidates,
    dataSourceStatus: {
      ...market.sourceStatus,
      futu: "disabled",
      no_paid_data_api: "ok",
      paid_market_data: "disabled"
    },
    costGuardStatus: {
      ai_mode: "manual",
      openai_requests_today: costUsage.openaiRequests,
      estimated_cost_today: costUsage.estimatedCostUsd,
      paid_data_api_used: false
    },
    dataGaps,
    riskFlags: signalEngineResult.risk_flags.map((flag) => ({ flag })),
    evidence: dataGaps.map((gap) => ({ type: "data_gap", gap }))
  });
}
