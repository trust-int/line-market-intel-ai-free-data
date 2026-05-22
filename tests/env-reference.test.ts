import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const requiredKeys = [
  "NODE_ENV",
  "PORT",
  "TZ",
  "DATABASE_URL",
  "NO_PAID_DATA_API",
  "DISABLE_PAID_MARKET_DATA",
  "DISABLE_NEWS_SCRAPING",
  "OFFICIAL_DATA_MODE",
  "AI_MODE",
  "ENABLE_TWSE_PUBLIC",
  "ENABLE_TPEX_PUBLIC",
  "ENABLE_MOPS_PUBLIC",
  "ENABLE_JIN10_MANUAL",
  "ENABLE_WALLSTREETCN_MANUAL",
  "ENABLE_FUTU",
  "FUTU_PERMISSION_CONFIRMED",
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "USER_HASH_SECRET",
  "ENABLE_LINE_PUSH",
  "LINE_PUSH_TARGET_ID",
  "LINE_TEST_TARGET_ID",
  "GPT_ACTION_BEARER_TOKEN",
  "MAX_OPENAI_DAILY_COST_USD",
  "MAX_OPENAI_DAILY_REQUESTS",
  "NODE_EXTRA_CA_CERTS"
];

describe(".env.production.example", () => {
  it("contains required production keys", async () => {
    const text = await readFile(".env.production.example", "utf8");
    for (const key of requiredKeys) {
      expect(text).toMatch(new RegExp(`^${key}=`, "m"));
    }
  });

  it("does not contain real-looking secrets", async () => {
    const text = await readFile(".env.production.example", "utf8");
    expect(text).not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._-]+/);
    expect(text).not.toMatch(/postgres:\/\/[^=\n]+:[^=\n]+@/);
    expect(text).not.toMatch(/LINE_CHANNEL_ACCESS_TOKEN=.+/);
    expect(text).not.toMatch(/GPT_ACTION_BEARER_TOKEN=.+/);
  });
});
