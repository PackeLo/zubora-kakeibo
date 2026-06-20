export type Role = "admin" | "member";
export type EntryType = "expense" | "income";
export type SourceType =
  | "manual"
  | "receipt"
  | "order_detail"
  | "credit_card_statement"
  | "bank_statement"
  | "handwritten_note"
  | "other";

export type EntrySourceStatus = "pending" | "partially_posted" | "posted";
export type EntrySourceItemStatus = "pending" | "posted";
export type ArchiveYearStatus =
  | "due"
  | "exported"
  | "external_confirmed"
  | "purging"
  | "purged"
  | "failed";

export type AssetType =
  | "cash"
  | "bank_deposit"
  | "investment_trust"
  | "stock"
  | "crypto"
  | "pension"
  | "other";

export interface User {
  id: string;
  passwordHash: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface Actor {
  id: string;
  displayName: string;
  role: Role;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  kind: EntryType;
  sortOrder: number;
  dedupeEnabled: boolean;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface Tag {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EntrySource {
  id: string;
  sourceType: SourceType;
  displayName?: string | null;
  sourceFileName?: string | null;
  sourceSha256?: string | null;
  idempotencyKey?: string | null;
  rawInputSummary?: string | null;
  rawText?: string | null;
  rawPayloadJson?: string | null;
  status: EntrySourceStatus;
  createdBy?: string | null;
  createdAt: string;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface EntrySourceItem {
  id: string;
  entrySourceId: string;
  itemIndex: number;
  entryType: EntryType;
  subjectUserId?: string | null;
  entryDate?: string | null;
  amount?: number | null;
  currency: string;
  target?: string | null;
  categoryIdGuess?: string | null;
  categoryNameGuess?: string | null;
  tagsJson?: string | null;
  memo?: string | null;
  confidence?: number | null;
  dedupeKey?: string | null;
  status: EntrySourceItemStatus;
  postedEntryId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Entry {
  id: string;
  entryType: EntryType;
  subjectUserId?: string | null;
  entryDate: string;
  amount: number;
  currency: string;
  categoryId?: string | null;
  target?: string | null;
  memo?: string | null;
  entrySourceId?: string | null;
  entrySourceItemId?: string | null;
  dedupeKey?: string | null;
  fixedAt?: string | null;
  archivedAt?: string | null;
  archiveYearId?: string | null;
  tagIds?: string[];
}

export interface EntryWithDetails extends Entry {
  category?: Category | null;
  tags: Tag[];
  source?: EntrySource | null;
  sourceItem?: EntrySourceItem | null;
}

export interface FinancialAsset {
  id: string;
  ownerUserId?: string | null;
  name: string;
  assetType: AssetType;
  quantityText?: string | null;
  valuationMinor?: number | null;
  currency: string;
  valuationUpdatedAt?: string | null;
  valuationNote?: string | null;
  updatedBy?: string | null;
  isActive: boolean;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DuplicateExclusion {
  id: string;
  entrySourceItemId: string;
  entryId: string;
  pairKey: string;
  reason?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

export interface DuplicateCandidate {
  item: EntrySourceItem;
  entry: EntryWithDetails;
  score: number;
  reasons: string[];
}

export interface ArchiveYear {
  id: string;
  year: number;
  status: ArchiveYearStatus;
  archiveFormat: "ndjson.gz";
  archiveFormatVersion: number;
  entryCount: number;
  expenseCount: number;
  incomeCount: number;
  totalExpense: number;
  totalIncome: number;
  currency: string;
  lastExportId?: string | null;
  lastExportedAt?: string | null;
  lastExportedBy?: string | null;
  lastContentSha256?: string | null;
  externalBackupConfirmedAt?: string | null;
  externalBackupConfirmedBy?: string | null;
  externalStorageNote?: string | null;
  purgedAt?: string | null;
  purgedBy?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArchiveExport {
  id: string;
  archiveYearId: string;
  year: number;
  filename: string;
  archiveFormat: "ndjson.gz";
  archiveFormatVersion: number;
  contentSha256?: string | null;
  entryCount: number;
  expenseCount: number;
  incomeCount: number;
  totalExpense: number;
  totalIncome: number;
  generatedBy?: string | null;
  generatedAt: string;
  completedAt?: string | null;
  status: "streaming" | "completed" | "failed";
  errorMessage?: string | null;
}

export interface EntryFilters {
  type?: EntryType;
  from?: string;
  to?: string;
  categoryIds?: string[];
  tagIds?: string[];
  subjectUserIds?: string[];
  limit?: number;
}

export interface SummaryFilters extends EntryFilters {
  year?: number;
}

export interface CategoryReferenceCount {
  entries: number;
  entrySourceItems: number;
}

export interface TagReferenceCount {
  entries: number;
  entrySourceItems: number;
}
