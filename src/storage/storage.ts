import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { sha256Hex } from "../utils/hash.js";

export type StoredObject = {
  filePath: string;
  sha256: string;
  bytes: number;
  mimeType?: string;
};

export interface StorageProvider {
  putObject(params: {
    namespace: string;
    fileName: string;
    body: Buffer;
    mimeType?: string;
  }): Promise<StoredObject>;
}

export class PrivateStorage implements StorageProvider {
  constructor(private readonly rootDir = config.storageDir) {}

  async putObject(params: {
    namespace: string;
    fileName: string;
    body: Buffer;
    mimeType?: string;
  }): Promise<StoredObject> {
    const sha256 = sha256Hex(params.body);
    const safeName = sanitizeFileName(params.fileName);
    const dir = path.join(this.rootDir, params.namespace, sha256.slice(0, 2), sha256.slice(2, 4));
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, safeName);
    await writeFile(filePath, params.body);
    return {
      filePath,
      sha256,
      bytes: params.body.length,
      mimeType: params.mimeType
    };
  }
}

export function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 160) || "attachment.bin";
}
