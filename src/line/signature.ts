import crypto from "node:crypto";
import { config } from "../config.js";
import { hmacSha256Base64, hmacSha256Hex } from "../utils/hash.js";

export function verifyLineSignature(rawBody: Buffer, signature: string | undefined, secret = config.lineChannelSecret): boolean {
  if (!secret || !signature) return false;
  const expected = hmacSha256Base64(secret, rawBody);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function hashLineUserId(userId: string | undefined, secret = config.userHashSecret): string | undefined {
  if (!userId) return undefined;
  return hmacSha256Hex(secret, userId);
}
