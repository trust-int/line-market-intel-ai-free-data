import crypto from "node:crypto";

export function sha256Hex(input: Buffer | string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function hmacSha256Base64(secret: string, input: Buffer | string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("base64");
}

export function hmacSha256Hex(secret: string, input: Buffer | string): string {
  return crypto.createHmac("sha256", secret).update(input).digest("hex");
}
