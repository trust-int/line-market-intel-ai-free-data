import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { exportGptActionAssets, smokeGptAction } from "../src/jobs/gpt-action-production.js";

describe("GPT Action production readiness", () => {
  it("exports OpenAPI schema and setup doc", async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), "stock-gpt-action-"));
    const result = await exportGptActionAssets(outputDir);
    expect(result.ok).toBe(true);
    await expect(stat(result.openapi_path)).resolves.toBeTruthy();
    await expect(stat(result.setup_path)).resolves.toBeTruthy();
  });

  it("runs smoke checks with auth and data safety", async () => {
    const result = await smokeGptAction("2026-05-07");
    expect(result.auth_required).toBe(true);
    expect(result.no_raw_line_user_id).toBe(true);
    expect(result.no_paid_fulltext).toBe(true);
  });
});
