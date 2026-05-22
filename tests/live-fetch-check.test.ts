import { describe, expect, it, vi } from "vitest";
import { runLiveFetchCheck } from "../src/providers/health/live-fetch-check.js";

describe("live fetch check", () => {
  it("marks TLS errors without crashing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("unable to verify the first certificate");
    }));
    const results = await runLiveFetchCheck("2026-05-07");
    expect(results).toHaveLength(3);
    expect(results.every((result) => result.status === "tls_error")).toBe(true);
    expect(results[0]?.suggestion).toContain("NODE_EXTRA_CA_CERTS");
    vi.unstubAllGlobals();
  });

  it("marks endpoint changes and schema changes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("twse")) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ unexpected: true }), { status: 200 });
    }));
    const results = await runLiveFetchCheck("2026-05-07");
    expect(results.find((result) => result.provider === "TWSE")?.status).toBe("http_404");
    expect(results.find((result) => result.provider === "TPEx")?.status).toBe("schema_changed");
    expect(results.find((result) => result.provider === "TPEx")?.response_sample).toContain("unexpected");
    vi.unstubAllGlobals();
  });
});
