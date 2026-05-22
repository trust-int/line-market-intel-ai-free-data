export function classifyEventType(text: string): string {
  if (/法說|財報|營收/.test(text)) return "fundamental";
  if (/Fed|CPI|通膨|利率|美元/.test(text)) return "macro";
  if (/處置|注意|警示|違約/.test(text)) return "risk";
  if (/訂單|合作|併購|投資/.test(text)) return "catalyst";
  return "general";
}
