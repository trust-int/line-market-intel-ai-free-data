import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../../config.js";
import { sha256Hex } from "../../utils/hash.js";
import { logger } from "../../utils/logger.js";

export type RawArchiveRecord = {
  provider: string;
  dataset: string;
  tradeDate: string;
  url: string;
  filePath: string;
  sha256: string;
  archivedAt: string;
};

export class OfficialRawArchive {
  constructor(private readonly rootDir = path.join(config.storageDir, "..", "raw-official")) {}

  async save(params: {
    provider: string;
    dataset: string;
    tradeDate: string;
    url: string;
    rawText: string;
  }): Promise<RawArchiveRecord> {
    const sha256 = sha256Hex(params.rawText);
    const dir = path.join(this.rootDir, params.provider, params.tradeDate);
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `${params.dataset}-${sha256.slice(0, 12)}.json`);
    await writeFile(filePath, params.rawText, "utf8");
    return {
      provider: params.provider,
      dataset: params.dataset,
      tradeDate: params.tradeDate,
      url: params.url,
      filePath,
      sha256,
      archivedAt: new Date().toISOString()
    };
  }
}

export async function fetchOfficialJson(
  params: {
    provider: string;
    dataset: string;
    tradeDate: string;
    url: string;
  },
  archive = new OfficialRawArchive()
): Promise<unknown | undefined> {
  try {
    const response = await fetch(params.url, {
      headers: {
        "User-Agent": "line-market-intel-ai-free-data/0.1",
        Accept: "application/json,text/html;q=0.9,*/*;q=0.8"
      }
    });
    const rawText = await response.text();
    await archive.save({ ...params, rawText });
    if (!response.ok) {
      logger.warn("official endpoint returned non-OK status", { url: params.url, status: response.status });
      return undefined;
    }
    return JSON.parse(rawText) as unknown;
  } catch (error) {
    logger.warn("official endpoint unavailable", { url: params.url, error: String(error) });
    return undefined;
  }
}

export function parseNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.replaceAll(",", "").replaceAll("--", "").replace("%", "").replace(/\([^)]*\)/g, "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseSignedNumber(value: unknown): number | undefined {
  if (typeof value !== "string") return parseNumber(value);
  const cleaned = value.replace(/[+]/g, "");
  return parseNumber(cleaned);
}

export function fieldIndex(fields: string[], candidates: string[]): number {
  return fields.findIndex((field) => candidates.some((candidate) => normalizeHeader(field).includes(normalizeHeader(candidate))));
}

export function normalizeHeader(value: string): string {
  return value.replace(/\s|\u3000|\(|\)|（|）|%|,/g, "").toLowerCase();
}

export function getByField(row: unknown[], fields: string[], candidates: string[]): unknown {
  const index = fieldIndex(fields, candidates);
  return index >= 0 ? row[index] : undefined;
}

export function rocDateToIso(rocDate: string): string {
  const match = rocDate.match(/^(\d{2,3})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return rocDate;
  const year = Number(match[1]) + 1911;
  return `${year}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`;
}

export function isoToRocDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(year) - 1911}/${month}/${day}`;
}
