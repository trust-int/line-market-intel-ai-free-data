export const TAIPEI_TIME_ZONE = "Asia/Taipei";

export function formatTaipeiDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function formatTaipeiDateTime(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
  return parts.replace(" ", "T") + "+08:00";
}

export function compactDate(date: string): string {
  return date.replaceAll("-", "");
}

export function todayTaipei(): string {
  return formatTaipeiDate(new Date());
}
