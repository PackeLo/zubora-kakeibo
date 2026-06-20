import type { AssetType, EntryType, SourceType } from "../domain/types";

export interface ActionEntrySourceInput {
  sourceType: SourceType;
  displayName?: string | null;
  sourceFileName?: string | null;
  sourceSha256?: string | null;
  rawInputSummary?: string | null;
  rawText?: string | null;
  rawPayloadJson?: unknown;
  items: ActionEntrySourceItemInput[];
}

export interface ActionEntrySourceItemInput {
  entryType: EntryType;
  subjectUserId?: string | null;
  entryDate?: string | null;
  amount?: number | null;
  currency?: string;
  target?: string | null;
  categoryCodeGuess?: string | null;
  categoryNameGuess?: string | null;
  tags?: string[];
  confidence?: number | null;
  memo?: string | null;
}

export interface PostEntrySourceItemInput {
  entryType: EntryType;
  entryDate: string;
  amount: number;
  currency?: string;
  subjectUserId: string;
  categoryId?: string | null;
  tagIds?: string[];
  target?: string | null;
  memo?: string | null;
}

export interface ManualEntryInput extends PostEntrySourceItemInput {
  sourceDisplayName?: string | null;
}

export interface EntryUpdateInput {
  entryType?: EntryType;
  entryDate?: string;
  amount?: number;
  currency?: string;
  subjectUserId?: string | null;
  categoryId?: string | null;
  tagIds?: string[];
  target?: string | null;
  memo?: string | null;
}

export interface CategoryInput {
  code: string;
  name: string;
  kind: EntryType;
  sortOrder?: number;
  dedupeEnabled?: boolean;
  isActive?: boolean;
}

export interface TagInput {
  name: string;
  isActive?: boolean;
}

export interface FinancialAssetInput {
  ownerUserId?: string | null;
  name: string;
  assetType: AssetType;
  quantityText?: string | null;
  valuationMinor?: number | null;
  currency?: string;
  valuationNote?: string | null;
}

export interface ConfirmExternalBackupInput {
  exportId: string;
  contentSha256: string;
  externalStorageNote?: string | null;
}
