import { mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { OfficialRawArchive } from "../src/providers/official/archive.js";

describe("official raw response archive", () => {
  it("archives raw official responses", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "official-archive-"));
    const archive = new OfficialRawArchive(dir);
    const record = await archive.save({
      provider: "twse-public",
      dataset: "mi-index",
      tradeDate: "2026-05-07",
      url: "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
      rawText: "{\"stat\":\"OK\"}"
    });
    expect(record.sha256).toBeTruthy();
    await expect(readFile(record.filePath, "utf8")).resolves.toContain("OK");
  });
});
