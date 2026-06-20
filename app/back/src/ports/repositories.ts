import type {
  Actor,
  ArchiveExport,
  ArchiveYear,
  Category,
  CategoryReferenceCount,
  DuplicateExclusion,
  Entry,
  EntryFilters,
  EntrySource,
  EntrySourceItem,
  EntryType,
  EntryWithDetails,
  FinancialAsset,
  SourceType,
  SummaryFilters,
  Tag,
  TagReferenceCount,
  User
} from "../domain/types";

export interface UserRepository {
  listActive(): Promise<User[]>;
  findById(id: string): Promise<User | null>;
  upsertAccessUser(actor: Actor): Promise<User>;
}

export interface TaxonomyRepository {
  listCategories(includeInactive?: boolean): Promise<Category[]>;
  listTags(includeInactive?: boolean): Promise<Tag[]>;
  findCategoryById(id: string): Promise<Category | null>;
  findCategoryByCode(code: string, kind?: EntryType): Promise<Category | null>;
  findTagById(id: string): Promise<Tag | null>;
  createCategory(category: Category): Promise<Category>;
  updateCategory(id: string, patch: Partial<Omit<Category, "id" | "createdAt">>): Promise<Category>;
  deleteCategory(id: string): Promise<void>;
  countCategoryReferences(id: string): Promise<CategoryReferenceCount>;
  createTag(tag: Tag): Promise<Tag>;
  updateTag(id: string, patch: Partial<Omit<Tag, "id" | "createdAt">>): Promise<Tag>;
  deleteTag(id: string): Promise<void>;
  countTagReferences(id: string, name: string): Promise<TagReferenceCount>;
}

export interface EntrySourceRepository {
  list(): Promise<EntrySource[]>;
  findById(id: string): Promise<EntrySource | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<EntrySource | null>;
  create(source: EntrySource): Promise<EntrySource>;
  update(id: string, patch: Partial<EntrySource>): Promise<EntrySource>;
  delete(id: string): Promise<void>;
  refreshStatus(id: string): Promise<EntrySourceStatusResult>;
}

export interface EntrySourceStatusResult {
  sourceId: string;
  status: EntrySource["status"];
  remainingItems: number;
}

export interface EntrySourceItemRepository {
  list(filters: { status?: EntrySourceItem["status"]; type?: EntryType; from?: string; to?: string }): Promise<EntrySourceItem[]>;
  listBySourceId(entrySourceId: string): Promise<EntrySourceItem[]>;
  findById(id: string): Promise<EntrySourceItem | null>;
  create(item: EntrySourceItem): Promise<EntrySourceItem>;
  update(id: string, patch: Partial<EntrySourceItem>): Promise<EntrySourceItem>;
  delete(id: string): Promise<void>;
  deleteBySourceId(entrySourceId: string): Promise<void>;
  countBySourceId(entrySourceId: string): Promise<number>;
}

export interface EntryRepository {
  list(filters: EntryFilters): Promise<EntryWithDetails[]>;
  findById(id: string): Promise<EntryWithDetails | null>;
  create(entry: Entry, tagIds: string[]): Promise<EntryWithDetails>;
  update(id: string, patch: Partial<Entry>, tagIds?: string[]): Promise<EntryWithDetails>;
  delete(id: string): Promise<void>;
  listDuplicateCandidates(input: {
    item: EntrySourceItem;
    sourceType: SourceType;
    days: number;
  }): Promise<EntryWithDetails[]>;
  listByYear(year: number): Promise<EntryWithDetails[]>;
  deleteByYear(year: number): Promise<void>;
}

export interface FinancialAssetRepository {
  list(includeInactive?: boolean): Promise<FinancialAsset[]>;
  findById(id: string): Promise<FinancialAsset | null>;
  create(asset: FinancialAsset): Promise<FinancialAsset>;
  update(id: string, patch: Partial<FinancialAsset>): Promise<FinancialAsset>;
  deactivate(id: string, actor: Actor, now: string): Promise<FinancialAsset>;
}

export interface DuplicateRepository {
  findExclusion(pairKey: string): Promise<DuplicateExclusion | null>;
  createExclusion(exclusion: DuplicateExclusion): Promise<DuplicateExclusion>;
  deleteByEntryId(entryId: string): Promise<void>;
  deleteByEntrySourceItemId(entrySourceItemId: string): Promise<void>;
}

export interface SummaryRepository {
  monthly(filters: SummaryFilters): Promise<MonthlySummary[]>;
  daily(filters: SummaryFilters): Promise<DailySummary[]>;
  category(filters: SummaryFilters): Promise<CategorySummary[]>;
  cashflow(year: number): Promise<MonthlySummary[]>;
  actionOverview(filters: SummaryFilters): Promise<ActionOverview>;
}

export interface MonthlySummary {
  month: string;
  incomeTotal: number;
  expenseTotal: number;
  netCashflow: number;
  currency: string;
}

export interface DailySummary {
  date: string;
  incomeTotal: number;
  expenseTotal: number;
  netCashflow: number;
  entryCount: number;
  currency: string;
}

export interface CategorySummary {
  categoryId: string | null;
  categoryName: string;
  amount: number;
  entryCount: number;
  currency: string;
}

export interface ActionOverview {
  from: string;
  to: string;
  incomeTotal: number;
  expenseTotal: number;
  netCashflow: number;
  currency: string;
  monthly: MonthlySummary[];
  topExpenseCategories: CategorySummary[];
  topTags: Array<{ tagId: string; tagName: string; amount: number; entryCount: number; currency: string }>;
  subjectUserTotals: Array<{ subjectUserId: string | null; incomeTotal: number; expenseTotal: number; netCashflow: number; currency: string }>;
}

export interface ArchiveRepository {
  listYears(): Promise<ArchiveYear[]>;
  findYear(year: number): Promise<ArchiveYear | null>;
  createYear(archiveYear: ArchiveYear): Promise<ArchiveYear>;
  updateYear(id: string, patch: Partial<ArchiveYear>): Promise<ArchiveYear>;
  createExport(archiveExport: ArchiveExport): Promise<ArchiveExport>;
  updateExport(id: string, patch: Partial<ArchiveExport>): Promise<ArchiveExport>;
  findExport(id: string): Promise<ArchiveExport | null>;
  findLatestExport(year: number): Promise<ArchiveExport | null>;
  isYearPurged(year: number): Promise<boolean>;
  countPendingSourceItemsForYear(year: number): Promise<number>;
}

export interface UnitOfWork {
  users: UserRepository;
  taxonomy: TaxonomyRepository;
  entrySources: EntrySourceRepository;
  entrySourceItems: EntrySourceItemRepository;
  entries: EntryRepository;
  financialAssets: FinancialAssetRepository;
  duplicates: DuplicateRepository;
  summaries: SummaryRepository;
  archives: ArchiveRepository;
}
