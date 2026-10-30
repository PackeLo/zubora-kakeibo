import { describe, expect, it } from "vitest";
import { movePeriod, periodRange } from "../../app/front/src/utils/period";
import { formatMoney } from "../../app/front/src/utils/display";

describe("dashboard periods and money", () => {
  it("uses complete calendar months including leap days and complete years", () => {
    expect(periodRange({ mode: "month", month: "2024-02" })).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(periodRange({ mode: "month", month: "2025-02" })).toEqual({ from: "2025-02-01", to: "2025-02-28" });
    expect(periodRange({ mode: "year", year: 2026 })).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
  it("moves across year boundaries and rejects invalid input", () => {
    expect(movePeriod({ mode: "month", month: "2025-12" }, 1)).toEqual({ mode: "month", month: "2026-01" });
    expect(movePeriod({ mode: "month", month: "2026-01" }, -1)).toEqual({ mode: "month", month: "2025-12" });
    expect(movePeriod({ mode: "year", year: 2026 }, -1)).toEqual({ mode: "year", year: 2025 });
    expect(() => periodRange({ mode: "month", month: "2026-13" })).toThrow();
  });
  it("formats currencies from their minor units", () => {
    expect(formatMoney(12345, "USD")).toContain("123.45");
    expect(formatMoney(12345, "JPY")).toContain("12,345");
  });
});
