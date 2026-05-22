import { config } from "./config.js";

export type OfficialDataMode = "auto" | "live" | "fixture";

export function getOfficialDataMode(mode?: string): OfficialDataMode {
  const value = mode ?? config.officialDataMode;
  if (value === "live" || value === "fixture" || value === "auto") return value;
  return "auto";
}

export function officialDataModeNotice(mode: OfficialDataMode): string | undefined {
  if (mode === "fixture") return "測試資料，不可用於真實市場判斷";
  if (mode === "auto") return "auto 模式：live fetch 失敗時可使用 fixture fallback，必須標示 source_status 與 data_gaps";
  return "live 模式：live fetch 失敗時不使用 fixture fallback";
}
