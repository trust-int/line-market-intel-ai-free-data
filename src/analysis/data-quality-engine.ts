export type DataQualityLevel = "high" | "medium" | "low" | "fixture_only" | "insufficient";

export type DataQualityResult = {
  score: number;
  level: DataQualityLevel;
  reasons: string[];
  source_status: Record<string, string>;
  data_gaps: string[];
};

export type DataQualityInput = {
  sourceStatus: Record<string, string>;
  dataGaps?: string[];
  hasMarketData?: boolean;
  hasLineOrManualNews?: boolean;
  hasOnlyMetadata?: boolean;
};

export class DataQualityEngine {
  evaluate(input: DataQualityInput): DataQualityResult {
    const entries = Object.entries(input.sourceStatus).filter(([source]) => !["no_paid_data_api", "paid_market_data", "futu"].includes(source));
    const statuses = entries.map(([, status]) => status);
    const liveStatuses = statuses.filter((status) => status === "ok");
    const fallbackStatuses = statuses.filter((status) => status.includes("fixture"));
    const failures = statuses.filter((status) => status !== "ok" && !status.includes("disabled"));
    const reasons: string[] = [];
    let score = 0;
    let level: DataQualityLevel = "insufficient";

    if (fallbackStatuses.length > 0 && liveStatuses.length === 0 && input.hasMarketData) {
      score = Math.max(0, Math.min(30, 30 - (input.dataGaps?.length ?? 0)));
      level = "fixture_only";
      reasons.push("official_live_fetch_failed_using_fixture_fallback");
    } else if (liveStatuses.length > 0 && failures.length === 0 && input.hasMarketData) {
      score = 95;
      level = "high";
      reasons.push("official_live_fetch_all_required_sources_ok");
    } else if (liveStatuses.length > 0 && input.hasMarketData) {
      score = Math.max(60, 85 - failures.length * 5 - (input.dataGaps?.length ?? 0) * 2);
      level = score >= 75 ? "medium" : "low";
      reasons.push("official_live_fetch_partially_ok");
    } else if (input.hasLineOrManualNews) {
      score = input.hasOnlyMetadata ? 20 : 35;
      level = "low";
      reasons.push(input.hasOnlyMetadata ? "metadata_only_without_ocr_or_market_data" : "manual_news_without_market_data");
    } else {
      score = 0;
      level = "insufficient";
      reasons.push("no_usable_market_or_manual_data");
    }

    for (const [source, status] of Object.entries(input.sourceStatus)) {
      if (status !== "ok" && !status.includes("disabled")) reasons.push(`${source}:${status}`);
    }

    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      level,
      reasons: Array.from(new Set(reasons)),
      source_status: input.sourceStatus,
      data_gaps: Array.from(new Set(input.dataGaps ?? []))
    };
  }
}

export function calculateDataQuality(input: DataQualityInput): DataQualityResult {
  return new DataQualityEngine().evaluate(input);
}
