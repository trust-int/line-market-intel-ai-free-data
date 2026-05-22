const TAIWAN_TICKER_PATTERN = /(?<!\d)([1-9]\d{3})(?!\d)/g;

export function extractTickers(text: string): string[] {
  const matches = [...text.matchAll(TAIWAN_TICKER_PATTERN)]
    .map((match) => match[1])
    .filter((ticker): ticker is string => Boolean(ticker));
  return Array.from(new Set(matches));
}

export function normalizeTicker(ticker: string): string {
  return ticker.trim().replace(/\.TW|\.TWO/gi, "");
}
