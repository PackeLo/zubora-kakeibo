import type {
  ArchiveExport,
  ArchiveYear,
  Category,
  Entry,
  EntrySource,
  EntrySourceItem,
  FinancialAsset,
  Tag,
  User
} from "../../domain/types";

type Row = Record<string, unknown>;

export function bool(value: unknown): boolean {
  return Number(value) === 1;
}

export function intBool(value: boolean | undefined): number | undefined {
  return value === undefined ? undefined : value ? 1 : 0;
}

export function userFromRow(row: Row): User {
  return {
    id: String(row.id),
    passwordHash: String(row.password_hash),
    displayName: String(row.display_name),
    role: row.role as User["role"],
    isActive: bool(row.is_active),
    createdBy: row.created_by as string | null,
    createdAt: String(row.created_at),
    updatedBy: row.updated_by as string | null,
    updatedAt: String(row.updated_at)
  };
}

export function categoryFromRow(row: Row): Category {
  return {
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    kind: row.kind as Category["kind"],
    sortOrder: Number(row.sort_order),
    dedupeEnabled: bool(row.dedupe_enabled),
    isActive: bool(row.is_active),
    createdBy: row.created_by as string | null,
    createdAt: String(row.created_at),
    updatedBy: row.updated_by as string | null,
    updatedAt: String(row.updated_at)
  };
}

export function tagFromRow(row: Row): Tag {
  return {
    id: String(row.id),
    name: String(row.name),
    isActive: bool(row.is_active),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function entrySourceFromRow(row: Row): EntrySource {
  return {
    id: String(row.id),
    sourceType: row.source_type as EntrySource["sourceType"],
    displayName: row.display_name as string | null,
    sourceFileName: row.source_file_name as string | null,
    sourceSha256: row.source_sha256 as string | null,
    idempotencyKey: row.idempotency_key as string | null,
    rawInputSummary: row.raw_input_summary as string | null,
    rawText: row.raw_text as string | null,
    rawPayloadJson: row.raw_payload_json as string | null,
    status: row.status as EntrySource["status"],
    createdBy: row.created_by as string | null,
    createdAt: String(row.created_at),
    updatedBy: row.updated_by as string | null,
    updatedAt: String(row.updated_at)
  };
}

export function entrySourceItemFromRow(row: Row): EntrySourceItem {
  return {
    id: String(row.id),
    entrySourceId: String(row.entry_source_id),
    itemIndex: Number(row.item_index),
    entryType: row.entry_type as EntrySourceItem["entryType"],
    subjectUserId: row.subject_user_id as string | null,
    entryDate: row.entry_date as string | null,
    amount: row.amount == null ? null : Number(row.amount),
    currency: String(row.currency),
    target: row.target as string | null,
    categoryIdGuess: row.category_id_guess as string | null,
    categoryNameGuess: row.category_name_guess as string | null,
    tagsJson: row.tags_json as string | null,
    memo: row.memo as string | null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    dedupeKey: row.dedupe_key as string | null,
    status: row.status as EntrySourceItem["status"],
    postedEntryId: row.posted_entry_id as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function entryFromRow(row: Row): Entry {
  return {
    id: String(row.id),
    entryType: row.entry_type as Entry["entryType"],
    subjectUserId: row.subject_user_id as string | null,
    entryDate: String(row.entry_date),
    amount: Number(row.amount),
    currency: String(row.currency),
    categoryId: row.category_id as string | null,
    target: row.target as string | null,
    memo: row.memo as string | null,
    entrySourceId: row.entry_source_id as string | null,
    entrySourceItemId: row.entry_source_item_id as string | null,
    dedupeKey: row.dedupe_key as string | null,
    fixedAt: row.fixed_at as string | null,
    archivedAt: row.archived_at as string | null,
    archiveYearId: row.archive_year_id as string | null
  };
}

export function financialAssetFromRow(row: Row): FinancialAsset {
  return {
    id: String(row.id),
    ownerUserId: row.owner_user_id as string | null,
    name: String(row.name),
    assetType: row.asset_type as FinancialAsset["assetType"],
    quantityText: row.quantity_text as string | null,
    valuationMinor: row.valuation_minor == null ? null : Number(row.valuation_minor),
    currency: String(row.currency),
    valuationUpdatedAt: row.valuation_updated_at as string | null,
    valuationNote: row.valuation_note as string | null,
    updatedBy: row.updated_by as string | null,
    isActive: bool(row.is_active),
    createdBy: row.created_by as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function archiveYearFromRow(row: Row): ArchiveYear {
  return {
    id: String(row.id),
    year: Number(row.year),
    status: row.status as ArchiveYear["status"],
    archiveFormat: "ndjson.gz",
    archiveFormatVersion: Number(row.archive_format_version),
    entryCount: Number(row.entry_count),
    expenseCount: Number(row.expense_count),
    incomeCount: Number(row.income_count),
    totalExpense: Number(row.total_expense),
    totalIncome: Number(row.total_income),
    currency: String(row.currency),
    lastExportId: row.last_export_id as string | null,
    lastExportedAt: row.last_exported_at as string | null,
    lastExportedBy: row.last_exported_by as string | null,
    lastContentSha256: row.last_content_sha256 as string | null,
    externalBackupConfirmedAt: row.external_backup_confirmed_at as string | null,
    externalBackupConfirmedBy: row.external_backup_confirmed_by as string | null,
    externalStorageNote: row.external_storage_note as string | null,
    purgedAt: row.purged_at as string | null,
    purgedBy: row.purged_by as string | null,
    errorMessage: row.error_message as string | null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function archiveExportFromRow(row: Row): ArchiveExport {
  return {
    id: String(row.id),
    archiveYearId: String(row.archive_year_id),
    year: Number(row.year),
    filename: String(row.filename),
    archiveFormat: "ndjson.gz",
    archiveFormatVersion: Number(row.archive_format_version),
    contentSha256: row.content_sha256 as string | null,
    entryCount: Number(row.entry_count),
    expenseCount: Number(row.expense_count),
    incomeCount: Number(row.income_count),
    totalExpense: Number(row.total_expense),
    totalIncome: Number(row.total_income),
    generatedBy: row.generated_by as string | null,
    generatedAt: String(row.generated_at),
    completedAt: row.completed_at as string | null,
    status: row.status as ArchiveExport["status"],
    errorMessage: row.error_message as string | null
  };
}
