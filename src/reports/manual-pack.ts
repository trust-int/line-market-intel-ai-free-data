import { todayTaipei } from "../utils/date.js";
import { buildManualGptPack, writeManualGptPack } from "../extract/manual-pack.js";
import type { ManualPackInput } from "../extract/schemas.js";

export { buildManualGptPack, writeManualGptPack } from "../extract/manual-pack.js";
export type { ManualGptPack } from "../extract/manual-pack.js";

export async function generateManualReportPack(
  packType: ManualPackInput["packType"],
  input: Partial<Omit<ManualPackInput, "date" | "packType">> & { date?: string } = {}
) {
  const pack = buildManualGptPack({
    date: input.date ?? todayTaipei(),
    packType,
    officialMarketSnapshot: input.officialMarketSnapshot,
    institutionalFlows: input.institutionalFlows ?? [],
    marginShort: input.marginShort ?? [],
    mopsMaterialNews: input.mopsMaterialNews ?? [],
    lineManualNewsEvents: input.lineManualNewsEvents ?? [],
    uploadedAttachmentsMetadata: input.uploadedAttachmentsMetadata ?? [],
    signalEngineResult: input.signalEngineResult,
    sectorStrength: input.sectorStrength ?? [],
    tickerCandidates: input.tickerCandidates ?? [],
    dataSourceStatus: input.dataSourceStatus ?? {},
    costGuardStatus: input.costGuardStatus ?? {},
    dataGaps: input.dataGaps ?? [],
    lineMessages: input.lineMessages ?? [],
    newsEvents: input.newsEvents ?? [],
    marketData: input.marketData ?? [],
    riskFlags: input.riskFlags ?? [],
    evidence: input.evidence ?? []
  });
  const outputDir = await writeManualGptPack(pack);
  return {
    report: null,
    manualPack: pack,
    markdown: pack.markdown,
    outputDir
  };
}
