import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export type OcrStatus = "success" | "failed" | "disabled" | "too_large" | "provider_missing" | "language_missing" | "empty";
export type OcrErrorCode = "PROVIDER_MISSING" | "LANG_MISSING" | "EMPTY_TEXT" | "EXEC_ERROR" | "DOWNLOAD_ERROR" | "TOO_LARGE";

export type OcrConfig = {
  enabled: boolean;
  provider: "tesseract";
  lang: string;
  minTextLength: number;
  maxImageBytes: number;
  maxImagePixels: number;
  timeoutMs: number;
};

export type OcrResult = {
  status: OcrStatus;
  provider: "tesseract";
  text: string | null;
  textLength: number;
  errorCode?: OcrErrorCode;
  error?: string;
};

export type OcrRecognizeInput = {
  imagePath: string;
  imageBytes: number;
  imagePixels?: number;
};

export interface OcrService {
  recognizeImage(input: OcrRecognizeInput): Promise<OcrResult>;
}

export function resolveOcrConfig(overrides: Partial<OcrConfig> = {}): OcrConfig {
  return {
    enabled: overrides.enabled ?? config.ocrEnabled ?? false,
    provider: overrides.provider ?? config.ocrProvider ?? "tesseract",
    lang: overrides.lang ?? config.ocrLang ?? "chi_tra+eng",
    minTextLength: overrides.minTextLength ?? config.ocrMinTextLength ?? 10,
    maxImageBytes: overrides.maxImageBytes ?? config.ocrMaxImageBytes ?? 5242880,
    maxImagePixels: overrides.maxImagePixels ?? config.ocrMaxImagePixels ?? 2500000,
    timeoutMs: overrides.timeoutMs ?? config.ocrTimeoutMs ?? 15000
  };
}

let ocrQueue = Promise.resolve();

export class TesseractCliOcrService implements OcrService {
  constructor(private readonly ocrConfig = resolveOcrConfig()) {}

  async recognizeImage(input: OcrRecognizeInput): Promise<OcrResult> {
    if (!this.ocrConfig.enabled) {
      return buildOcrResult("disabled");
    }
    if (input.imageBytes > this.ocrConfig.maxImageBytes) {
      return buildOcrResult("too_large", null, `image bytes ${input.imageBytes} exceeds max ${this.ocrConfig.maxImageBytes}`, "TOO_LARGE");
    }
    if (input.imagePixels && input.imagePixels > this.ocrConfig.maxImagePixels) {
      return buildOcrResult("too_large", null, `image pixels ${input.imagePixels} exceeds max ${this.ocrConfig.maxImagePixels}`, "TOO_LARGE");
    }

    return withOcrSlot(async () => {
      try {
        const { stdout } = await execFileAsync("tesseract", [input.imagePath, "stdout", "-l", this.ocrConfig.lang], {
          timeout: this.ocrConfig.timeoutMs,
          maxBuffer: 1024 * 1024 * 2,
          env: { ...process.env, OMP_THREAD_LIMIT: "1" }
        });
        const text = normalizeOcrText(stdout);
        if (text.length < this.ocrConfig.minTextLength) {
          return buildOcrResult("empty", text, `OCR text length ${text.length} below min ${this.ocrConfig.minTextLength}`, "EMPTY_TEXT");
        }
        return buildOcrResult("success", text);
      } catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") {
          return buildOcrResult("provider_missing", null, "tesseract binary not found", "PROVIDER_MISSING");
        }
        if (isTesseractLanguageMissing(error, this.ocrConfig.lang)) {
          return buildOcrResult("language_missing", null, safeOcrErrorSummary(error), "LANG_MISSING");
        }
        return buildOcrResult("failed", null, safeOcrErrorSummary(error), "EXEC_ERROR");
      }
    });
  }
}

async function withOcrSlot<T>(task: () => Promise<T>): Promise<T> {
  const previous = ocrQueue.catch(() => undefined);
  let release: () => void = () => undefined;
  ocrQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

export function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function safeOcrErrorSummary(error: unknown, maxLength = 300): string {
  const record = typeof error === "object" && error ? error as Record<string, unknown> : {};
  const parts = [
    typeof record.message === "string" ? record.message : undefined,
    typeof record.stderr === "string" ? record.stderr : undefined,
    Buffer.isBuffer(record.stderr) ? record.stderr.toString("utf8") : undefined,
    typeof record.stdout === "string" ? record.stdout : undefined,
    Buffer.isBuffer(record.stdout) ? record.stdout.toString("utf8") : undefined,
    typeof error === "string" ? error : undefined
  ].filter((part): part is string => Boolean(part));
  let summary = (parts.join(" ") || String(error ?? "unknown error"))
    .replace(/\s+/g, " ")
    .trim();
  for (const secret of [
    process.env.ADMIN_TOKEN,
    process.env.LINE_CHANNEL_SECRET,
    process.env.LINE_CHANNEL_ACCESS_TOKEN,
    process.env.GPT_ACTION_BEARER_TOKEN
  ]) {
    if (secret && secret.length >= 6) {
      summary = summary.split(secret).join("[redacted]");
    }
  }
  return summary.slice(0, maxLength);
}

function buildOcrResult(status: OcrStatus, text: string | null = null, error?: string, errorCode?: OcrErrorCode): OcrResult {
  return {
    status,
    provider: "tesseract",
    text,
    textLength: text?.length ?? 0,
    errorCode,
    error
  };
}

function isTesseractLanguageMissing(error: unknown, lang: string): boolean {
  const summary = safeOcrErrorSummary(error, 2000).toLowerCase();
  const requestedLangs = lang.split("+").map((item) => item.trim().toLowerCase()).filter(Boolean);
  return (
    summary.includes("failed loading language") ||
    summary.includes("couldn't load any languages") ||
    summary.includes("error opening data file") ||
    requestedLangs.some((requestedLang) => summary.includes(`${requestedLang}.traineddata`))
  );
}
