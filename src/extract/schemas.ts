import { z } from "zod";

export const extractedIntelSchema = z.object({
  source: z.string(),
  title: z.string().optional(),
  summary: z.string().optional(),
  tickers: z.array(z.string()).default([]),
  topics: z.array(z.string()).default([]),
  eventType: z.string().optional(),
  catalystFlags: z.array(z.string()).default([]),
  riskFlags: z.array(z.string()).default([]),
  credibilityScore: z.number().min(0).max(100).default(50),
  evidenceRefs: z.array(z.string()).default([])
});

export type ExtractedIntel = z.infer<typeof extractedIntelSchema>;

export const manualPackInputSchema = z.object({
  date: z.string(),
  packType: z.enum(["premarket", "intraday", "postmarket", "weekly", "ad_hoc"]),
  officialMarketSnapshot: z.record(z.unknown()).optional(),
  institutionalFlows: z.array(z.record(z.unknown())).default([]),
  marginShort: z.array(z.record(z.unknown())).default([]),
  mopsMaterialNews: z.array(z.record(z.unknown())).default([]),
  lineManualNewsEvents: z.array(z.record(z.unknown())).default([]),
  uploadedAttachmentsMetadata: z.array(z.record(z.unknown())).default([]),
  signalEngineResult: z.record(z.unknown()).optional(),
  sectorStrength: z.array(z.record(z.unknown())).default([]),
  tickerCandidates: z.array(z.record(z.unknown())).default([]),
  dataSourceStatus: z.record(z.string()).default({}),
  costGuardStatus: z.record(z.unknown()).default({}),
  dataGaps: z.array(z.string()).default([]),
  lineMessages: z.array(z.record(z.unknown())).default([]),
  newsEvents: z.array(z.record(z.unknown())).default([]),
  marketData: z.array(z.record(z.unknown())).default([]),
  riskFlags: z.array(z.record(z.unknown())).default([]),
  evidence: z.array(z.record(z.unknown())).default([])
});

export type ManualPackInput = z.input<typeof manualPackInputSchema>;
export type ManualPackData = z.infer<typeof manualPackInputSchema>;
