import type { NextFunction, Request, Response } from "express";
import { config } from "../config.js";

export function requireGptActionAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (!token || token !== config.gptActionBearerToken) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
