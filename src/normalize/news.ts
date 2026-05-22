import { classifyEventType } from "./event.js";
import { extractTickers } from "./ticker.js";
import { classifyTopics } from "./topic.js";

export function normalizeNewsText(text: string) {
  return {
    eventType: classifyEventType(text),
    tickers: extractTickers(text),
    topics: classifyTopics(text)
  };
}
