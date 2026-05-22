import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyTlsError, diagnoseTls, suggestionForTlsError } from "../src/jobs/tls-diagnose.js";

const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;

afterEach(() => {
  if (originalRejectUnauthorized == null) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  else process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
});

describe("TLS diagnostics", () => {
  it("detects NODE_TLS_REJECT_UNAUTHORIZED=0", async () => {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    const result = await diagnoseTls("2026-05-07", {
      outputDir: await mkdtemp(path.join(tmpdir(), "stock-tls-")),
      request: async (provider, url) => ({ provider, url, ok: true })
    });
    expect(result.critical_warnings.join(" ")).toContain("disables TLS verification");
  });

  it("classifies UNABLE_TO_VERIFY_LEAF_SIGNATURE", () => {
    expect(classifyTlsError("UNABLE_TO_VERIFY_LEAF_SIGNATURE")).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
    expect(suggestionForTlsError("UNABLE_TO_VERIFY_LEAF_SIGNATURE")).toContain("NODE_EXTRA_CA_CERTS");
  });
});
