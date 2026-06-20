import { describe, expect, it } from "vitest";
import { archiveTargetYear, daysBetween, monthOf } from "@back/domain/dates";
import { createDedupeKey, duplicatePairKey } from "@back/domain/dedupe";
import { createPieSlices } from "@front/utils/chart";

describe("domain utilities", () => {
  it("calculates archive target year", () => {
    expect(archiveTargetYear(2027, 3)).toBe(2023);
  });

  it("handles date helpers", () => {
    expect(monthOf("2026-06-20")).toBe("2026-06");
    expect(daysBetween("2026-06-01", "2026-06-10")).toBe(9);
  });

  it("creates stable dedupe keys and pair keys", () => {
    expect(createDedupeKey("expense", "JPY", 1280)).toBe("expense:JPY:1280");
    expect(duplicatePairKey("b", "a")).toBe("a:b");
  });

  it("creates pie slices from positive values", () => {
    const slices = createPieSlices([
      { label: "食費", value: 70 },
      { label: "日用品", value: 30 }
    ]);
    expect(slices).toHaveLength(2);
    expect(slices[0].dashArray).toBe("70 30");
  });
});
