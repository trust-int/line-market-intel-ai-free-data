import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { CostGuard, estimateOpenAiCost } from "../src/cost/cost-guard.js";

describe("OpenAI cost guard", () => {
  it("blocks over daily request limit", async () => {
    const cfg = loadConfig({
      AI_MODE: "openai",
      OPENAI_API_KEY: "test",
      MAX_OPENAI_DAILY_REQUESTS: "0",
      MAX_OPENAI_DAILY_COST_USD: "1"
    } as NodeJS.ProcessEnv);
    const guard = new CostGuard(cfg, path.join("data", "test-cost-guard-requests.json"));
    const decision = await guard.canCallOpenAI(estimateOpenAiCost("gpt-4.1-mini", 100, 100));
    expect(decision.allowed).toBe(false);
    expect(decision.fallback).toBe("manual_gpt_pack");
  });

  it("blocks over daily cost limit", async () => {
    const cfg = loadConfig({
      AI_MODE: "openai",
      OPENAI_API_KEY: "test",
      MAX_OPENAI_DAILY_REQUESTS: "300",
      MAX_OPENAI_DAILY_COST_USD: "0.000001"
    } as NodeJS.ProcessEnv);
    const guard = new CostGuard(cfg, path.join("data", "test-cost-guard-cost.json"));
    const decision = await guard.canCallOpenAI(estimateOpenAiCost("gpt-4.1", 10_000, 10_000));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("MAX_OPENAI_DAILY_COST_USD_exceeded");
  });
});
