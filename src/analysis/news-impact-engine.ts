import type { NewsItem } from "../providers/news/provider.js";
import type { NewsImpact } from "./schemas.js";

export class NewsImpactEngine {
  classify(items: NewsItem[]): NewsImpact[] {
    return items.map((item, index) => {
      const text = `${item.title} ${item.summary ?? ""} ${item.rawText ?? ""}`;
      const negative = /升息|制裁|下修|違約|戰爭|禁令|衰退/.test(text);
      const positive = /降息|訂單|合作|上修|需求|擴產|補助/.test(text);
      return {
        event_id: `${item.source}-${item.publishedAt ?? item.fetchedAt}-${index}`,
        title: item.title,
        source: item.source,
        impact_level: item.credibilityScore > 80 ? "high" : item.credibilityScore > 55 ? "medium" : "low",
        market_direction: positive && !negative ? "偏多" : negative && !positive ? "偏空" : "不確定",
        affected_themes: item.topics,
        affected_tickers: item.tickers,
        reason: "依使用者提供內容的關鍵字、可信度與標的關聯做初步分類",
        confidence_score: Math.min(85, Math.max(30, item.credibilityScore))
      };
    });
  }
}
