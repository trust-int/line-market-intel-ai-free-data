import { readFile, stat } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const deployDocs = [
  "docs/deploy-supabase.md",
  "docs/deploy-render.md",
  "docs/deploy-railway.md",
  "docs/deploy-vps-docker.md",
  "docs/first-live-run.md",
  "docs/env-reference.md",
  "docs/release-checklist.md"
];

describe("deployment docs", () => {
  it("all deploy docs exist", async () => {
    for (const file of deployDocs) {
      await expect(stat(file)).resolves.toBeTruthy();
    }
  });

  it("deploy docs include bring-up commands and safety checks", async () => {
    for (const file of deployDocs.filter((item) => item !== "docs/release-checklist.md")) {
      const text = await readFile(file, "utf8");
      expect(text).toContain("prod:check");
      expect(text).toContain("db:");
      expect(text).toContain("tls:diagnose");
      expect(text).toContain("live:check");
      expect(text).toContain("LINE");
      expect(text).toContain("GPT");
      expect(text).toMatch(/paid|付費|NO_PAID_DATA_API/i);
    }
  });

  it("release checklist includes required gates", async () => {
    const text = await readFile("docs/release-checklist.md", "utf8");
    expect(text).toContain("npm test");
    expect(text).toContain("npm run build");
    expect(text).toContain("first-live-run");
    expect(text).toContain("No paid data API");
    expect(text).toContain("Futu disabled");
    expect(text).toContain("No automatic trading");
    expect(text).toContain("No `win_rate`");
  });

  it("README includes first-live-run deployment flow", async () => {
    const text = await readFile("README.md", "utf8");
    expect(text).toContain("現在進度與部署順序");
    expect(text).toContain("cp .env.production.example .env");
    expect(text).toContain("npm run first-live-run");
    expect(text).toContain("AI_MODE=manual");
    expect(text).toContain("OFFICIAL_DATA_MODE=auto");
  });
});
