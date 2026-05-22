import type { AppConfig } from "../config.js";
import { config } from "../config.js";
import { CostGuard, estimateOpenAiCost, roughTokenCount } from "../cost/cost-guard.js";
import type { ExtractedIntel } from "./schemas.js";
import { extractedIntelSchema } from "./schemas.js";

export type ExtractRequest = {
  prompt: string;
  inputText: string;
  outputTokenBudget?: number;
};

export type ExtractResponse =
  | { mode: "openai"; status: "ok"; data: ExtractedIntel; estimatedCostUsd: number }
  | { mode: "manual"; status: "blocked"; reason: string };

export class OpenAiExtractor {
  constructor(
    private readonly appConfig: AppConfig = config,
    private readonly costGuard = new CostGuard(appConfig)
  ) {}

  async extractIntel(request: ExtractRequest): Promise<ExtractResponse> {
    const inputTokens = roughTokenCount(`${request.prompt}\n${request.inputText}`);
    const outputTokens = request.outputTokenBudget ?? 900;
    const estimate = estimateOpenAiCost(this.appConfig.openaiModel, inputTokens, outputTokens);
    const decision = await this.costGuard.canCallOpenAI(estimate);

    if (!decision.allowed) {
      return { mode: "manual", status: "blocked", reason: decision.reason ?? "cost_guard_blocked" };
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.appConfig.openaiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.appConfig.openaiModel,
        input: [
          {
            role: "system",
            content: request.prompt
          },
          {
            role: "user",
            content: request.inputText
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "extracted_intel",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                source: { type: "string" },
                title: { type: "string" },
                summary: { type: "string" },
                tickers: { type: "array", items: { type: "string" } },
                topics: { type: "array", items: { type: "string" } },
                eventType: { type: "string" },
                catalystFlags: { type: "array", items: { type: "string" } },
                riskFlags: { type: "array", items: { type: "string" } },
                credibilityScore: { type: "number" },
                evidenceRefs: { type: "array", items: { type: "string" } }
              },
              required: ["source", "tickers", "topics", "catalystFlags", "riskFlags", "credibilityScore", "evidenceRefs"]
            }
          }
        }
      })
    });

    if (!response.ok) {
      return { mode: "manual", status: "blocked", reason: `openai_http_${response.status}` };
    }

    const json = (await response.json()) as { output_text?: string };
    await this.costGuard.recordOpenAIRequest(estimate);
    const parsed = extractedIntelSchema.parse(JSON.parse(json.output_text ?? "{}"));
    return { mode: "openai", status: "ok", data: parsed, estimatedCostUsd: estimate.estimatedCostUsd };
  }
}
