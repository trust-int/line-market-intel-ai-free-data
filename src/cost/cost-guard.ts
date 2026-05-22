import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../config.js";
import { config } from "../config.js";
import { todayTaipei } from "../utils/date.js";

export type CostGuardUsage = {
  date: string;
  openaiRequests: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

export type CostDecision = {
  allowed: boolean;
  reason?: string;
  fallback: "manual_gpt_pack";
  usage: CostGuardUsage;
};

export type OpenAiCostEstimate = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
};

const DEFAULT_USAGE: CostGuardUsage = {
  date: todayTaipei(),
  openaiRequests: 0,
  inputTokens: 0,
  outputTokens: 0,
  estimatedCostUsd: 0
};

const MODEL_COST_USD_PER_1M_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4.1": { input: 2.0, output: 8.0 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  default: { input: 1.0, output: 4.0 }
};

export class CostGuard {
  constructor(
    private readonly appConfig: AppConfig = config,
    private readonly ledgerPath = path.join(appConfig.manualPackDir, "..", "cost-usage.json")
  ) {}

  async canCallOpenAI(estimate: OpenAiCostEstimate): Promise<CostDecision> {
    const usage = await this.readUsage();

    if (this.appConfig.aiMode !== "openai") {
      return { allowed: false, reason: "AI_MODE_is_not_openai", fallback: "manual_gpt_pack", usage };
    }

    if (!this.appConfig.openaiApiKey) {
      return { allowed: false, reason: "OPENAI_API_KEY_missing", fallback: "manual_gpt_pack", usage };
    }

    if (usage.openaiRequests + 1 > this.appConfig.maxOpenaiDailyRequests) {
      return { allowed: false, reason: "MAX_OPENAI_DAILY_REQUESTS_exceeded", fallback: "manual_gpt_pack", usage };
    }

    if (usage.estimatedCostUsd + estimate.estimatedCostUsd > this.appConfig.maxOpenaiDailyCostUsd) {
      return { allowed: false, reason: "MAX_OPENAI_DAILY_COST_USD_exceeded", fallback: "manual_gpt_pack", usage };
    }

    return { allowed: true, fallback: "manual_gpt_pack", usage };
  }

  async recordOpenAIRequest(estimate: OpenAiCostEstimate): Promise<CostGuardUsage> {
    const usage = await this.readUsage();
    const next: CostGuardUsage = {
      date: todayTaipei(),
      openaiRequests: usage.openaiRequests + 1,
      inputTokens: usage.inputTokens + estimate.inputTokens,
      outputTokens: usage.outputTokens + estimate.outputTokens,
      estimatedCostUsd: roundCost(usage.estimatedCostUsd + estimate.estimatedCostUsd)
    };
    await this.writeUsage(next);
    return next;
  }

  async readUsage(): Promise<CostGuardUsage> {
    try {
      const raw = await readFile(this.ledgerPath, "utf8");
      const usage = JSON.parse(raw) as CostGuardUsage;
      if (usage.date !== todayTaipei()) return { ...DEFAULT_USAGE, date: todayTaipei() };
      return usage;
    } catch {
      return { ...DEFAULT_USAGE, date: todayTaipei() };
    }
  }

  private async writeUsage(usage: CostGuardUsage): Promise<void> {
    await mkdir(path.dirname(this.ledgerPath), { recursive: true });
    await writeFile(this.ledgerPath, JSON.stringify(usage, null, 2), "utf8");
  }
}

export function estimateOpenAiCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): OpenAiCostEstimate {
  const pricing = MODEL_COST_USD_PER_1M_TOKENS[model] ?? MODEL_COST_USD_PER_1M_TOKENS.default!;
  const estimatedCostUsd = roundCost((inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output);
  return { model, inputTokens, outputTokens, estimatedCostUsd };
}

export function roughTokenCount(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function roundCost(value: number): number {
  return Number(value.toFixed(6));
}
