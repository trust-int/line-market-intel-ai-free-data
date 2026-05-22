import { mkdir, writeFile } from "node:fs/promises";
import https from "node:https";
import type { TLSSocket } from "node:tls";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { smokeProviderUrls } from "../providers/health/live-fetch-check.js";
import { todayTaipei } from "../utils/date.js";

export type TlsProviderDiagnostic = {
  provider: string;
  url: string;
  ok: boolean;
  tls_error_code?: string;
  error_message?: string;
  certificate_subject?: string;
  certificate_issuer?: string;
  suggested_fix?: string;
};

export type TlsDiagnoseResult = {
  checked_at: string;
  node_version: string;
  platform: string;
  openssl_version: string;
  node_extra_ca_certs?: string;
  node_tls_reject_unauthorized?: string;
  critical_warnings: string[];
  providers: TlsProviderDiagnostic[];
  output_paths?: {
    json: string;
    markdown: string;
  };
};

export async function diagnoseTls(
  date = todayTaipei(),
  options: { outputDir?: string; request?: typeof requestTlsProbe } = {}
): Promise<TlsDiagnoseResult> {
  const criticalWarnings = process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0"
    ? ["NODE_TLS_REJECT_UNAUTHORIZED=0 disables TLS verification. Remove it; do not use it as a fix."]
    : [];
  const request = options.request ?? requestTlsProbe;
  const providers = [];
  for (const item of smokeProviderUrls(date)) {
    providers.push(await request(item.provider, item.url));
  }
  const result: TlsDiagnoseResult = {
    checked_at: new Date().toISOString(),
    node_version: process.version,
    platform: process.platform,
    openssl_version: process.versions.openssl,
    node_extra_ca_certs: process.env.NODE_EXTRA_CA_CERTS,
    node_tls_reject_unauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
    critical_warnings: criticalWarnings,
    providers
  };
  const paths = await writeTlsDiagnoseOutputs(result, options.outputDir);
  return { ...result, output_paths: paths };
}

export async function requestTlsProbe(provider: string, url: string): Promise<TlsProviderDiagnostic> {
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 10_000 }, (res) => {
      const cert = (res.socket as TLSSocket).getPeerCertificate();
      res.resume();
      resolve({
        provider,
        url,
        ok: true,
        certificate_subject: cert && "subject" in cert ? formatCertName(cert.subject) : undefined,
        certificate_issuer: cert && "issuer" in cert ? formatCertName(cert.issuer) : undefined
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error: NodeJS.ErrnoException) => {
      const code = error.code ?? classifyTlsError(error.message);
      resolve({
        provider,
        url,
        ok: false,
        tls_error_code: code,
        error_message: error.message,
        suggested_fix: suggestionForTlsError(code)
      });
    });
  });
}

export function classifyTlsError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("unable_to_verify_leaf_signature") || normalized.includes("unable to verify")) {
    return "UNABLE_TO_VERIFY_LEAF_SIGNATURE";
  }
  if (normalized.includes("self-signed")) return "SELF_SIGNED_CERT_IN_CHAIN";
  if (normalized.includes("certificate") || normalized.includes("tls") || normalized.includes("ssl")) return "TLS_CERTIFICATE_ERROR";
  if (normalized.includes("timeout")) return "TIMEOUT";
  return "NETWORK_ERROR";
}

export function suggestionForTlsError(code?: string): string {
  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return "系統缺少信任的根憑證或企業代理憑證鏈。安裝 ca-certificates；若使用公司代理/自簽 CA，將 CA 憑證存成 PEM 並設定 NODE_EXTRA_CA_CERTS。不要設定 NODE_TLS_REJECT_UNAUTHORIZED=0。";
  }
  if (code === "SELF_SIGNED_CERT_IN_CHAIN") {
    return "偵測到自簽憑證鏈。請匯入企業 CA 並用 NODE_EXTRA_CA_CERTS 指向 PEM 檔，不要關閉 TLS 驗證。";
  }
  if (code === "TIMEOUT") return "連線逾時，檢查防火牆、代理或官方站台延遲。";
  return "檢查系統 CA、代理、防火牆與 DNS。不要關閉 TLS 驗證。";
}

async function writeTlsDiagnoseOutputs(result: TlsDiagnoseResult, outputDir = path.resolve(process.cwd(), "outputs", "tls-diagnose")) {
  await mkdir(outputDir, { recursive: true });
  const json = path.join(outputDir, "latest.json");
  const markdown = path.join(outputDir, "latest.md");
  await writeFile(json, JSON.stringify(result, null, 2), "utf8");
  await writeFile(markdown, renderTlsDiagnoseMarkdown(result), "utf8");
  return { json, markdown };
}

function renderTlsDiagnoseMarkdown(result: TlsDiagnoseResult): string {
  return [
    "# TLS Diagnose",
    "",
    `- Node: ${result.node_version}`,
    `- Platform: ${result.platform}`,
    `- OpenSSL: ${result.openssl_version}`,
    `- NODE_EXTRA_CA_CERTS: ${result.node_extra_ca_certs ?? "not set"}`,
    `- NODE_TLS_REJECT_UNAUTHORIZED: ${result.node_tls_reject_unauthorized ?? "not set"}`,
    result.critical_warnings.length ? `- critical: ${result.critical_warnings.join("; ")}` : "- critical: none",
    "",
    "| Provider | OK | Error Code | Subject | Issuer | Suggested Fix |",
    "|---|---:|---|---|---|---|",
    ...result.providers.map((item) =>
      `| ${item.provider} | ${item.ok} | ${item.tls_error_code ?? ""} | ${item.certificate_subject ?? ""} | ${item.certificate_issuer ?? ""} | ${item.suggested_fix ?? ""} |`
    )
  ].join("\n");
}

function formatCertName(value: object | undefined): string | undefined {
  if (!value) return undefined;
  return Object.entries(value).map(([key, val]) => `${key}=${String(val)}`).join(", ");
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const date = process.argv[2] ?? todayTaipei();
  process.stdout.write(JSON.stringify(await diagnoseTls(date), null, 2) + "\n");
}
