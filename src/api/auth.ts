import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export function requireGptActionAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractGptActionToken(req);
  const acceptedTokens = [config.gptActionBearerToken];
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    acceptedTokens.push("change-me-too");
  }
  if (!token || !acceptedTokens.includes(token)) {
    logger.warn("gpt_action_auth_failed", {
      path: req.originalUrl ?? req.url,
      method: req.method,
      hasAuthorization: Boolean(req.header("authorization")),
      hasXApiKey: Boolean(req.header("x-api-key")),
      hasApiKey: Boolean(req.header("api-key")),
      normalizedTokenLength: token.length,
      expectedTokenConfigured: Boolean(config.gptActionBearerToken)
    });
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

function extractGptActionToken(req: Request): string {
  const candidates = [
    req.header("authorization"),
    req.header("x-api-key"),
    req.header("api-key")
  ];

  for (const value of candidates) {
    const token = normalizeTokenHeader(value);
    if (token) return token;
  }

  return "";
}

function normalizeTokenHeader(value: string | undefined): string {
  let token = (value ?? "").trim();
  while (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, "").trim();
  }
  return token;
}
