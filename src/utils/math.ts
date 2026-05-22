export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export function roundToTick(price: number): number {
  if (price < 10) return roundBy(price, 0.01);
  if (price < 50) return roundBy(price, 0.05);
  if (price < 100) return roundBy(price, 0.1);
  if (price < 500) return roundBy(price, 0.5);
  if (price < 1000) return roundBy(price, 1);
  return roundBy(price, 5);
}

function roundBy(value: number, tick: number): number {
  return Number((Math.round(value / tick) * tick).toFixed(2));
}
