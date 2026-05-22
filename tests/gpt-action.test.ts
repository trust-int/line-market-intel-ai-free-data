import { describe, expect, it } from "vitest";
import { runGptActionCheck } from "../src/jobs/gpt-action-check.js";

describe("GPT Action API check", () => {
  it("validates auth and core endpoints", async () => {
    const result = await runGptActionCheck("2026-05-07");
    expect(result.openapi_valid).toBe(true);
    expect(result.auth_required).toBe(true);
    expect(result.endpoints["/gpt/reports/today"]).toBe(200);
    expect(result.endpoints["/gpt/reports/2026-05-07"]).toBe(200);
    expect(result.endpoints["/gpt/manual-pack/2026-05-07"]).toBe(200);
    expect(result.endpoints["/gpt/holdings"]).toBe(200);
    expect(result.no_raw_line_user_id).toBe(true);
    expect(result.no_paid_fulltext).toBe(true);
  });
});
