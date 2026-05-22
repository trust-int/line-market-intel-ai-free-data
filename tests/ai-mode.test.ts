import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { OpenAiExtractor } from "../src/extract/openai.js";
import { generateDailyReport } from "../src/reports/daily.js";

describe("AI_MODE behavior", () => {
  it("does not call OpenAI when AI_MODE=manual", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const cfg = loadConfig({ AI_MODE: "manual", OPENAI_API_KEY: "should-not-be-used" } as NodeJS.ProcessEnv);
    const extractor = new OpenAiExtractor(cfg);
    const result = await extractor.extractIntel({ prompt: "extract", inputText: "2330 AI" });
    expect(result.mode).toBe("manual");
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("generates manual_gpt_pack instead of strategy report in manual mode", async () => {
    const result = await generateDailyReport({ date: "2026-01-01" });
    expect(result.report).toBeNull();
    expect("manualPack" in result ? result.manualPack.packType : null).toBe("postmarket");
  });
});
