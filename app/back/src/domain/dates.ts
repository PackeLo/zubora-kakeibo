import { DomainValidationError } from "./errors";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDate(timeZone = "Asia/Tokyo"): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

export function assertIsoDate(value: string, field = "date"): void {
  if (!DATE_RE.test(value)) {
    throw new DomainValidationError(`${field} must be YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new DomainValidationError(`${field} must be a real calendar date`);
  }
}

export function monthOf(date: string): string {
  assertIsoDate(date);
  return date.slice(0, 7);
}

export function yearOf(date: string): number {
  assertIsoDate(date);
  return Number(date.slice(0, 4));
}

export function daysBetween(a: string, b: string): number {
  assertIsoDate(a, "a");
  assertIsoDate(b, "b");
  const aMs = Date.parse(`${a}T00:00:00Z`);
  const bMs = Date.parse(`${b}T00:00:00Z`);
  return Math.abs(Math.round((aMs - bMs) / 86_400_000));
}

export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function archiveTargetYear(currentYear: number, liveCompletedYearsToKeep: number): number {
  return currentYear - liveCompletedYearsToKeep - 1;
}
