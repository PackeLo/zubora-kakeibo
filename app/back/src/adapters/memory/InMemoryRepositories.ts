import type { Actor, ArchiveExport, ArchiveYear, Category, DuplicateExclusion, Entry, EntryFilters, EntrySource, EntrySourceItem, EntryType, EntryWithDetails, FinancialAsset, SourceType, SummaryFilters, Tag, User } from "../../domain/types";
import type {
  ActionOverview,
  ArchiveRepository,
  CategorySummary,
  DailySummary,
  DuplicateRepository,
  EntryRepository,
  EntrySourceItemRepository,
  EntrySourceRepository,
  FinancialAssetRepository,
  MonthlySummary,
  SummaryRepository,
  TaxonomyRepository,
  UnitOfWork,
  UserRepository
} from "../../ports/repositories";
import { daysBetween, monthOf, nowIso } from "../../domain/dates";

export class InMemoryUnitOfWork implements UnitOfWork {
  users = new MemoryUserRepository();
  taxonomy = new MemoryTaxonomyRepository();
  entrySources = new MemoryEntrySourceRepository();
  entrySourceItems = new MemoryEntrySourceItemRepository();
  duplicates = new MemoryDuplicateRepository();
  financialAssets = new MemoryFinancialAssetRepository();
  archives = new MemoryArchiveRepository();
  entries: EntryRepository;
  summaries: SummaryRepository;

  constructor() {
    this.entries = new MemoryEntryRepository(this.taxonomy, this.entrySources, this.entrySourceItems);
    this.summaries = new MemorySummaryRepository(this.entries);
  }
}

class MemoryUserRepository implements UserRepository {
  rows = new Map<string, User>();

  async listActive(): Promise<User[]> {
    return [...this.rows.values()].filter((user) => user.isActive);
  }

  async findById(id: string): Promise<User | null> {
    return this.rows.get(id) ?? null;
  }

  async upsertAccessUser(actor: Actor): Promise<User> {
    const now = nowIso();
    const existing = this.rows.get(actor.id);
    const user: User = existing
      ? { ...existing, displayName: actor.displayName, role: actor.role, updatedAt: now }
      : {
          id: actor.id,
          passwordHash: "memory",
          displayName: actor.displayName,
          role: actor.role,
          isActive: true,
          createdAt: now,
          updatedAt: now
        };
    this.rows.set(actor.id, user);
    return user;
  }
}

class MemoryTaxonomyRepository implements TaxonomyRepository {
  categories = new Map<string, Category>();
  tags = new Map<string, Tag>();
  entryCategoryRefs = new Map<string, number>();
  sourceItemCategoryRefs = new Map<string, number>();
  tagRefs = new Map<string, number>();
  sourceItemTagRefs = new Map<string, number>();

  async listCategories(includeInactive = false): Promise<Category[]> {
    return [...this.categories.values()].filter((row) => includeInactive || row.isActive).sort((a, b) => a.kind.localeCompare(b.kind) || a.sortOrder - b.sortOrder);
  }

  async listTags(includeInactive = false): Promise<Tag[]> {
    return [...this.tags.values()].filter((row) => includeInactive || row.isActive).sort((a, b) => a.name.localeCompare(b.name));
  }

  async findCategoryById(id: string): Promise<Category | null> {
    return this.categories.get(id) ?? null;
  }

  async findCategoryByCode(code: string, kind?: EntryType): Promise<Category | null> {
    return [...this.categories.values()].find((category) => category.code === code && (!kind || category.kind === kind)) ?? null;
  }

  async findTagById(id: string): Promise<Tag | null> {
    return this.tags.get(id) ?? null;
  }

  async createCategory(category: Category): Promise<Category> {
    this.categories.set(category.id, category);
    return category;
  }

  async updateCategory(id: string, patch: Partial<Omit<Category, "id" | "createdAt">>): Promise<Category> {
    const existing = this.categories.get(id);
    if (!existing) throw new Error("category not found");
    const next = { ...existing, ...defined(patch) };
    this.categories.set(id, next);
    return next;
  }

  async deleteCategory(id: string): Promise<void> {
    this.categories.delete(id);
  }

  async countCategoryReferences(id: string) {
    return {
      entries: this.entryCategoryRefs.get(id) ?? 0,
      entrySourceItems: this.sourceItemCategoryRefs.get(id) ?? 0
    };
  }

  async createTag(tag: Tag): Promise<Tag> {
    this.tags.set(tag.id, tag);
    return tag;
  }

  async updateTag(id: string, patch: Partial<Omit<Tag, "id" | "createdAt">>): Promise<Tag> {
    const existing = this.tags.get(id);
    if (!existing) throw new Error("tag not found");
    const next = { ...existing, ...defined(patch) };
    this.tags.set(id, next);
    return next;
  }

  async deleteTag(id: string): Promise<void> {
    this.tags.delete(id);
  }

  async countTagReferences(id: string) {
    return {
      entries: this.tagRefs.get(id) ?? 0,
      entrySourceItems: this.sourceItemTagRefs.get(id) ?? 0
    };
  }
}

class MemoryEntrySourceRepository implements EntrySourceRepository {
  rows = new Map<string, EntrySource>();

  async list(): Promise<EntrySource[]> {
    return [...this.rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findById(id: string): Promise<EntrySource | null> {
    return this.rows.get(id) ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<EntrySource | null> {
    return [...this.rows.values()].find((source) => source.idempotencyKey === idempotencyKey) ?? null;
  }

  async create(source: EntrySource): Promise<EntrySource> {
    this.rows.set(source.id, source);
    return source;
  }

  async update(id: string, patch: Partial<EntrySource>): Promise<EntrySource> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("source not found");
    const next = { ...existing, ...defined(patch) };
    this.rows.set(id, next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async refreshStatus(id: string) {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("source not found");
    return { sourceId: id, status: existing.status, remainingItems: 1 };
  }
}

class MemoryEntrySourceItemRepository implements EntrySourceItemRepository {
  rows = new Map<string, EntrySourceItem>();

  async list(filters: { status?: EntrySourceItem["status"]; type?: EntryType; from?: string; to?: string }): Promise<EntrySourceItem[]> {
    return [...this.rows.values()].filter((item) => {
      if (filters.status && item.status !== filters.status) return false;
      if (filters.type && item.entryType !== filters.type) return false;
      if (filters.from && item.entryDate && item.entryDate < filters.from) return false;
      if (filters.to && item.entryDate && item.entryDate > filters.to) return false;
      return true;
    });
  }

  async listBySourceId(entrySourceId: string): Promise<EntrySourceItem[]> {
    return [...this.rows.values()].filter((item) => item.entrySourceId === entrySourceId).sort((a, b) => a.itemIndex - b.itemIndex);
  }

  async findById(id: string): Promise<EntrySourceItem | null> {
    return this.rows.get(id) ?? null;
  }

  async create(item: EntrySourceItem): Promise<EntrySourceItem> {
    this.rows.set(item.id, item);
    return item;
  }

  async update(id: string, patch: Partial<EntrySourceItem>): Promise<EntrySourceItem> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("item not found");
    const next = { ...existing, ...defined(patch) };
    this.rows.set(id, next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async deleteBySourceId(entrySourceId: string): Promise<void> {
    for (const item of [...this.rows.values()]) if (item.entrySourceId === entrySourceId) this.rows.delete(item.id);
  }

  async countBySourceId(entrySourceId: string): Promise<number> {
    return [...this.rows.values()].filter((item) => item.entrySourceId === entrySourceId).length;
  }
}

class MemoryEntryRepository implements EntryRepository {
  rows = new Map<string, Entry>();
  entryTags = new Map<string, string[]>();

  constructor(
    private readonly taxonomy: MemoryTaxonomyRepository,
    private readonly entrySources: MemoryEntrySourceRepository,
    private readonly entrySourceItems: MemoryEntrySourceItemRepository
  ) {}

  async list(filters: EntryFilters): Promise<EntryWithDetails[]> {
    const rows = [...this.rows.values()].filter((entry) => {
      if (filters.type && entry.entryType !== filters.type) return false;
      if (filters.from && entry.entryDate < filters.from) return false;
      if (filters.to && entry.entryDate > filters.to) return false;
      if (filters.categoryIds?.length && (!entry.categoryId || !filters.categoryIds.includes(entry.categoryId))) return false;
      if (filters.subjectUserIds?.length && (!entry.subjectUserId || !filters.subjectUserIds.includes(entry.subjectUserId))) return false;
      const tagIds = this.entryTags.get(entry.id) ?? [];
      if (filters.tagIds?.length && !filters.tagIds.some((id) => tagIds.includes(id))) return false;
      return !entry.archivedAt;
    });
    return Promise.all(rows.slice(0, filters.limit ?? rows.length).map((entry) => this.withDetails(entry)));
  }

  async findById(id: string): Promise<EntryWithDetails | null> {
    const entry = this.rows.get(id);
    return entry ? this.withDetails(entry) : null;
  }

  async create(entry: Entry, tagIds: string[]): Promise<EntryWithDetails> {
    this.rows.set(entry.id, entry);
    this.entryTags.set(entry.id, tagIds);
    if (entry.categoryId) this.taxonomy.entryCategoryRefs.set(entry.categoryId, (this.taxonomy.entryCategoryRefs.get(entry.categoryId) ?? 0) + 1);
    for (const tagId of tagIds) this.taxonomy.tagRefs.set(tagId, (this.taxonomy.tagRefs.get(tagId) ?? 0) + 1);
    return this.withDetails(entry);
  }

  async update(id: string, patch: Partial<Entry>, tagIds?: string[]): Promise<EntryWithDetails> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("entry not found");
    const next = { ...existing, ...defined(patch) };
    this.rows.set(id, next);
    if (tagIds) this.entryTags.set(id, tagIds);
    return this.withDetails(next);
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
    this.entryTags.delete(id);
  }

  async listDuplicateCandidates(input: { item: EntrySourceItem; sourceType: SourceType; days: number }): Promise<EntryWithDetails[]> {
    const rows = await this.list({ type: input.item.entryType });
    return rows.filter((entry) => input.item.amount === entry.amount && input.item.entryDate && daysBetween(input.item.entryDate, entry.entryDate) <= input.days);
  }

  async listByYear(year: number): Promise<EntryWithDetails[]> {
    return this.list({ from: `${year}-01-01`, to: `${year}-12-31` });
  }

  async deleteByYear(year: number): Promise<void> {
    for (const entry of await this.listByYear(year)) this.rows.delete(entry.id);
  }

  private async withDetails(entry: Entry): Promise<EntryWithDetails> {
    const category = entry.categoryId ? await this.taxonomy.findCategoryById(entry.categoryId) : null;
    const tags = await Promise.all((this.entryTags.get(entry.id) ?? []).map((tagId) => this.taxonomy.findTagById(tagId)));
    return {
      ...entry,
      category,
      tags: tags.filter((tag): tag is Tag => Boolean(tag)),
      source: entry.entrySourceId ? await this.entrySources.findById(entry.entrySourceId) : null,
      sourceItem: entry.entrySourceItemId ? await this.entrySourceItems.findById(entry.entrySourceItemId) : null
    };
  }
}

class MemoryFinancialAssetRepository implements FinancialAssetRepository {
  rows = new Map<string, FinancialAsset>();

  async list(includeInactive = false): Promise<FinancialAsset[]> {
    return [...this.rows.values()].filter((asset) => includeInactive || asset.isActive);
  }

  async findById(id: string): Promise<FinancialAsset | null> {
    return this.rows.get(id) ?? null;
  }

  async create(asset: FinancialAsset): Promise<FinancialAsset> {
    this.rows.set(asset.id, asset);
    return asset;
  }

  async update(id: string, patch: Partial<FinancialAsset>): Promise<FinancialAsset> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error("asset not found");
    const next = { ...existing, ...defined(patch) };
    this.rows.set(id, next);
    return next;
  }

  async deactivate(id: string, actor: Actor, now: string): Promise<FinancialAsset> {
    return this.update(id, { isActive: false, updatedBy: actor.displayName, updatedAt: now });
  }
}

class MemoryDuplicateRepository implements DuplicateRepository {
  rows = new Map<string, DuplicateExclusion>();

  async findExclusion(pairKey: string): Promise<DuplicateExclusion | null> {
    return this.rows.get(pairKey) ?? null;
  }

  async createExclusion(exclusion: DuplicateExclusion): Promise<DuplicateExclusion> {
    this.rows.set(exclusion.pairKey, exclusion);
    return exclusion;
  }

  async deleteByEntryId(entryId: string): Promise<void> {
    for (const row of [...this.rows.values()]) if (row.entryId === entryId) this.rows.delete(row.pairKey);
  }

  async deleteByEntrySourceItemId(entrySourceItemId: string): Promise<void> {
    for (const row of [...this.rows.values()]) if (row.entrySourceItemId === entrySourceItemId) this.rows.delete(row.pairKey);
  }
}

class MemorySummaryRepository implements SummaryRepository {
  constructor(private readonly entries: EntryRepository) {}

  async monthly(filters: SummaryFilters): Promise<MonthlySummary[]> {
    const rows = await this.entries.list(filters);
    const map = new Map<string, MonthlySummary>();
    for (const entry of rows) {
      const month = monthOf(entry.entryDate);
      const current = map.get(month) ?? { month, incomeTotal: 0, expenseTotal: 0, netCashflow: 0, currency: entry.currency };
      if (entry.entryType === "income") current.incomeTotal += entry.amount;
      else current.expenseTotal += entry.amount;
      current.netCashflow = current.incomeTotal - current.expenseTotal;
      map.set(month, current);
    }
    return [...map.values()].sort((a, b) => a.month.localeCompare(b.month));
  }

  async daily(filters: SummaryFilters): Promise<DailySummary[]> {
    const rows = await this.entries.list(filters);
    const map = new Map<string, DailySummary>();
    for (const entry of rows) {
      const current = map.get(entry.entryDate) ?? { date: entry.entryDate, incomeTotal: 0, expenseTotal: 0, netCashflow: 0, entryCount: 0, currency: entry.currency };
      if (entry.entryType === "income") current.incomeTotal += entry.amount;
      else current.expenseTotal += entry.amount;
      current.entryCount += 1;
      current.netCashflow = current.incomeTotal - current.expenseTotal;
      map.set(entry.entryDate, current);
    }
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async category(filters: SummaryFilters): Promise<CategorySummary[]> {
    const rows = await this.entries.list(filters);
    const map = new Map<string, CategorySummary>();
    for (const entry of rows) {
      const key = entry.category?.id ?? "none";
      const current = map.get(key) ?? { categoryId: entry.category?.id ?? null, categoryName: entry.category?.name ?? "未分類", amount: 0, entryCount: 0, currency: entry.currency };
      current.amount += entry.amount;
      current.entryCount += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => b.amount - a.amount);
  }

  async cashflow(year: number): Promise<MonthlySummary[]> {
    return this.monthly({ from: `${year}-01-01`, to: `${year}-12-31` });
  }

  async actionOverview(filters: SummaryFilters): Promise<ActionOverview> {
    const monthly = await this.monthly(filters);
    const topExpenseCategories = await this.category({ ...filters, type: "expense" });
    const incomeTotal = monthly.reduce((sum, row) => sum + row.incomeTotal, 0);
    const expenseTotal = monthly.reduce((sum, row) => sum + row.expenseTotal, 0);
    return {
      from: filters.from ?? "",
      to: filters.to ?? "",
      incomeTotal,
      expenseTotal,
      netCashflow: incomeTotal - expenseTotal,
      currency: "JPY",
      monthly,
      topExpenseCategories,
      topTags: [],
      subjectUserTotals: []
    };
  }
}

class MemoryArchiveRepository implements ArchiveRepository {
  years = new Map<number, ArchiveYear>();
  exports = new Map<string, ArchiveExport>();
  pendingSourceItems = new Map<number, number>();

  async listYears(): Promise<ArchiveYear[]> {
    return [...this.years.values()].sort((a, b) => b.year - a.year);
  }

  async findYear(year: number): Promise<ArchiveYear | null> {
    return this.years.get(year) ?? null;
  }

  async createYear(archiveYear: ArchiveYear): Promise<ArchiveYear> {
    this.years.set(archiveYear.year, archiveYear);
    return archiveYear;
  }

  async updateYear(id: string, patch: Partial<ArchiveYear>): Promise<ArchiveYear> {
    const existing = [...this.years.values()].find((year) => year.id === id);
    if (!existing) throw new Error("archive year not found");
    const next = { ...existing, ...defined(patch) };
    this.years.set(next.year, next);
    return next;
  }

  async createExport(archiveExport: ArchiveExport): Promise<ArchiveExport> {
    this.exports.set(archiveExport.id, archiveExport);
    return archiveExport;
  }

  async updateExport(id: string, patch: Partial<ArchiveExport>): Promise<ArchiveExport> {
    const existing = this.exports.get(id);
    if (!existing) throw new Error("archive export not found");
    const next = { ...existing, ...defined(patch) };
    this.exports.set(id, next);
    return next;
  }

  async findExport(id: string): Promise<ArchiveExport | null> {
    return this.exports.get(id) ?? null;
  }

  async findLatestExport(year: number): Promise<ArchiveExport | null> {
    return [...this.exports.values()].filter((row) => row.year === year).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
  }

  async isYearPurged(year: number): Promise<boolean> {
    return this.years.get(year)?.status === "purged";
  }

  async countPendingSourceItemsForYear(year: number): Promise<number> {
    return this.pendingSourceItems.get(year) ?? 0;
  }
}

function defined<T extends Record<string, unknown>>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}
