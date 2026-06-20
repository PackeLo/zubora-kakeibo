import type { Actor, Category, Entry, EntryFilters, EntrySource, EntrySourceItem, EntryType, FinancialAsset, SummaryFilters, Tag, User } from "../../domain/types";
import type {
  ActionOverview,
  ArchiveRepository,
  CategorySummary,
  DailySummary,
  DuplicateRepository,
  EntryRepository,
  EntrySourceItemRepository,
  EntrySourceRepository,
  EntrySourceStatusResult,
  FinancialAssetRepository,
  MonthlySummary,
  SummaryRepository,
  TaxonomyRepository,
  UnitOfWork,
  UserRepository
} from "../../ports/repositories";
import { newId } from "../../domain/ids";
import { nowIso } from "../../domain/dates";
import {
  archiveExportFromRow,
  archiveYearFromRow,
  bool,
  categoryFromRow,
  entryFromRow,
  entrySourceFromRow,
  entrySourceItemFromRow,
  financialAssetFromRow,
  intBool,
  tagFromRow,
  userFromRow
} from "./mappers";
import { inClause, setClause } from "./sql";
import type { ArchiveExport, ArchiveYear, DuplicateExclusion, EntryWithDetails, SourceType } from "../../domain/types";

export class D1UnitOfWork implements UnitOfWork {
  users: UserRepository;
  taxonomy: TaxonomyRepository;
  entrySources: EntrySourceRepository;
  entrySourceItems: EntrySourceItemRepository;
  entries: EntryRepository;
  financialAssets: FinancialAssetRepository;
  duplicates: DuplicateRepository;
  summaries: SummaryRepository;
  archives: ArchiveRepository;

  constructor(private readonly db: D1Database) {
    this.users = new D1UserRepository(db);
    this.taxonomy = new D1TaxonomyRepository(db);
    this.entrySources = new D1EntrySourceRepository(db);
    this.entrySourceItems = new D1EntrySourceItemRepository(db);
    this.entries = new D1EntryRepository(db, this.taxonomy, this.entrySources, this.entrySourceItems);
    this.financialAssets = new D1FinancialAssetRepository(db);
    this.duplicates = new D1DuplicateRepository(db);
    this.summaries = new D1SummaryRepository(db);
    this.archives = new D1ArchiveRepository(db);
  }
}

class D1UserRepository implements UserRepository {
  constructor(private readonly db: D1Database) {}

  async listActive(): Promise<User[]> {
    const { results } = await this.db.prepare("SELECT * FROM users WHERE is_active = 1 ORDER BY display_name").all();
    return (results ?? []).map(userFromRow);
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
    return row ? userFromRow(row) : null;
  }

  async upsertAccessUser(actor: Actor): Promise<User> {
    const existing = await this.findById(actor.id);
    const now = nowIso();
    if (existing) {
      await this.db
        .prepare("UPDATE users SET display_name = ?, role = ?, is_active = 1, updated_by = ?, updated_at = ? WHERE id = ?")
        .bind(actor.displayName, actor.role, actor.displayName, now, actor.id)
        .run();
      return { ...existing, displayName: actor.displayName, role: actor.role, isActive: true, updatedBy: actor.displayName, updatedAt: now };
    }
    const user: User = {
      id: actor.id,
      passwordHash: "cloudflare-access",
      displayName: actor.displayName,
      role: actor.role,
      isActive: true,
      createdBy: actor.displayName,
      createdAt: now,
      updatedBy: actor.displayName,
      updatedAt: now
    };
    await this.db
      .prepare(
        "INSERT INTO users (id, password_hash, display_name, role, is_active, created_by, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(user.id, user.passwordHash, user.displayName, user.role, 1, user.createdBy, user.createdAt, user.updatedBy, user.updatedAt)
      .run();
    return user;
  }
}

class D1TaxonomyRepository implements TaxonomyRepository {
  constructor(private readonly db: D1Database) {}

  async listCategories(includeInactive = false): Promise<Category[]> {
    const sql = `SELECT * FROM categories ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY kind, sort_order, name`;
    const { results } = await this.db.prepare(sql).all();
    return (results ?? []).map(categoryFromRow);
  }

  async listTags(includeInactive = false): Promise<Tag[]> {
    const sql = `SELECT * FROM tags ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`;
    const { results } = await this.db.prepare(sql).all();
    return (results ?? []).map(tagFromRow);
  }

  async findCategoryById(id: string): Promise<Category | null> {
    const row = await this.db.prepare("SELECT * FROM categories WHERE id = ?").bind(id).first();
    return row ? categoryFromRow(row) : null;
  }

  async findCategoryByCode(code: string, kind?: EntryType): Promise<Category | null> {
    const row = kind
      ? await this.db.prepare("SELECT * FROM categories WHERE code = ? AND kind = ?").bind(code, kind).first()
      : await this.db.prepare("SELECT * FROM categories WHERE code = ?").bind(code).first();
    return row ? categoryFromRow(row) : null;
  }

  async findTagById(id: string): Promise<Tag | null> {
    const row = await this.db.prepare("SELECT * FROM tags WHERE id = ?").bind(id).first();
    return row ? tagFromRow(row) : null;
  }

  async createCategory(category: Category): Promise<Category> {
    await this.db
      .prepare(
        `INSERT INTO categories
        (id, code, name, kind, sort_order, dedupe_enabled, is_active, created_by, created_at, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        category.id,
        category.code,
        category.name,
        category.kind,
        category.sortOrder,
        category.dedupeEnabled ? 1 : 0,
        category.isActive ? 1 : 0,
        category.createdBy,
        category.createdAt,
        category.updatedBy,
        category.updatedAt
      )
      .run();
    return category;
  }

  async updateCategory(id: string, patch: Partial<Omit<Category, "id" | "createdAt">>): Promise<Category> {
    const mapped = {
      code: patch.code,
      name: patch.name,
      kind: patch.kind,
      sortOrder: patch.sortOrder,
      dedupeEnabled: intBool(patch.dedupeEnabled),
      isActive: intBool(patch.isActive),
      updatedBy: patch.updatedBy,
      updatedAt: patch.updatedAt
    };
    const { sql, values } = setClause(mapped, {
      sortOrder: "sort_order",
      dedupeEnabled: "dedupe_enabled",
      isActive: "is_active",
      updatedBy: "updated_by",
      updatedAt: "updated_at"
    });
    if (sql) await this.db.prepare(`UPDATE categories SET ${sql} WHERE id = ?`).bind(...values, id).run();
    const row = await this.findCategoryById(id);
    if (!row) throw new Error("category not found");
    return row;
  }

  async deleteCategory(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
  }

  async countCategoryReferences(id: string) {
    const entries = await this.db.prepare("SELECT COUNT(*) AS count FROM entries WHERE category_id = ?").bind(id).first<{ count: number }>();
    const items = await this.db.prepare("SELECT COUNT(*) AS count FROM entry_source_items WHERE category_id_guess = ?").bind(id).first<{ count: number }>();
    return { entries: Number(entries?.count ?? 0), entrySourceItems: Number(items?.count ?? 0) };
  }

  async createTag(tag: Tag): Promise<Tag> {
    await this.db.prepare("INSERT INTO tags (id, name, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").bind(tag.id, tag.name, tag.isActive ? 1 : 0, tag.createdAt, tag.updatedAt).run();
    return tag;
  }

  async updateTag(id: string, patch: Partial<Omit<Tag, "id" | "createdAt">>): Promise<Tag> {
    const { sql, values } = setClause(
      { name: patch.name, isActive: intBool(patch.isActive), updatedAt: patch.updatedAt },
      { isActive: "is_active", updatedAt: "updated_at" }
    );
    if (sql) await this.db.prepare(`UPDATE tags SET ${sql} WHERE id = ?`).bind(...values, id).run();
    const row = await this.findTagById(id);
    if (!row) throw new Error("tag not found");
    return row;
  }

  async deleteTag(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM tags WHERE id = ?").bind(id).run();
  }

  async countTagReferences(id: string, name: string) {
    const entries = await this.db.prepare("SELECT COUNT(*) AS count FROM entry_tags WHERE tag_id = ?").bind(id).first<{ count: number }>();
    const like = `%${name}%`;
    const items = await this.db.prepare("SELECT COUNT(*) AS count FROM entry_source_items WHERE tags_json LIKE ?").bind(like).first<{ count: number }>();
    return { entries: Number(entries?.count ?? 0), entrySourceItems: Number(items?.count ?? 0) };
  }
}

class D1EntrySourceRepository implements EntrySourceRepository {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<EntrySource[]> {
    const { results } = await this.db.prepare("SELECT * FROM entry_sources ORDER BY created_at DESC").all();
    return (results ?? []).map(entrySourceFromRow);
  }

  async findById(id: string): Promise<EntrySource | null> {
    const row = await this.db.prepare("SELECT * FROM entry_sources WHERE id = ?").bind(id).first();
    return row ? entrySourceFromRow(row) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<EntrySource | null> {
    const row = await this.db.prepare("SELECT * FROM entry_sources WHERE idempotency_key = ?").bind(idempotencyKey).first();
    return row ? entrySourceFromRow(row) : null;
  }

  async create(source: EntrySource): Promise<EntrySource> {
    await this.db
      .prepare(
        `INSERT INTO entry_sources
        (id, source_type, display_name, source_file_name, source_sha256, idempotency_key, raw_input_summary, raw_text, raw_payload_json, status, created_by, created_at, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        source.id,
        source.sourceType,
        source.displayName,
        source.sourceFileName,
        source.sourceSha256,
        source.idempotencyKey,
        source.rawInputSummary,
        source.rawText,
        source.rawPayloadJson,
        source.status,
        source.createdBy,
        source.createdAt,
        source.updatedBy,
        source.updatedAt
      )
      .run();
    return source;
  }

  async update(id: string, patch: Partial<EntrySource>): Promise<EntrySource> {
    const { sql, values } = setClause(
      {
        sourceType: patch.sourceType,
        displayName: patch.displayName,
        sourceFileName: patch.sourceFileName,
        sourceSha256: patch.sourceSha256,
        rawInputSummary: patch.rawInputSummary,
        rawText: patch.rawText,
        rawPayloadJson: patch.rawPayloadJson,
        status: patch.status,
        updatedBy: patch.updatedBy,
        updatedAt: patch.updatedAt
      },
      {
        sourceType: "source_type",
        displayName: "display_name",
        sourceFileName: "source_file_name",
        sourceSha256: "source_sha256",
        rawInputSummary: "raw_input_summary",
        rawText: "raw_text",
        rawPayloadJson: "raw_payload_json",
        updatedBy: "updated_by",
        updatedAt: "updated_at"
      }
    );
    if (sql) await this.db.prepare(`UPDATE entry_sources SET ${sql} WHERE id = ?`).bind(...values, id).run();
    const row = await this.findById(id);
    if (!row) throw new Error("entry source not found");
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM entry_sources WHERE id = ?").bind(id).run();
  }

  async refreshStatus(id: string): Promise<EntrySourceStatusResult> {
    const row = await this.db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN status = 'posted' THEN 1 ELSE 0 END) AS posted
        FROM entry_source_items WHERE entry_source_id = ?`
      )
      .bind(id)
      .first<{ total: number; pending: number; posted: number }>();
    const total = Number(row?.total ?? 0);
    const pending = Number(row?.pending ?? 0);
    const posted = Number(row?.posted ?? 0);
    const status: EntrySource["status"] = total === 0 || pending === 0 ? "posted" : posted > 0 ? "partially_posted" : "pending";
    await this.db.prepare("UPDATE entry_sources SET status = ?, updated_at = ? WHERE id = ?").bind(status, nowIso(), id).run();
    return { sourceId: id, status, remainingItems: total };
  }
}

class D1EntrySourceItemRepository implements EntrySourceItemRepository {
  constructor(private readonly db: D1Database) {}

  async list(filters: { status?: EntrySourceItem["status"]; type?: EntryType; from?: string; to?: string }): Promise<EntrySourceItem[]> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }
    if (filters.type) {
      conditions.push("entry_type = ?");
      params.push(filters.type);
    }
    if (filters.from) {
      conditions.push("entry_date >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push("entry_date <= ?");
      params.push(filters.to);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const { results } = await this.db.prepare(`SELECT * FROM entry_source_items ${where} ORDER BY entry_date DESC, created_at DESC`).bind(...params).all();
    return (results ?? []).map(entrySourceItemFromRow);
  }

  async listBySourceId(entrySourceId: string): Promise<EntrySourceItem[]> {
    const { results } = await this.db.prepare("SELECT * FROM entry_source_items WHERE entry_source_id = ? ORDER BY item_index").bind(entrySourceId).all();
    return (results ?? []).map(entrySourceItemFromRow);
  }

  async findById(id: string): Promise<EntrySourceItem | null> {
    const row = await this.db.prepare("SELECT * FROM entry_source_items WHERE id = ?").bind(id).first();
    return row ? entrySourceItemFromRow(row) : null;
  }

  async create(item: EntrySourceItem): Promise<EntrySourceItem> {
    await this.db
      .prepare(
        `INSERT INTO entry_source_items
        (id, entry_source_id, item_index, entry_type, subject_user_id, entry_date, amount, currency, target, category_id_guess, category_name_guess, tags_json, memo, confidence, dedupe_key, status, posted_entry_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        item.id,
        item.entrySourceId,
        item.itemIndex,
        item.entryType,
        item.subjectUserId,
        item.entryDate,
        item.amount,
        item.currency,
        item.target,
        item.categoryIdGuess,
        item.categoryNameGuess,
        item.tagsJson,
        item.memo,
        item.confidence,
        item.dedupeKey,
        item.status,
        item.postedEntryId,
        item.createdAt,
        item.updatedAt
      )
      .run();
    return item;
  }

  async update(id: string, patch: Partial<EntrySourceItem>): Promise<EntrySourceItem> {
    const { sql, values } = setClause(
      {
        itemIndex: patch.itemIndex,
        entryType: patch.entryType,
        subjectUserId: patch.subjectUserId,
        entryDate: patch.entryDate,
        amount: patch.amount,
        currency: patch.currency,
        target: patch.target,
        categoryIdGuess: patch.categoryIdGuess,
        categoryNameGuess: patch.categoryNameGuess,
        tagsJson: patch.tagsJson,
        memo: patch.memo,
        confidence: patch.confidence,
        dedupeKey: patch.dedupeKey,
        status: patch.status,
        postedEntryId: patch.postedEntryId,
        updatedAt: patch.updatedAt
      },
      {
        itemIndex: "item_index",
        entryType: "entry_type",
        subjectUserId: "subject_user_id",
        entryDate: "entry_date",
        categoryIdGuess: "category_id_guess",
        categoryNameGuess: "category_name_guess",
        tagsJson: "tags_json",
        dedupeKey: "dedupe_key",
        postedEntryId: "posted_entry_id",
        updatedAt: "updated_at"
      }
    );
    if (sql) await this.db.prepare(`UPDATE entry_source_items SET ${sql} WHERE id = ?`).bind(...values, id).run();
    const row = await this.findById(id);
    if (!row) throw new Error("entry source item not found");
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM entry_source_items WHERE id = ?").bind(id).run();
  }

  async deleteBySourceId(entrySourceId: string): Promise<void> {
    await this.db.prepare("DELETE FROM entry_source_items WHERE entry_source_id = ?").bind(entrySourceId).run();
  }

  async countBySourceId(entrySourceId: string): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS count FROM entry_source_items WHERE entry_source_id = ?").bind(entrySourceId).first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
}

class D1EntryRepository implements EntryRepository {
  constructor(
    private readonly db: D1Database,
    private readonly taxonomy: TaxonomyRepository,
    private readonly entrySources: EntrySourceRepository,
    private readonly entrySourceItems: EntrySourceItemRepository
  ) {}

  async list(filters: EntryFilters): Promise<EntryWithDetails[]> {
    const params: unknown[] = [];
    const conditions = ["e.archived_at IS NULL"];
    if (filters.type) {
      conditions.push("e.entry_type = ?");
      params.push(filters.type);
    }
    if (filters.from) {
      conditions.push("e.entry_date >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push("e.entry_date <= ?");
      params.push(filters.to);
    }
    if (filters.categoryIds?.length) {
      conditions.push(`e.category_id IN (${filters.categoryIds.map(() => "?").join(",")})`);
      params.push(...filters.categoryIds);
    }
    if (filters.subjectUserIds?.length) {
      conditions.push(`e.subject_user_id IN (${filters.subjectUserIds.map(() => "?").join(",")})`);
      params.push(...filters.subjectUserIds);
    }
    if (filters.tagIds?.length) {
      conditions.push(`EXISTS (SELECT 1 FROM entry_tags etf WHERE etf.entry_id = e.id AND etf.tag_id IN (${filters.tagIds.map(() => "?").join(",")}))`);
      params.push(...filters.tagIds);
    }
    const limit = filters.limit ? ` LIMIT ${Math.min(filters.limit, 10000)}` : "";
    const { results } = await this.db.prepare(`SELECT e.* FROM entries e WHERE ${conditions.join(" AND ")} ORDER BY e.entry_date DESC, e.fixed_at DESC${limit}`).bind(...params).all();
    return Promise.all((results ?? []).map((row) => this.withDetails(entryFromRow(row))));
  }

  async findById(id: string): Promise<EntryWithDetails | null> {
    const row = await this.db.prepare("SELECT * FROM entries WHERE id = ?").bind(id).first();
    return row ? this.withDetails(entryFromRow(row)) : null;
  }

  async create(entry: Entry, tagIds: string[]): Promise<EntryWithDetails> {
    await this.db
      .prepare(
        `INSERT INTO entries
        (id, entry_type, subject_user_id, entry_date, amount, currency, category_id, target, memo, entry_source_id, entry_source_item_id, dedupe_key, fixed_at, archived_at, archive_year_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        entry.id,
        entry.entryType,
        entry.subjectUserId,
        entry.entryDate,
        entry.amount,
        entry.currency,
        entry.categoryId,
        entry.target,
        entry.memo,
        entry.entrySourceId,
        entry.entrySourceItemId,
        entry.dedupeKey,
        entry.fixedAt,
        entry.archivedAt,
        entry.archiveYearId
      )
      .run();
    await this.db.prepare(entry.entryType === "expense" ? "INSERT INTO expense_entries (entry_id) VALUES (?)" : "INSERT INTO income_entries (entry_id) VALUES (?)").bind(entry.id).run();
    await this.replaceTags(entry.id, tagIds);
    const created = await this.findById(entry.id);
    if (!created) throw new Error("entry not found after create");
    return created;
  }

  async update(id: string, patch: Partial<Entry>, tagIds?: string[]): Promise<EntryWithDetails> {
    const before = await this.findById(id);
    if (!before) throw new Error("entry not found");
    const { sql, values } = setClause(
      {
        entryType: patch.entryType,
        subjectUserId: patch.subjectUserId,
        entryDate: patch.entryDate,
        amount: patch.amount,
        currency: patch.currency,
        categoryId: patch.categoryId,
        target: patch.target,
        memo: patch.memo,
        dedupeKey: patch.dedupeKey,
        fixedAt: patch.fixedAt
      },
      {
        entryType: "entry_type",
        subjectUserId: "subject_user_id",
        entryDate: "entry_date",
        categoryId: "category_id",
        dedupeKey: "dedupe_key",
        fixedAt: "fixed_at"
      }
    );
    if (sql) await this.db.prepare(`UPDATE entries SET ${sql} WHERE id = ?`).bind(...values, id).run();
    if (patch.entryType && patch.entryType !== before.entryType) {
      await this.db.prepare("DELETE FROM expense_entries WHERE entry_id = ?").bind(id).run();
      await this.db.prepare("DELETE FROM income_entries WHERE entry_id = ?").bind(id).run();
      await this.db.prepare(patch.entryType === "expense" ? "INSERT INTO expense_entries (entry_id) VALUES (?)" : "INSERT INTO income_entries (entry_id) VALUES (?)").bind(id).run();
    }
    if (tagIds) await this.replaceTags(id, tagIds);
    const updated = await this.findById(id);
    if (!updated) throw new Error("entry not found after update");
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM expense_entries WHERE entry_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM income_entries WHERE entry_id = ?").bind(id).run();
    await this.db.prepare("DELETE FROM entries WHERE id = ?").bind(id).run();
  }

  async listDuplicateCandidates(input: { item: EntrySourceItem; sourceType: SourceType; days: number }): Promise<EntryWithDetails[]> {
    if (!input.item.entryDate || input.item.amount == null) return [];
    const date = Date.parse(`${input.item.entryDate}T00:00:00Z`);
    const from = new Date(date - input.days * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(date + input.days * 86_400_000).toISOString().slice(0, 10);
    const entries = await this.list({
      type: input.item.entryType,
      from,
      to,
      limit: 200
    });
    return entries.filter((entry) => entry.amount === input.item.amount);
  }

  async listByYear(year: number): Promise<EntryWithDetails[]> {
    const { results } = await this.db
      .prepare("SELECT e.* FROM entries e WHERE e.archived_at IS NULL AND e.entry_date >= ? AND e.entry_date <= ? ORDER BY e.entry_date ASC, e.fixed_at ASC")
      .bind(`${year}-01-01`, `${year}-12-31`)
      .all();
    return Promise.all((results ?? []).map((row) => this.withDetails(entryFromRow(row))));
  }

  async deleteByYear(year: number): Promise<void> {
    const entries = await this.listByYear(year);
    for (const entry of entries) await this.delete(entry.id);
  }

  private async replaceTags(entryId: string, tagIds: string[]) {
    await this.db.prepare("DELETE FROM entry_tags WHERE entry_id = ?").bind(entryId).run();
    for (const tagId of tagIds) {
      await this.db.prepare("INSERT OR IGNORE INTO entry_tags (entry_id, tag_id) VALUES (?, ?)").bind(entryId, tagId).run();
    }
  }

  private async withDetails(entry: Entry): Promise<EntryWithDetails> {
    const category = entry.categoryId ? await this.taxonomy.findCategoryById(entry.categoryId) : null;
    const { results } = await this.db
      .prepare("SELECT t.* FROM tags t INNER JOIN entry_tags et ON et.tag_id = t.id WHERE et.entry_id = ? ORDER BY t.name")
      .bind(entry.id)
      .all();
    const tags = (results ?? []).map(tagFromRow);
    const source = entry.entrySourceId ? await this.entrySources.findById(entry.entrySourceId) : null;
    const sourceItem = entry.entrySourceItemId ? await this.entrySourceItems.findById(entry.entrySourceItemId) : null;
    return { ...entry, category, tags, source, sourceItem };
  }
}

class D1FinancialAssetRepository implements FinancialAssetRepository {
  constructor(private readonly db: D1Database) {}

  async list(includeInactive = false): Promise<FinancialAsset[]> {
    const { results } = await this.db.prepare(`SELECT * FROM financial_assets ${includeInactive ? "" : "WHERE is_active = 1"} ORDER BY name`).all();
    return (results ?? []).map(financialAssetFromRow);
  }

  async findById(id: string): Promise<FinancialAsset | null> {
    const row = await this.db.prepare("SELECT * FROM financial_assets WHERE id = ?").bind(id).first();
    return row ? financialAssetFromRow(row) : null;
  }

  async create(asset: FinancialAsset): Promise<FinancialAsset> {
    await this.db
      .prepare(
        `INSERT INTO financial_assets
        (id, owner_user_id, name, asset_type, quantity_text, valuation_minor, currency, valuation_updated_at, valuation_note, updated_by, is_active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        asset.id,
        asset.ownerUserId,
        asset.name,
        asset.assetType,
        asset.quantityText,
        asset.valuationMinor,
        asset.currency,
        asset.valuationUpdatedAt,
        asset.valuationNote,
        asset.updatedBy,
        asset.isActive ? 1 : 0,
        asset.createdBy,
        asset.createdAt,
        asset.updatedAt
      )
      .run();
    return asset;
  }

  async update(id: string, patch: Partial<FinancialAsset>): Promise<FinancialAsset> {
    const { sql, values } = setClause(
      {
        ownerUserId: patch.ownerUserId,
        name: patch.name,
        assetType: patch.assetType,
        quantityText: patch.quantityText,
        valuationMinor: patch.valuationMinor,
        currency: patch.currency,
        valuationUpdatedAt: patch.valuationUpdatedAt,
        valuationNote: patch.valuationNote,
        updatedBy: patch.updatedBy,
        isActive: intBool(patch.isActive),
        updatedAt: patch.updatedAt
      },
      {
        ownerUserId: "owner_user_id",
        assetType: "asset_type",
        quantityText: "quantity_text",
        valuationMinor: "valuation_minor",
        valuationUpdatedAt: "valuation_updated_at",
        valuationNote: "valuation_note",
        updatedBy: "updated_by",
        isActive: "is_active",
        updatedAt: "updated_at"
      }
    );
    if (sql) await this.db.prepare(`UPDATE financial_assets SET ${sql} WHERE id = ?`).bind(...values, id).run();
    const row = await this.findById(id);
    if (!row) throw new Error("financial asset not found");
    return row;
  }

  async deactivate(id: string, actor: Actor, now: string): Promise<FinancialAsset> {
    return this.update(id, { isActive: false, updatedBy: actor.displayName, updatedAt: now });
  }
}

class D1DuplicateRepository implements DuplicateRepository {
  constructor(private readonly db: D1Database) {}

  async findExclusion(pairKey: string): Promise<DuplicateExclusion | null> {
    const row = await this.db.prepare("SELECT * FROM duplicate_exclusions WHERE pair_key = ?").bind(pairKey).first();
    return row
      ? {
          id: String(row.id),
          entrySourceItemId: String(row.entry_source_item_id),
          entryId: String(row.entry_id),
          pairKey: String(row.pair_key),
          reason: row.reason as string | null,
          createdBy: row.created_by as string | null,
          createdAt: String(row.created_at)
        }
      : null;
  }

  async createExclusion(exclusion: DuplicateExclusion): Promise<DuplicateExclusion> {
    await this.db
      .prepare("INSERT INTO duplicate_exclusions (id, entry_source_item_id, entry_id, pair_key, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(exclusion.id, exclusion.entrySourceItemId, exclusion.entryId, exclusion.pairKey, exclusion.reason, exclusion.createdBy, exclusion.createdAt)
      .run();
    return exclusion;
  }

  async deleteByEntryId(entryId: string): Promise<void> {
    await this.db.prepare("DELETE FROM duplicate_exclusions WHERE entry_id = ?").bind(entryId).run();
  }

  async deleteByEntrySourceItemId(entrySourceItemId: string): Promise<void> {
    await this.db.prepare("DELETE FROM duplicate_exclusions WHERE entry_source_item_id = ?").bind(entrySourceItemId).run();
  }
}

class D1SummaryRepository implements SummaryRepository {
  constructor(private readonly db: D1Database) {}

  async monthly(filters: SummaryFilters): Promise<MonthlySummary[]> {
    const { where, params } = buildEntryWhere(filters);
    const { results } = await this.db
      .prepare(
        `SELECT substr(e.entry_date, 1, 7) AS month,
          SUM(CASE WHEN e.entry_type = 'income' THEN e.amount ELSE 0 END) AS income_total,
          SUM(CASE WHEN e.entry_type = 'expense' THEN e.amount ELSE 0 END) AS expense_total,
          COALESCE(e.currency, 'JPY') AS currency
        FROM entries e
        ${where}
        GROUP BY substr(e.entry_date, 1, 7), e.currency
        ORDER BY month`
      )
      .bind(...params)
      .all();
    return (results ?? []).map((row) => ({
      month: String(row.month),
      incomeTotal: Number(row.income_total ?? 0),
      expenseTotal: Number(row.expense_total ?? 0),
      netCashflow: Number(row.income_total ?? 0) - Number(row.expense_total ?? 0),
      currency: String(row.currency ?? "JPY")
    }));
  }

  async daily(filters: SummaryFilters): Promise<DailySummary[]> {
    const { where, params } = buildEntryWhere(filters);
    const { results } = await this.db
      .prepare(
        `SELECT e.entry_date AS date,
          SUM(CASE WHEN e.entry_type = 'income' THEN e.amount ELSE 0 END) AS income_total,
          SUM(CASE WHEN e.entry_type = 'expense' THEN e.amount ELSE 0 END) AS expense_total,
          COUNT(*) AS entry_count,
          COALESCE(e.currency, 'JPY') AS currency
        FROM entries e
        ${where}
        GROUP BY e.entry_date, e.currency
        ORDER BY e.entry_date`
      )
      .bind(...params)
      .all();
    return (results ?? []).map((row) => ({
      date: String(row.date),
      incomeTotal: Number(row.income_total ?? 0),
      expenseTotal: Number(row.expense_total ?? 0),
      netCashflow: Number(row.income_total ?? 0) - Number(row.expense_total ?? 0),
      entryCount: Number(row.entry_count ?? 0),
      currency: String(row.currency ?? "JPY")
    }));
  }

  async category(filters: SummaryFilters): Promise<CategorySummary[]> {
    const { where, params } = buildEntryWhere(filters);
    const { results } = await this.db
      .prepare(
        `SELECT e.category_id, COALESCE(c.name, '未分類') AS category_name,
          SUM(e.amount) AS amount, COUNT(*) AS entry_count, COALESCE(e.currency, 'JPY') AS currency
        FROM entries e
        LEFT JOIN categories c ON c.id = e.category_id
        ${where}
        GROUP BY e.category_id, c.name, e.currency
        ORDER BY amount DESC`
      )
      .bind(...params)
      .all();
    return (results ?? []).map((row) => ({
      categoryId: row.category_id as string | null,
      categoryName: String(row.category_name),
      amount: Number(row.amount ?? 0),
      entryCount: Number(row.entry_count ?? 0),
      currency: String(row.currency ?? "JPY")
    }));
  }

  async cashflow(year: number): Promise<MonthlySummary[]> {
    return this.monthly({ from: `${year}-01-01`, to: `${year}-12-31` });
  }

  async actionOverview(filters: SummaryFilters): Promise<ActionOverview> {
    const [monthly, topExpenseCategories, topTags, subjectRows] = await Promise.all([
      this.monthly(filters),
      this.category({ ...filters, type: "expense" }),
      this.topTags(filters),
      this.subjectTotals(filters)
    ]);
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
      topExpenseCategories: topExpenseCategories.slice(0, 10),
      topTags: topTags.slice(0, 10),
      subjectUserTotals: subjectRows
    };
  }

  private async topTags(filters: SummaryFilters) {
    const { where, params } = buildEntryWhere(filters);
    const { results } = await this.db
      .prepare(
        `SELECT t.id AS tag_id, t.name AS tag_name, SUM(e.amount) AS amount, COUNT(*) AS entry_count, COALESCE(e.currency, 'JPY') AS currency
        FROM entries e
        INNER JOIN entry_tags et ON et.entry_id = e.id
        INNER JOIN tags t ON t.id = et.tag_id
        ${where}
        GROUP BY t.id, t.name, e.currency
        ORDER BY amount DESC`
      )
      .bind(...params)
      .all();
    return (results ?? []).map((row) => ({
      tagId: String(row.tag_id),
      tagName: String(row.tag_name),
      amount: Number(row.amount ?? 0),
      entryCount: Number(row.entry_count ?? 0),
      currency: String(row.currency ?? "JPY")
    }));
  }

  private async subjectTotals(filters: SummaryFilters) {
    const { where, params } = buildEntryWhere(filters);
    const { results } = await this.db
      .prepare(
        `SELECT e.subject_user_id,
          SUM(CASE WHEN e.entry_type = 'income' THEN e.amount ELSE 0 END) AS income_total,
          SUM(CASE WHEN e.entry_type = 'expense' THEN e.amount ELSE 0 END) AS expense_total,
          COALESCE(e.currency, 'JPY') AS currency
        FROM entries e
        ${where}
        GROUP BY e.subject_user_id, e.currency`
      )
      .bind(...params)
      .all();
    return (results ?? []).map((row) => {
      const incomeTotal = Number(row.income_total ?? 0);
      const expenseTotal = Number(row.expense_total ?? 0);
      return {
        subjectUserId: row.subject_user_id as string | null,
        incomeTotal,
        expenseTotal,
        netCashflow: incomeTotal - expenseTotal,
        currency: String(row.currency ?? "JPY")
      };
    });
  }
}

class D1ArchiveRepository implements ArchiveRepository {
  constructor(private readonly db: D1Database) {}

  async listYears(): Promise<ArchiveYear[]> {
    const { results } = await this.db.prepare("SELECT * FROM archive_years ORDER BY year DESC").all();
    return (results ?? []).map(archiveYearFromRow);
  }

  async findYear(year: number): Promise<ArchiveYear | null> {
    const row = await this.db.prepare("SELECT * FROM archive_years WHERE year = ?").bind(year).first();
    return row ? archiveYearFromRow(row) : null;
  }

  async createYear(archiveYear: ArchiveYear): Promise<ArchiveYear> {
    await this.db
      .prepare(
        `INSERT INTO archive_years
        (id, year, status, archive_format, archive_format_version, entry_count, expense_count, income_count, total_expense, total_income, currency, last_export_id, last_exported_at, last_exported_by, last_content_sha256, external_backup_confirmed_at, external_backup_confirmed_by, external_storage_note, purged_at, purged_by, error_message, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        archiveYear.id,
        archiveYear.year,
        archiveYear.status,
        archiveYear.archiveFormat,
        archiveYear.archiveFormatVersion,
        archiveYear.entryCount,
        archiveYear.expenseCount,
        archiveYear.incomeCount,
        archiveYear.totalExpense,
        archiveYear.totalIncome,
        archiveYear.currency,
        archiveYear.lastExportId,
        archiveYear.lastExportedAt,
        archiveYear.lastExportedBy,
        archiveYear.lastContentSha256,
        archiveYear.externalBackupConfirmedAt,
        archiveYear.externalBackupConfirmedBy,
        archiveYear.externalStorageNote,
        archiveYear.purgedAt,
        archiveYear.purgedBy,
        archiveYear.errorMessage,
        archiveYear.createdAt,
        archiveYear.updatedAt
      )
      .run();
    return archiveYear;
  }

  async updateYear(id: string, patch: Partial<ArchiveYear>): Promise<ArchiveYear> {
    const { sql, values } = setClause(
      {
        status: patch.status,
        entryCount: patch.entryCount,
        expenseCount: patch.expenseCount,
        incomeCount: patch.incomeCount,
        totalExpense: patch.totalExpense,
        totalIncome: patch.totalIncome,
        lastExportId: patch.lastExportId,
        lastExportedAt: patch.lastExportedAt,
        lastExportedBy: patch.lastExportedBy,
        lastContentSha256: patch.lastContentSha256,
        externalBackupConfirmedAt: patch.externalBackupConfirmedAt,
        externalBackupConfirmedBy: patch.externalBackupConfirmedBy,
        externalStorageNote: patch.externalStorageNote,
        purgedAt: patch.purgedAt,
        purgedBy: patch.purgedBy,
        errorMessage: patch.errorMessage,
        updatedAt: patch.updatedAt
      },
      {
        entryCount: "entry_count",
        expenseCount: "expense_count",
        incomeCount: "income_count",
        totalExpense: "total_expense",
        totalIncome: "total_income",
        lastExportId: "last_export_id",
        lastExportedAt: "last_exported_at",
        lastExportedBy: "last_exported_by",
        lastContentSha256: "last_content_sha256",
        externalBackupConfirmedAt: "external_backup_confirmed_at",
        externalBackupConfirmedBy: "external_backup_confirmed_by",
        externalStorageNote: "external_storage_note",
        purgedAt: "purged_at",
        purgedBy: "purged_by",
        errorMessage: "error_message",
        updatedAt: "updated_at"
      }
    );
    if (sql) await this.db.prepare(`UPDATE archive_years SET ${sql} WHERE id = ?`).bind(...values, id).run();
    const row = await this.db.prepare("SELECT * FROM archive_years WHERE id = ?").bind(id).first();
    if (!row) throw new Error("archive year not found");
    return archiveYearFromRow(row);
  }

  async createExport(archiveExport: ArchiveExport): Promise<ArchiveExport> {
    await this.db
      .prepare(
        `INSERT INTO archive_exports
        (id, archive_year_id, year, filename, archive_format, archive_format_version, content_sha256, entry_count, expense_count, income_count, total_expense, total_income, generated_by, generated_at, completed_at, status, error_message)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        archiveExport.id,
        archiveExport.archiveYearId,
        archiveExport.year,
        archiveExport.filename,
        archiveExport.archiveFormat,
        archiveExport.archiveFormatVersion,
        archiveExport.contentSha256,
        archiveExport.entryCount,
        archiveExport.expenseCount,
        archiveExport.incomeCount,
        archiveExport.totalExpense,
        archiveExport.totalIncome,
        archiveExport.generatedBy,
        archiveExport.generatedAt,
        archiveExport.completedAt,
        archiveExport.status,
        archiveExport.errorMessage
      )
      .run();
    return archiveExport;
  }

  async updateExport(id: string, patch: Partial<ArchiveExport>): Promise<ArchiveExport> {
    const { sql, values } = setClause(
      {
        contentSha256: patch.contentSha256,
        completedAt: patch.completedAt,
        status: patch.status,
        errorMessage: patch.errorMessage
      },
      { contentSha256: "content_sha256", completedAt: "completed_at", errorMessage: "error_message" }
    );
    if (sql) await this.db.prepare(`UPDATE archive_exports SET ${sql} WHERE id = ?`).bind(...values, id).run();
    const row = await this.findExport(id);
    if (!row) throw new Error("archive export not found");
    return row;
  }

  async findExport(id: string): Promise<ArchiveExport | null> {
    const row = await this.db.prepare("SELECT * FROM archive_exports WHERE id = ?").bind(id).first();
    return row ? archiveExportFromRow(row) : null;
  }

  async findLatestExport(year: number): Promise<ArchiveExport | null> {
    const row = await this.db.prepare("SELECT * FROM archive_exports WHERE year = ? ORDER BY generated_at DESC LIMIT 1").bind(year).first();
    return row ? archiveExportFromRow(row) : null;
  }

  async isYearPurged(year: number): Promise<boolean> {
    const row = await this.db.prepare("SELECT status FROM archive_years WHERE year = ?").bind(year).first<{ status: string }>();
    return row?.status === "purged";
  }

  async countPendingSourceItemsForYear(year: number): Promise<number> {
    const row = await this.db
      .prepare("SELECT COUNT(*) AS count FROM entry_source_items WHERE status = 'pending' AND entry_date >= ? AND entry_date <= ?")
      .bind(`${year}-01-01`, `${year}-12-31`)
      .first<{ count: number }>();
    return Number(row?.count ?? 0);
  }
}

function buildEntryWhere(filters: SummaryFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const conditions = ["e.archived_at IS NULL"];
  if (filters.type) {
    conditions.push("e.entry_type = ?");
    params.push(filters.type);
  }
  if (filters.from) {
    conditions.push("e.entry_date >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    conditions.push("e.entry_date <= ?");
    params.push(filters.to);
  }
  if (filters.year) {
    conditions.push("e.entry_date >= ? AND e.entry_date <= ?");
    params.push(`${filters.year}-01-01`, `${filters.year}-12-31`);
  }
  const categoryClause = inClause(filters.categoryIds, "e.category_id", params);
  if (categoryClause) conditions.push(categoryClause.replace(/^ AND /, ""));
  const subjectClause = inClause(filters.subjectUserIds, "e.subject_user_id", params);
  if (subjectClause) conditions.push(subjectClause.replace(/^ AND /, ""));
  if (filters.tagIds?.length) {
    conditions.push(`EXISTS (SELECT 1 FROM entry_tags etf WHERE etf.entry_id = e.id AND etf.tag_id IN (${filters.tagIds.map(() => "?").join(",")}))`);
    params.push(...filters.tagIds);
  }
  return { where: `WHERE ${conditions.join(" AND ")}`, params };
}
