import { DomainValidationError } from "./errors";

export function assertPositiveAmount(amount: number, field = "amount"): void {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new DomainValidationError(`${field} must be a positive integer`);
  }
}

export function assertNullableAmount(amount: number | null | undefined, field = "amount"): void {
  if (amount == null) return;
  if (!Number.isInteger(amount) || amount < 0) {
    throw new DomainValidationError(`${field} must be a non-negative integer`);
  }
}

export function formatJpy(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(amount);
}
