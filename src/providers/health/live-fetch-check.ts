import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { config } from "../../config.js";
import { enforceProviderPolicy, type ProviderPolicy } from "../../cost/provider-policy.js";
import { compactDate, todayTaipei } from "../../utils/date.js";
import { logger } from "../../utils/logger.js";
import { isoToRocDate } from "../official/archive.js";

export type LiveFetchStatus =
  | "ok"
  | "tls_error"
  | "dns_error"
  | "timeout"
  | "http_403"
  | "http_404"
  | "http_5xx"
  | "network_error"
  | "endpoint_changed"
  | "schema_changed"
  | "data_schema_changed"
  | "disabled";

export type LiveFetchCheckResult = {
  provider: "TWSE" | "TPEx" | "MOPS";
  status: LiveFetchStatus;
  url: string;
  checked_at: string;
  http_status?: number;
  latency_ms?: number;
  content_type?: string;
  response_sample?: string;
  schema_validation?: "passed" | "failed" | "not_run";
  error_message?: string;
  error_type?: string;
  suggestion?: string;
};

type SmokeDefinition = {
  provider: LiveFetchCheckResult["provider"];
  url: string;
  policy: ProviderPolicy;
  validate: (json: unknown) => boolean;
};

export function smokeProviderUrls(date = todayTaipei()): Array<{ provider: LiveFetchCheckResult["provider"]; url: string }> {
  return smokeDefinitions(date).map((item) => ({ provider: item.provider, url: item.url }));
}

export async function runLiveFetchCheck(date = todayTaipei()): Promise<LiveFetchCheckResult[]> {
  const checks = smokeDefinitions(date);
  const results: LiveFetchCheckResult[] = [];
  for (const check of checks) {
    results.push(await runOne(check));
  }
  return results;
}

export function sourceStatusFromLiveCheck(results: LiveFetchCheckResult[]): Record<string, string> {
  return Object.fromEntries(results.map((result) => [result.provider.toLowerCase(), result.status]));
}

export function dataGapsFromLiveCheck(results: LiveFetchCheckResult[]): string[] {
  return results
    .filter((result) => result.status !== "ok")
    .map((result) => `${result.provider.toLowerCase()}_live_fetch_${result.status}`);
}

async function runOne(check: SmokeDefinition): Promise<LiveFetchCheckResult> {
  const policy = enforceProviderPolicy(check.policy, config);
  if (policy.status === "disabled") {
    return {
      provider: check.provider,
      status: "disabled",
      url: check.url,
      checked_at: new Date().toISOString(),
      error_message: policy.reason,
      suggestion: "檢查 provider env 設定；public provider 通常應保持 enabled。"
    };
  }

  try {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(check.url, {
      headers: {
        "User-Agent": "line-market-intel-ai-free-data/0.1",
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8"
      },
      signal: controller.signal
    });
    clearTimeout(timeout);
    const latency = Date.now() - startedAt;
    const contentType = response.headers.get("content-type") ?? undefined;
    const text = await response.text();
    const responseSample = text.slice(0, 300);

    if ([404, 410].includes(response.status)) return result(check, "http_404", response.status, `HTTP ${response.status}`, { latency, contentType, responseSample });
    if (response.status === 403) return result(check, "http_403", response.status, "HTTP 403", { latency, contentType, responseSample });
    if (response.status >= 500) return result(check, "http_5xx", response.status, `HTTP ${response.status}`, { latency, contentType, responseSample });

    if (!response.ok) {
      return result(check, "network_error", response.status, `HTTP ${response.status}`, { latency, contentType, responseSample });
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return result(check, "schema_changed", response.status, "Response is not JSON.", { latency, contentType, responseSample, schemaValidation: "failed" });
    }

    if (!check.validate(json)) {
      return result(check, "schema_changed", response.status, "JSON shape did not match expected public schema.", { latency, contentType, responseSample, schemaValidation: "failed" });
    }

    return result(check, "ok", response.status, undefined, { latency, contentType, responseSample, schemaValidation: "passed" });
  } catch (error) {
    const details = errorDetails(error);
    const message = details.message;
    const status = classifyError(message);
    return result(check, status, undefined, message, { errorType: details.errorType });
  }
}

function smokeDefinitions(date: string): SmokeDefinition[] {
  const twsePolicy: ProviderPolicy = {
    name: "twse-public",
    category: "market",
    enabled: config.enableTwsePublic,
    paid: false,
    requiresLogin: false,
    requiresPermission: false,
    termsChecked: true,
    licenseStatus: "official_public",
    allowedWhenNoPaidApi: true,
    mode: config.enableTwsePublic ? "automatic" : "disabled"
  };
  const tpexPolicy: ProviderPolicy = {
    ...twsePolicy,
    name: "tpex-public",
    enabled: config.enableTpexPublic,
    mode: config.enableTpexPublic ? "automatic" : "disabled"
  };
  const mopsPolicy: ProviderPolicy = {
    ...twsePolicy,
    name: "mops-material-news",
    category: "news",
    enabled: config.enableMopsPublic,
    mode: config.enableMopsPublic ? "automatic" : "disabled"
  };
  const rocYear = Number(date.slice(0, 4)) - 1911;
  return [
    {
      provider: "TWSE",
      policy: twsePolicy,
      url: `https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date=${compactDate(date)}&type=IND&response=json`,
      validate: (json) => hasAnyKey(json, ["stat", "fields1", "data1"])
    },
    {
      provider: "TPEx",
      policy: tpexPolicy,
      url: `https://www.tpex.org.tw/openapi/v1/tpex_daily_trading_index?d=${encodeURIComponent(isoToRocDate(date))}`,
      validate: (json) => Array.isArray(json) || hasAnyKey(json, ["data", "tables"])
    },
    {
      provider: "MOPS",
      policy: mopsPolicy,
      url:
        `https://mops.twse.com.tw/mops/web/ajax_t05st02?encodeURIComponent=1&step=1&step00=0&firstin=1&off=1&TYPEK=all&year=${rocYear}&month=${date.slice(5, 7)}&day=${date.slice(8, 10)}`,
      validate: (json) => typeof json === "object" && json !== null
    }
  ];
}

function hasAnyKey(value: unknown, keys: string[]): boolean {
  if (typeof value !== "object" || value === null) return false;
  return keys.some((key) => key in value);
}

function classifyError(message: string): LiveFetchStatus {
  const normalized = message.toLowerCase();
  if (normalized.includes("abort") || normalized.includes("timeout")) return "timeout";
  if (normalized.includes("enotfound") || normalized.includes("eai_again") || normalized.includes("dns")) return "dns_error";
  if (
    normalized.includes("certificate") ||
    normalized.includes("cert_") ||
    normalized.includes("unable_to_verify") ||
    normalized.includes("self-signed") ||
    normalized.includes("tls") ||
    normalized.includes("ssl")
  ) {
    return "tls_error";
  }
  return "network_error";
}

function errorDetails(error: unknown): { message: string; errorType?: string } {
  if (!(error instanceof Error)) return { message: String(error) };
  const cause = (error as Error & { cause?: unknown }).cause;
  const causeCode = typeof cause === "object" && cause && "code" in cause ? String((cause as { code?: unknown }).code) : undefined;
  const causeMessage = cause instanceof Error ? cause.message : undefined;
  return {
    message: [error.message, causeCode, causeMessage].filter(Boolean).join(" | "),
    errorType: causeCode ?? error.name
  };
}

function result(
  check: SmokeDefinition,
  status: LiveFetchStatus,
  httpStatus?: number,
  errorMessage?: string,
  diagnostics: {
    latency?: number;
    contentType?: string;
    responseSample?: string;
    schemaValidation?: "passed" | "failed" | "not_run";
    errorType?: string;
  } = {}
): LiveFetchCheckResult {
  return {
    provider: check.provider,
    status,
    url: check.url,
    checked_at: new Date().toISOString(),
    http_status: httpStatus,
    latency_ms: diagnostics.latency,
    content_type: diagnostics.contentType,
    response_sample: diagnostics.responseSample,
    schema_validation: diagnostics.schemaValidation ?? (status === "disabled" ? "not_run" : undefined),
    error_message: errorMessage,
    error_type: diagnostics.errorType ?? status,
    suggestion: suggestionFor(status)
  };
}

function suggestionFor(status: LiveFetchStatus): string | undefined {
  if (status === "tls_error") {
    return "確認作業系統根憑證或 Docker ca-certificates；需要企業 CA 時設定 NODE_EXTRA_CA_CERTS。不要使用 NODE_TLS_REJECT_UNAUTHORIZED=0。";
  }
  if (status === "endpoint_changed" || status === "http_404") return "檢查官方 endpoint 是否改版，更新 provider URL。";
  if (status === "schema_changed" || status === "data_schema_changed") return "官方 JSON 欄位可能改版，請更新 normalize mapping 與 fixture。";
  if (status === "http_403") return "官方站台拒絕存取；檢查 User-Agent、頻率、來源 IP 或官方政策。";
  if (status === "http_5xx") return "官方站台暫時異常，稍後重試。";
  if (status === "dns_error") return "DNS 解析失敗，檢查網路、DNS 或代理設定。";
  if (status === "timeout") return "連線逾時，檢查防火牆、代理或官方站台延遲。";
  if (status === "network_error") return "檢查 DNS、防火牆、代理或官方站台暫時不可用。";
  return undefined;
}

export async function writeLiveFetchCheckOutputs(date: string, results: LiveFetchCheckResult[], outputDir = path.resolve(process.cwd(), "outputs", "live-check")) {
  await mkdir(outputDir, { recursive: true });
  const jsonPath = path.join(outputDir, `${date}.json`);
  const mdPath = path.join(outputDir, `${date}.md`);
  await writeFile(jsonPath, JSON.stringify({ date, results }, null, 2), "utf8");
  await writeFile(mdPath, renderLiveFetchCheckMarkdown(date, results), "utf8");
  return { jsonPath, mdPath };
}

function renderLiveFetchCheckMarkdown(date: string, results: LiveFetchCheckResult[]): string {
  return [
    `# ${date} Live Fetch Check`,
    "",
    "| Provider | Status | HTTP | Latency | Content-Type | Schema | URL |",
    "|---|---|---:|---:|---|---|---|",
    ...results.map((item) => `| ${item.provider} | ${item.status} | ${item.http_status ?? ""} | ${item.latency_ms ?? ""} | ${item.content_type ?? ""} | ${item.schema_validation ?? ""} | ${item.url} |`),
    "",
    "## Diagnostics",
    ...results.map((item) => [
      `### ${item.provider}`,
      `- error_type: ${item.error_type ?? ""}`,
      `- error_message: ${item.error_message ?? ""}`,
      `- suggestion: ${item.suggestion ?? ""}`,
      item.response_sample ? ["", "```text", item.response_sample, "```"].join("\n") : ""
    ].filter(Boolean).join("\n"))
  ].join("\n");
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const date = process.argv[2] ?? todayTaipei();
  const results = await runLiveFetchCheck(date);
  for (const item of results) {
    if (item.status !== "ok") logger.warn("live fetch check failed", item);
  }
  const outputs = await writeLiveFetchCheckOutputs(date, results);
  process.stdout.write(JSON.stringify({ date, results, outputs }, null, 2) + "\n");
}
