export const TAIPEI_TIME_ZONE = "Asia/Taipei";

export function formatTaipeiDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TAIPEI_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function getTaipeiDateString(date = new Date()): string {
  return formatTaipeiDate(date);
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

export type ManualNewsWindowTaipei = {
  date: string;
  start: string;
  end: string;
  cutoverTime: "15:30";
};

export function manualNewsDateTaipei(date = new Date()): string {
  const taipeiDateTime = formatTaipeiDateTime(date);
  const localDate = taipeiDateTime.slice(0, 10);
  const localTime = taipeiDateTime.slice(11, 16);
  return localTime >= "15:30" ? localDate : addTaipeiCalendarDays(localDate, -1);
}

export function manualNewsWindowTaipei(date = new Date()): ManualNewsWindowTaipei {
  const newsDate = manualNewsDateTaipei(date);
  return {
    date: newsDate,
    start: `${newsDate}T15:30:00+08:00`,
    end: `${addTaipeiCalendarDays(newsDate, 1)}T15:30:00+08:00`,
    cutoverTime: "15:30"
  };
}

function addTaipeiCalendarDays(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00+08:00`);
  base.setUTCDate(base.getUTCDate() + days);
  return formatTaipeiDate(base);
}
