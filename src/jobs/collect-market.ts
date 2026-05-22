import { todayTaipei } from "../utils/date.js";
import { TwsePublicProvider } from "../providers/market/twse-public.provider.js";
import { TpexPublicProvider } from "../providers/market/tpex-public.provider.js";
import { MopsPublicProvider } from "../providers/market/mops-public.provider.js";
import { FutuMarketProvider } from "../providers/market/futu.provider.js";
import { buildDailyMarketSnapshot } from "../market/daily-market-snapshot.js";

export async function collectMarketJob(date = todayTaipei()) {
  const twse = new TwsePublicProvider();
  const tpex = new TpexPublicProvider();
  const providers = [twse, tpex, new MopsPublicProvider(), new FutuMarketProvider()];
  const indexDaily = (await Promise.all(providers.map((provider) => provider.getIndexDaily(date)))).flat();
  const [twseMi, tpexIndex, twseInst, tpexInst, twseMargin, tpexMargin] = await Promise.all([
    twse.fetchDailyPricesRaw(date),
    tpex.fetchIndexRaw(date),
    twse.fetchInstitutionalRaw(date),
    tpex.fetchInstitutionalRaw(date),
    twse.fetchMarginRaw(date),
    tpex.fetchMarginRaw(date)
  ]);
  const breadth = [
    ...(twseMi ? [twse.normalizeMarketBreadth(twseMi, date)] : []),
    ...(tpexIndex ? [tpex.normalizeMarketBreadth(tpexIndex, date)] : [])
  ];
  const institutional = [
    ...(twseInst ? [twse.normalizeInstitutionalSummary(twseInst, date)] : []),
    ...(tpexInst ? [tpex.normalizeInstitutionalSummary(tpexInst, date)] : [])
  ];
  const margin = [
    ...(twseMargin ? [twse.normalizeMarginSummary(twseMargin, date)] : []),
    ...(tpexMargin ? [tpex.normalizeMarginSummary(tpexMargin, date)] : [])
  ];
  const dataGaps = [
    !twseMi && "twse_mi_index_unavailable",
    !tpexIndex && "tpex_index_unavailable",
    !twseInst && "twse_institutional_unavailable",
    !tpexInst && "tpex_institutional_unavailable",
    !twseMargin && "twse_margin_unavailable",
    !tpexMargin && "tpex_margin_unavailable"
  ].filter((gap): gap is string => Boolean(gap));
  const sourceStatus = {
    twse_mi_index: twseMi ? "ok" : "network_error",
    tpex_index: tpexIndex ? "ok" : "network_error",
    twse_institutional: twseInst ? "ok" : "network_error",
    tpex_institutional: tpexInst ? "ok" : "network_error",
    twse_margin: twseMargin ? "ok" : "network_error",
    tpex_margin: tpexMargin ? "ok" : "network_error",
    futu: "disabled"
  };
  const snapshot = buildDailyMarketSnapshot({ tradeDate: date, indexes: indexDaily, breadth, institutional, margin, dataGaps, sourceStatus });
  return { ok: true, date, indexDaily, breadth, institutional, margin, snapshot, dataGaps, sourceStatus };
}
