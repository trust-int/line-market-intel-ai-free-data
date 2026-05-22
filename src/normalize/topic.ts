const TOPIC_KEYWORDS: Record<string, string[]> = {
  AI: ["AI", "人工智慧", "伺服器", "GB200", "CoWoS", "散熱"],
  半導體: ["半導體", "晶圓", "封測", "台積電", "IC設計"],
  電力: ["重電", "電力", "變壓器", "電網"],
  軍工: ["軍工", "航太", "國防"],
  金融: ["金控", "銀行", "保險"],
  航運: ["貨櫃", "航運", "散裝", "運價"],
  宏觀: ["Fed", "利率", "通膨", "CPI", "美元", "美債"]
};

export function classifyTopics(text: string): string[] {
  const found: string[] = [];
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => text.toLowerCase().includes(keyword.toLowerCase()))) {
      found.push(topic);
    }
  }
  return found;
}
