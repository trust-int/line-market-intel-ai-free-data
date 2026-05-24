import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config.js";

const execFileAsync = promisify(execFile);

export type OcrStatus = "success" | "failed" | "disabled" | "too_large" | "provider_missing" | "error";

export type OcrConfig = {
  enabled: boolean;
  provider: "tesseract";
  lang: string;
  minTextLength: number;
  maxImageBytes: number;
};

export type OcrResult = {
  status: OcrStatus;
  provider: "tesseract";
  text: string | null;
  textLength: number;
  error?: string;
};

export type OcrRecognizeInput = {
  imagePath: string;
  imageBytes: number;
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
    maxImageBytes: overrides.maxImageBytes ?? config.ocrMaxImageBytes ?? 5242880
  };
}

export class TesseractCliOcrService implements OcrService {
  constructor(private readonly ocrConfig = resolveOcrConfig()) {}

  async recognizeImage(input: OcrRecognizeInput): Promise<OcrResult> {
    if (!this.ocrConfig.enabled) {
      return buildOcrResult("disabled");
    }
    if (input.imageBytes > this.ocrConfig.maxImageBytes) {
      return buildOcrResult("too_large");
    }

    try {
      const { stdout } = await execFileAsync("tesseract", [input.imagePath, "stdout", "-l", this.ocrConfig.lang], {
        timeout: 30000,
        maxBuffer: 1024 * 1024 * 4
      });
      const text = normalizeOcrText(stdout);
      if (text.length < this.ocrConfig.minTextLength) {
        return buildOcrResult("failed", text);
      }
      return buildOcrResult("success", text);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "ENOENT") {
        return buildOcrResult("provider_missing", null, "tesseract binary not found");
      }
      return buildOcrResult("error", null, String(error));
    }
  }
}

export function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildOcrResult(status: OcrStatus, text: string | null = null, error?: string): OcrResult {
  return {
    status,
    provider: "tesseract",
    text,
    textLength: text?.length ?? 0,
    error
  };
}
