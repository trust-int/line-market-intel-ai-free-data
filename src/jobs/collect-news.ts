import { Jin10ManualProvider } from "../providers/news/jin10-manual.provider.js";
import { WallStreetCnManualProvider } from "../providers/news/wallstreetcn-manual.provider.js";
import { FutuNewsManualProvider } from "../providers/news/futu-news-manual.provider.js";

export async function collectNewsJob() {
  const providers = [new Jin10ManualProvider(), new WallStreetCnManualProvider(), new FutuNewsManualProvider()];
  const items = (await Promise.all(providers.map((provider) => provider.fetchLatest({ manualItems: [] })))).flat();
  return { ok: true, count: items.length, items };
}
