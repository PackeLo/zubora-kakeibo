import type { ArchiveYear, EntryWithDetails } from "./types";
import { yearRange } from "./dates";

export interface ArchiveStats {
  entryCount: number;
  expenseCount: number;
  incomeCount: number;
  totalExpense: number;
  totalIncome: number;
  currency: string;
}

export function summarizeEntries(entries: EntryWithDetails[]): ArchiveStats {
  return entries.reduce<ArchiveStats>(
    (stats, entry) => {
      stats.entryCount += 1;
      if (entry.entryType === "expense") {
        stats.expenseCount += 1;
        stats.totalExpense += entry.amount;
      } else {
        stats.incomeCount += 1;
        stats.totalIncome += entry.amount;
      }
      return stats;
    },
    { entryCount: 0, expenseCount: 0, incomeCount: 0, totalExpense: 0, totalIncome: 0, currency: "JPY" }
  );
}

export function archiveFilename(year: number): string {
  return `kakeibo-archive-${year}-v1.ndjson.gz`;
}

export function archiveHeader(exportId: string, year: number, createdAt: string): Record<string, unknown> {
  const period = yearRange(year);
  return {
    type: "archive_header",
    format_version: 1,
    export_id: exportId,
    year,
    period,
    timezone: "Asia/Tokyo",
    created_at: createdAt,
    app_schema_version: 1
  };
}

export function archiveFooter(exportId: string, stats: ArchiveStats, payloadSha256: string): Record<string, unknown> {
  return {
    type: "archive_footer",
    export_id: exportId,
    counts: {
      entries: stats.entryCount,
      expense_entries: stats.expenseCount,
      income_entries: stats.incomeCount
    },
    totals: {
      expense: stats.totalExpense,
      income: stats.totalIncome,
      currency: stats.currency
    },
    payload_sha256: payloadSha256
  };
}

export function archiveEntryRecord(entry: EntryWithDetails): Record<string, unknown> {
  return {
    type: "entry",
    id: entry.id,
    entry_type: entry.entryType,
    entry_date: entry.entryDate,
    amount: entry.amount,
    currency: entry.currency,
    subject_user_id: entry.subjectUserId ?? null,
    category: entry.category
      ? {
          id: entry.category.id,
          code: entry.category.code,
          name: entry.category.name
        }
      : null,
    tags: entry.tags.map((tag) => ({ id: tag.id, name: tag.name })),
    target: entry.target ?? null,
    memo: entry.memo ?? null,
    entry_source: entry.source
      ? {
          id: entry.source.id,
          source_type: entry.source.sourceType,
          source_file_name: entry.source.sourceFileName ?? null,
          source_sha256: entry.source.sourceSha256 ?? null
        }
      : null,
    fixed_at: entry.fixedAt ?? null
  };
}

export function canPurgeArchiveYear(archiveYear: ArchiveYear): boolean {
  return archiveYear.status === "external_confirmed";
}
