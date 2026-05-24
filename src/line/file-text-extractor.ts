import { config } from "../config.js";

export type FileExtractionStatus = "success" | "empty" | "unsupported" | "too_large" | "disabled" | "error";

export type FileIngestConfig = {
  enabled: boolean;
  maxBytes: number;
  textMaxChars: number;
  fullTextMaxChars: number;
};

export type LineFileTextInput = {
  body: Buffer;
  fileName: string;
  mimeType?: string;
};

export type FileTextExtractionResult = {
  status: FileExtractionStatus;
  text: string | null;
  fileType: string;
  dataGaps: string[];
  metadata: Record<string, unknown>;
  error?: string;
};

export interface FileTextExtractor {
  extractText(input: LineFileTextInput): Promise<FileTextExtractionResult>;
}

export function resolveFileIngestConfig(overrides: Partial<FileIngestConfig> = {}): FileIngestConfig {
  return {
    enabled: overrides.enabled ?? config.fileIngestEnabled ?? true,
    maxBytes: overrides.maxBytes ?? config.fileMaxBytes ?? 10485760,
    textMaxChars: overrides.textMaxChars ?? config.fileTextMaxChars ?? 12000,
    fullTextMaxChars: overrides.fullTextMaxChars ?? config.fileFullTextMaxChars ?? 50000
  };
}

export class DefaultFileTextExtractor implements FileTextExtractor {
  constructor(private readonly ingestConfig = resolveFileIngestConfig()) {}

  async extractText(input: LineFileTextInput): Promise<FileTextExtractionResult> {
    const fileType = detectFileType(input.fileName, input.mimeType);
    const baseMetadata = {
      file_type: fileType,
      mime_type: input.mimeType,
      filename: input.fileName
    };

    if (!this.ingestConfig.enabled) {
      return buildFileResult("disabled", fileType, null, ["file_only", "file_ingest_disabled", "text_missing"], baseMetadata);
    }
    if (input.body.length > this.ingestConfig.maxBytes) {
      return buildFileResult("too_large", fileType, null, ["file_only", "file_too_large", "text_extraction_skipped", "text_missing"], baseMetadata);
    }

    try {
      if (isPlainTextFile(fileType)) {
        return resultFromText(normalizeExtractedText(input.body.toString("utf8")), fileType, baseMetadata);
      }
      if (fileType === "pdf") {
        const text = normalizeExtractedText(await extractPdfText(input.body));
        return text
          ? resultFromText(text, fileType, baseMetadata)
          : buildFileResult("empty", fileType, null, ["file_only", "text_extraction_failed", "pdf_text_empty", "pdf_ocr_not_available", "text_missing"], baseMetadata);
      }
      if (fileType === "docx" || fileType === "xlsx") {
        return buildFileResult("unsupported", fileType, null, ["file_only", "file_type_not_supported", "text_missing"], baseMetadata);
      }
      return buildFileResult("unsupported", fileType, null, ["file_only", "file_type_not_supported", "text_missing"], baseMetadata);
    } catch (error) {
      return buildFileResult("error", fileType, null, ["file_only", "text_extraction_failed", "text_missing"], {
        ...baseMetadata,
        error: safeError(error)
      }, safeError(error));
    }
  }
}

export function detectFileType(fileName: string, mimeType?: string): string {
  const lowerName = fileName.toLowerCase();
  const lowerMime = (mimeType ?? "").toLowerCase();
  if (lowerMime.includes("pdf") || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerMime.includes("markdown") || lowerName.endsWith(".md")) return "md";
  if (lowerMime.includes("csv") || lowerName.endsWith(".csv")) return "csv";
  if (lowerMime.includes("json") || lowerName.endsWith(".json")) return "json";
  if (lowerMime.includes("text") || lowerName.endsWith(".txt")) return "txt";
  if (lowerName.endsWith(".docx") || lowerMime.includes("wordprocessingml")) return "docx";
  if (lowerName.endsWith(".xlsx") || lowerMime.includes("spreadsheetml")) return "xlsx";
  return "unsupported";
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isPlainTextFile(fileType: string): boolean {
  return ["txt", "md", "csv", "json"].includes(fileType);
}

function resultFromText(text: string, fileType: string, metadata: Record<string, unknown>): FileTextExtractionResult {
  if (!text) {
    return buildFileResult("empty", fileType, null, ["file_only", "text_extraction_failed", "text_missing"], metadata);
  }
  return buildFileResult("success", fileType, text, ["file_extracted_text"], {
    ...metadata,
    extracted_text_length: text.length
  });
}

function buildFileResult(
  status: FileExtractionStatus,
  fileType: string,
  text: string | null,
  dataGaps: string[],
  metadata: Record<string, unknown>,
  error?: string
): FileTextExtractionResult {
  return {
    status,
    text,
    fileType,
    dataGaps,
    metadata,
    error
  };
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parsed = await tryPdfParse(buffer);
  if (parsed) return parsed;
  return extractPdfTextFallback(buffer);
}

async function tryPdfParse(buffer: Buffer): Promise<string | null> {
  try {
    const moduleName = "pdf-parse";
    const mod = await import(moduleName) as { default?: (input: Buffer) => Promise<{ text?: string }> };
    const parse = mod.default;
    if (!parse) return null;
    const result = await parse(buffer);
    return result.text ?? null;
  } catch {
    return null;
  }
}

function extractPdfTextFallback(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const parts: string[] = [];
  for (const match of raw.matchAll(/\(([^()]{2,500})\)\s*Tj/g)) {
    parts.push(decodePdfText(match[1] ?? ""));
  }
  for (const match of raw.matchAll(/<([0-9A-Fa-f]{4,})>\s*Tj/g)) {
    parts.push(decodeHexPdfText(match[1] ?? ""));
  }
  return parts.join("\n");
}

function decodePdfText(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\\t/g, " ")
    .replace(/\\([()\\])/g, "$1");
}

function decodeHexPdfText(hex: string): string {
  try {
    const source = Buffer.from(hex, "hex");
    if (source.length % 2 === 0) {
      const swapped = Buffer.alloc(source.length);
      for (let index = 0; index < source.length; index += 2) {
        swapped[index] = source[index + 1] ?? 0;
        swapped[index + 1] = source[index] ?? 0;
      }
      return swapped.toString("utf16le");
    }
    return source.toString("utf8");
  } catch {
    return "";
  }
}

function safeError(error: unknown): string {
  return String(error).slice(0, 240);
}
