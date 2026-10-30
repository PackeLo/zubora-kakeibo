import { describe, expect, it } from "vitest";
import { archiveTargetYear, daysBetween, monthOf } from "@back/domain/dates";
import { createDedupeKey, duplicatePairKey } from "@back/domain/dedupe";
import { archiveEntryRecord, archiveFilename, archiveHeader } from "@back/domain/archive";
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

  it("writes receipt snapshots in archive format version 2", () => {
    expect(archiveFilename(2026)).toBe("kakeibo-archive-2026-v2.ndjson.gz");
    expect(archiveHeader("aexp_1", 2026, "2026-10-28T00:00:00Z")).toMatchObject({ format_version: 2, app_schema_version: 2 });
    const record = archiveEntryRecord({
      id: "ent_1",
      entryType: "expense",
      entryDate: "2026-10-28",
      amount: 500,
      currency: "JPY",
      receiptId: "rct_1",
      tags: []
    }, {
      id: "rct_1",
      entrySourceId: "es_1",
      displayName: "パン屋",
      createdAt: "2026-10-28T00:00:00Z",
      updatedAt: "2026-10-28T00:00:00Z"
    });
    expect(record).toMatchObject({ receipt: { id: "rct_1", display_name: "パン屋" } });
  });
});
