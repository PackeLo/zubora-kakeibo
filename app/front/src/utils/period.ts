export type DashboardPeriod = { mode: "month"; month: string } | { mode: "year"; year: number };

export function periodRange(period: DashboardPeriod) {
  const year = period.mode === "year" ? period.year : Number(period.month.slice(0, 4));
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error("年を確認してね。");
  if (period.mode === "year") return { from: `${year}-01-01`, to: `${year}-12-31` };
  const month = Number(period.month.slice(5));
  if (!/^\d{4}-\d{2}$/.test(period.month) || month < 1 || month > 12) throw new Error("月を確認してね。");
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { from: `${period.month}-01`, to: end };
}

export function movePeriod(period: DashboardPeriod, step: number): DashboardPeriod {
  if (period.mode === "year") return { mode: "year", year: Math.max(1000, Math.min(9999, period.year + step)) };
  const date = new Date(`${period.month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + step);
  if (date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) return period;
  return { mode: "month", month: date.toISOString().slice(0, 7) };
}
