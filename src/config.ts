import { config as loadDotenv } from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "test") {
  loadDotenv();
}

const booleanish = z
  .union([z.boolean(), z.string(), z.undefined()])
  .transform((value) => {
    if (typeof value === "boolean") return value;
    if (value == null || value === "") return undefined;
    return ["1", "true", "yes", "on"].includes(value.toLowerCase());
  });

const numberish = (fallback: number) =>
  z
    .union([z.number(), z.string(), z.undefined()])
    .transform((value) => {
      if (typeof value === "number") return value;
      if (value == null || value === "") return fallback;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    });

const csvish = z
  .union([z.string(), z.undefined()])
  .transform((value) => (value ?? "").split(/[,\s]+/).map((item) => item.trim()).filter(Boolean));

const envSchema = z.object({
  nodeEnv: z.string().default("development"),
  port: numberish(3000),
  publicBaseUrl: z.string().default("http://localhost:3000"),
  lineWebhookUrl: z.string().optional(),
  databaseUrl: z.string().optional(),
  redisUrl: z.string().optional(),
  storageDir: z.string().default("./data/private-storage"),
  manualPackDir: z.string().default("./data/manual-packs"),
  officialDataMode: z.enum(["auto", "live", "fixture"]).default("auto"),

  noPaidDataApi: booleanish.default(true),
  disablePaidMarketData: booleanish.default(true),
  disableNewsScraping: booleanish.default(true),

  aiMode: z.enum(["openai", "manual", "local"]).default("manual"),
  openaiApiKey: z.string().optional(),
  openaiModel: z.string().default("gpt-4.1-mini"),
  maxOpenaiDailyCostUsd: numberish(1),
  maxOpenaiDailyRequests: numberish(300),

  enableFutu: booleanish.default(false),
  futuOpendHost: z.string().default("127.0.0.1"),
  futuOpendPort: numberish(11111),
  futuPermissionConfirmed: booleanish.default(false),

  enableJin10Manual: booleanish.default(true),
  enableWallStreetCnManual: booleanish.default(true),
  enableFutuNewsManual: booleanish.default(true),
  enableTwsePublic: booleanish.default(true),
  enableTpexPublic: booleanish.default(true),
  enableMopsPublic: booleanish.default(true),
  enableRssPublic: booleanish.default(false),
  enableLinePush: booleanish.default(false),
  ocrEnabled: booleanish.default(false),
  ocrProvider: z.enum(["tesseract"]).default("tesseract"),
  ocrLang: z.string().default("chi_tra+eng"),
  ocrMinTextLength: numberish(10),
  ocrMaxImageBytes: numberish(5242880),
  fileIngestEnabled: booleanish.default(true),
  fileMaxBytes: numberish(10485760),
  fileTextMaxChars: numberish(12000),
  fileFullTextMaxChars: numberish(50000),

  lineChannelSecret: z.string().optional(),
  lineChannelAccessToken: z.string().optional(),
  linePushTargetId: z.string().optional(),
  lineTestTargetId: z.string().optional(),
  lineAllowedUserIds: csvish.default(""),
  lineAllowedUserHashes: csvish.default(""),
  userHashSecret: z.string().default("change-me"),
  gptActionBearerToken: z.string().default("change-me-too")
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    lineWebhookUrl: env.LINE_WEBHOOK_URL,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    storageDir: env.STORAGE_DIR,
    manualPackDir: env.MANUAL_PACK_DIR,
    officialDataMode: env.OFFICIAL_DATA_MODE,
    noPaidDataApi: env.NO_PAID_DATA_API,
    disablePaidMarketData: env.DISABLE_PAID_MARKET_DATA,
    disableNewsScraping: env.DISABLE_NEWS_SCRAPING,
    aiMode: env.AI_MODE,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    maxOpenaiDailyCostUsd: env.MAX_OPENAI_DAILY_COST_USD,
    maxOpenaiDailyRequests: env.MAX_OPENAI_DAILY_REQUESTS,
    enableFutu: env.ENABLE_FUTU,
    futuOpendHost: env.FUTU_OPEND_HOST,
    futuOpendPort: env.FUTU_OPEND_PORT,
    futuPermissionConfirmed: env.FUTU_PERMISSION_CONFIRMED,
    enableJin10Manual: env.ENABLE_JIN10_MANUAL,
    enableWallStreetCnManual: env.ENABLE_WALLSTREETCN_MANUAL,
    enableFutuNewsManual: env.ENABLE_FUTU_NEWS_MANUAL,
    enableTwsePublic: env.ENABLE_TWSE_PUBLIC,
    enableTpexPublic: env.ENABLE_TPEX_PUBLIC,
    enableMopsPublic: env.ENABLE_MOPS_PUBLIC,
    enableRssPublic: env.ENABLE_RSS_PUBLIC,
    enableLinePush: env.ENABLE_LINE_PUSH,
    ocrEnabled: env.OCR_ENABLED,
    ocrProvider: env.OCR_PROVIDER,
    ocrLang: env.OCR_LANG,
    ocrMinTextLength: env.OCR_MIN_TEXT_LENGTH,
    ocrMaxImageBytes: env.OCR_MAX_IMAGE_BYTES,
    fileIngestEnabled: env.FILE_INGEST_ENABLED,
    fileMaxBytes: env.FILE_MAX_BYTES,
    fileTextMaxChars: env.FILE_TEXT_MAX_CHARS,
    fileFullTextMaxChars: env.FILE_FULL_TEXT_MAX_CHARS,
    lineChannelSecret: env.LINE_CHANNEL_SECRET,
    lineChannelAccessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
    linePushTargetId: env.LINE_PUSH_TARGET_ID,
    lineTestTargetId: env.LINE_TEST_TARGET_ID,
    lineAllowedUserIds: env.LINE_ALLOWED_USER_IDS,
    lineAllowedUserHashes: env.LINE_ALLOWED_USER_HASHES,
    userHashSecret: env.USER_HASH_SECRET,
    gptActionBearerToken: env.GPT_ACTION_BEARER_TOKEN
  });
}

export const config = loadConfig();
