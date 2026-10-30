import { archiveEntryRecord, archiveFilename, archiveFooter, archiveHeader, canPurgeArchiveYear, summarizeEntries } from "../domain/archive";
import { sha256Hex } from "../domain/crypto";
import { archiveTargetYear, assertIsoDate, nowIso, yearOf, yearRange } from "../domain/dates";
import { createDedupeKey, duplicatePairKey, textSimilarityScore } from "../domain/dedupe";
import { newId } from "../domain/ids";
import { assertNullableAmount, assertPositiveAmount } from "../domain/money";
import { canAutomaticallyPost, editPendingSourceItem } from "../domain/entrySourceItem";
import { editLedgerEntry } from "../domain/entry";
import { entryProfile, publicUser, type DisplayNames } from "./householdProfiles";
import type {
  Actor,
  ArchiveExport,
  ArchiveYear,
  Category,
  DuplicateCandidate,
  Entry,
  EntryFilters,
  EntrySource,
  EntrySourceItem,
  EntryType,
  FinancialAsset,
  SourceType,
  SummaryFilters,
  Tag
} from "../domain/types";
import type { SourceItemFilters, UnitOfWork } from "../ports/repositories";
import { AppError, notFound, validationError } from "./errors";
import type {
  EntrySourceInput,
  CategoryInput,
  ConfirmExternalBackupInput,
  EntryUpdateInput,
  EntrySourceItemUpdateInput,
  FinancialAssetInput,
  ManualEntryInput,
  PostEntrySourceItemInput,
  TagInput
} from "./inputs";

const SOURCE_GROUP_A: SourceType[] = ["receipt", "order_detail", "manual"];
const SOURCE_GROUP_B: SourceType[] = ["credit_card_statement", "bank_statement"];

export class KakeiboUseCases {
  constructor(
    private readonly repos: UnitOfWork,
    private readonly config: { liveCompletedYearsToKeep: number; displayNames?: DisplayNames }
  ) {}

  async currentUser(actor: Actor) {
    return publicUser(await this.repos.users.upsertAccessUser(actor), this.config.displayNames ?? {});
  }

  async listUsers() {
    return (await this.repos.users.listActive()).map((user) => publicUser(user, this.config.displayNames ?? {}));
  }

  householdProfiles() {
    return Object.entries(this.config.displayNames ?? {}).map(([email, displayName]) => ({ email, displayName }));
  }

  async listTaxonomy(includeInactive = false) {
    const [categories, tags] = await Promise.all([
      this.repos.taxonomy.listCategories(includeInactive),
      this.repos.taxonomy.listTags(includeInactive)
    ]);
    return {
      categories: categories.filter((category) => category.kind === "expense"),
      incomeCategories: categories.filter((category) => category.kind === "income"),
      tags
    };
  }

  async createCategory(input: CategoryInput, actor: Actor): Promise<Category> {
    if (await this.repos.taxonomy.findCategoryByCode(input.code.trim())) throw new AppError("CONFLICT", "category code already exists");
    const now = nowIso();
    return this.repos.taxonomy.createCategory({
      id: newId("cat"),
      code: input.code.trim(),
      name: input.name.trim(),
      kind: input.kind,
      sortOrder: input.sortOrder ?? 0,
      dedupeEnabled: input.dedupeEnabled ?? true,
      isActive: input.isActive ?? true,
      createdBy: actor.displayName,
      createdAt: now,
      updatedBy: actor.displayName,
      updatedAt: now
    });
  }

  async updateCategory(id: string, input: Partial<CategoryInput>, actor: Actor): Promise<Category> {
    const existing = await this.repos.taxonomy.findCategoryById(id);
    if (!existing) notFound("category not found");
    if (input.code !== undefined && input.code.trim() !== existing.code && await this.repos.taxonomy.findCategoryByCode(input.code.trim())) {
      throw new AppError("CONFLICT", "category code already exists");
    }
    if (input.kind !== undefined && input.kind !== existing.kind) {
      const references = await this.repos.taxonomy.countCategoryReferences(id);
      if (references.entries > 0 || references.entrySourceItems > 0) throw new AppError("CONFLICT", "使用中のカテゴリの収入・支出種別は変更できません。");
    }
    return this.repos.taxonomy.updateCategory(id, {
      code: input.code?.trim(),
      name: input.name?.trim(),
      kind: input.kind,
      sortOrder: input.sortOrder,
      dedupeEnabled: input.dedupeEnabled,
      isActive: input.isActive,
      updatedBy: actor.displayName,
      updatedAt: nowIso()
    });
  }

  async deleteCategory(id: string, actor: Actor) {
    const existing = await this.repos.taxonomy.findCategoryById(id);
    if (!existing) notFound("category not found");
    const references = await this.repos.taxonomy.countCategoryReferences(id);
    if (references.entries === 0 && references.entrySourceItems === 0) {
      await this.repos.taxonomy.deleteCategory(id);
      return { mode: "deleted" as const, references };
    }
    await this.repos.taxonomy.updateCategory(id, {
      isActive: false,
      updatedBy: actor.displayName,
      updatedAt: nowIso()
    });
    return { mode: "deactivated" as const, references };
  }

  async createTag(input: TagInput): Promise<Tag> {
    if ((await this.repos.taxonomy.listTags(true)).some((tag) => tag.name === input.name.trim())) throw new AppError("CONFLICT", "tag name already exists");
    const now = nowIso();
    return this.repos.taxonomy.createTag({
      id: newId("tag"),
      name: input.name.trim(),
      isActive: input.isActive ?? true,
      createdAt: now,
      updatedAt: now
    });
  }

  async updateTag(id: string, input: Partial<TagInput>): Promise<Tag> {
    const existing = await this.repos.taxonomy.findTagById(id);
    if (!existing) notFound("tag not found");
    const newName = input.name?.trim();
    if (newName !== undefined && (await this.repos.taxonomy.listTags(true)).some((tag) => tag.id !== id && tag.name === newName)) {
      throw new AppError("CONFLICT", "tag name already exists");
    }
    return this.repos.taxonomy.updateTag(id, {
      name: input.name?.trim(),
      isActive: input.isActive,
      updatedAt: nowIso()
    });
  }

  async deleteTag(id: string) {
    const existing = await this.repos.taxonomy.findTagById(id);
    if (!existing) notFound("tag not found");
    const references = await this.repos.taxonomy.countTagReferences(id, existing.name);
    if (references.entries === 0 && references.entrySourceItems === 0) {
      await this.repos.taxonomy.deleteTag(id);
      return { mode: "deleted" as const, references };
    }
    await this.repos.taxonomy.updateTag(id, { isActive: false, updatedAt: nowIso() });
    return { mode: "deactivated" as const, references };
  }

  async createEntrySource(input: EntrySourceInput, actor: Actor, idempotencyKey?: string | null) {
    const existing = idempotencyKey ? await this.repos.entrySources.findByIdempotencyKey(idempotencyKey) : null;
    if (existing) {
      const items = await this.repos.entrySourceItems.listBySourceId(existing.id);
      return { entrySourceId: existing.id, createdEntrySourceItemIds: items.map((item) => item.id), status: existing.status };
    }

    for (const item of input.items) {
      if (item.entryDate != null) assertIsoDate(item.entryDate, "entryDate");
      assertNullableAmount(item.amount);
      await this.assertDateWritable(item.entryDate);
    }

    const now = nowIso();
    const source: EntrySource = {
      id: newId("es"),
      sourceType: input.sourceType,
      displayName: input.displayName ?? null,
      sourceFileName: input.sourceFileName ?? null,
      sourceSha256: input.sourceSha256 ?? null,
      idempotencyKey: idempotencyKey ?? null,
      rawInputSummary: input.rawInputSummary ?? null,
      rawText: input.rawText ?? null,
      rawPayloadJson: input.rawPayloadJson == null ? null : JSON.stringify(input.rawPayloadJson),
      status: "pending",
      createdBy: actor.displayName,
      createdAt: now,
      updatedBy: actor.displayName,
      updatedAt: now
    };
    await this.repos.entrySources.create(source);

    const createdIds: string[] = [];
    for (const [index, item] of input.items.entries()) {
      const category = item.categoryCodeGuess ? await this.repos.taxonomy.findCategoryByCode(item.categoryCodeGuess, item.entryType)
        : item.categoryNameGuess ? await this.resolveCategoryName(item.categoryNameGuess, item.entryType) : null;
      const created = await this.repos.entrySourceItems.create({
        id: newId("esi"),
        entrySourceId: source.id,
        itemIndex: index,
        entryType: item.entryType,
        subjectUserId: item.subjectUserId ?? null,
        entryDate: item.entryDate ?? null,
        amount: item.amount ?? null,
        currency: item.currency ?? "JPY",
        target: item.target ?? null,
        categoryIdGuess: category?.id ?? null,
        categoryNameGuess: item.categoryNameGuess ?? category?.name ?? null,
        tagsJson: item.tags ? JSON.stringify(item.tags) : null,
        memo: item.memo ?? null,
        confidence: item.confidence ?? null,
        dedupeKey: createDedupeKey(item.entryType, item.currency ?? "JPY", item.amount),
        status: "pending",
        postedEntryId: null,
        createdAt: now,
        updatedAt: now
      });
      createdIds.push(created.id);
    }
    return { entrySourceId: source.id, createdEntrySourceItemIds: createdIds, status: "pending" as const };
  }

  async listEntrySources() {
    return this.repos.entrySources.list();
  }

  async getEntrySource(id: string) {
    const source = await this.repos.entrySources.findById(id);
    if (!source) notFound("entry source not found");
    const items = await this.repos.entrySourceItems.listBySourceId(id);
    return { ...source, items };
  }

  async updateEntrySource(id: string, patch: Partial<EntrySource>, actor: Actor) {
    return this.repos.entrySources.update(id, { ...patch, updatedBy: actor.displayName, updatedAt: nowIso() });
  }

  async listEntrySourceItems(filters: SourceItemFilters) {
    return this.repos.entrySourceItems.list(filters);
  }

  async getEntrySourceItem(id: string) {
    const item = await this.repos.entrySourceItems.findById(id);
    if (!item) notFound("entry source item not found");
    return item;
  }

  async updateEntrySourceItem(id: string, input: EntrySourceItemUpdateInput) {
    const existing = await this.getEntrySourceItem(id);
    const { tags, ...patch } = input;
    const next = editPendingSourceItem(existing, patch, nowIso());
    if (!next) throw new AppError("CONFLICT", "確定済みの明細は下書きとして編集できないよ。");
    await this.assertDateWritable(existing.entryDate);
    await this.assertDateWritable(next.entryDate);
    if (input.categoryIdGuess === undefined && input.categoryNameGuess !== undefined) {
      next.categoryIdGuess = input.categoryNameGuess ? (await this.resolveCategoryName(input.categoryNameGuess, next.entryType))?.id ?? null : null;
    }
    await this.assertCategoryCanBeUsed(next.entryType, next.categoryIdGuess, true);
    if (next.categoryIdGuess) next.categoryNameGuess = (await this.repos.taxonomy.findCategoryById(next.categoryIdGuess))!.name;
    else if (input.categoryIdGuess === null && input.categoryNameGuess === undefined) next.categoryNameGuess = null;
    if (input.subjectUserId != null && !(await this.repos.users.listActive()).some((user) => user.id === input.subjectUserId)) {
      validationError("対象者は有効な家族から選んでね。");
    }
    if (tags !== undefined) {
      const active = new Set((await this.repos.taxonomy.listTags()).map((tag) => tag.name));
      let previous: string[] = [];
      try { const names: unknown = JSON.parse(existing.tagsJson ?? "[]"); if (Array.isArray(names)) previous = names.filter((name): name is string => typeof name === "string"); } catch { /* Existing malformed tags can be replaced explicitly. */ }
      const unknown = tags.filter((tag) => !active.has(tag) && !previous.includes(tag));
      if (unknown.length) validationError(`未登録・無効なタグ: ${unknown.join("、")}。先にタグを登録してね。`);
      next.tagsJson = JSON.stringify([...new Set(tags)]);
    }
    const updated = await this.repos.entrySourceItems.updatePending(next, existing.updatedAt);
    if (!updated) throw new AppError("CONFLICT", "明細が変更されたよ。再取得してからやり直してね。");
    return updated;
  }

  async postHighConfidenceSourceItem(id: string, actor: Actor) {
    const item = await this.getEntrySourceItem(id);
    if (item.status === "posted" && item.postedEntryId) {
      const posted = await this.repos.entries.findById(item.postedEntryId);
      if (posted) return posted;
    }
    if (!canAutomaticallyPost(item)) validationError("自動確定は信頼度95%超の確認待ち明細だけだよ。管理画面で内容を確認して確定してね。");
    if (!item.entryDate || item.amount == null || !item.subjectUserId) validationError("日付・金額・対象者を確認してね。");
    if (!(await this.repos.users.listActive()).some((user) => user.id === item.subjectUserId)) validationError("対象者は有効な家族から選んでね。");
    let names: unknown;
    try { names = JSON.parse(item.tagsJson ?? "[]"); } catch { validationError("推定タグの形式を確認してね。"); }
    if (!Array.isArray(names) || !names.every((name): name is string => typeof name === "string")) validationError("推定タグの形式を確認してね。");
    const active = await this.repos.taxonomy.listTags();
    const tagIds = names.map((name) => {
      const tag = active.find((candidate) => candidate.name === name);
      if (!tag) validationError(`未登録・無効なタグ: ${name}。確認待ちに残したよ。`);
      return tag.id;
    });
    if ((await this.duplicateCandidates(id)).length) throw new AppError("CONFLICT", "重複候補があるよ。管理画面で確認してね。");
    await this.assertDateWritable(item.entryDate);
    return this.createEntryFromSourceItem(item, {
      entryType: item.entryType, entryDate: item.entryDate, amount: item.amount, currency: item.currency,
      subjectUserId: item.subjectUserId, categoryId: item.categoryIdGuess ?? null, tagIds,
      target: item.target ?? null, memo: item.memo ?? null
    }, actor);
  }

  async postEntrySourceItem(id: string, input: PostEntrySourceItemInput, actor: Actor) {
    const item = await this.repos.entrySourceItems.findById(id);
    if (!item) notFound("entry source item not found");
    if (item.status !== "pending") throw new AppError("CONFLICT", "item is already posted");
    return this.createEntryFromSourceItem(item, input, actor);
  }

  async deleteEntrySourceItem(id: string) {
    const item = await this.repos.entrySourceItems.findById(id);
    if (!item) notFound("entry source item not found");
    await this.assertDateWritable(item.entryDate);
    await this.repos.duplicates.deleteByEntrySourceItemId(id);
    await this.repos.entrySourceItems.delete(id);
    const count = await this.repos.entrySourceItems.countBySourceId(item.entrySourceId);
    if (count === 0) {
      await this.repos.entrySources.delete(item.entrySourceId);
      return { deletedSource: true };
    }
    await this.repos.entrySources.refreshStatus(item.entrySourceId);
    return { deletedSource: false };
  }

  async createManualEntry(input: ManualEntryInput, actor: Actor) {
    assertIsoDate(input.entryDate, "entryDate");
    assertPositiveAmount(input.amount);
    if (!input.subjectUserId) validationError("subjectUserId is required");
    if (input.entryType === "expense" && !input.categoryId) validationError("categoryId is required for expense");
    await this.assertDateWritable(input.entryDate);
    await this.assertCategoryCanBeUsed(input.entryType, input.categoryId ?? null, true);
    await this.assertTagsCanBeUsed(input.tagIds ?? []);
    const now = nowIso();
    const source = await this.repos.entrySources.create({
      id: newId("es"),
      sourceType: "manual",
      displayName: input.sourceDisplayName ?? `${input.entryDate} 手入力`,
      sourceFileName: null,
      sourceSha256: null,
      idempotencyKey: null,
      rawInputSummary: "Web UI manual entry",
      rawText: null,
      rawPayloadJson: null,
      status: "posted",
      createdBy: actor.displayName,
      createdAt: now,
      updatedBy: actor.displayName,
      updatedAt: now
    });
    const item = await this.repos.entrySourceItems.create({
      id: newId("esi"),
      entrySourceId: source.id,
      itemIndex: 0,
      entryType: input.entryType,
      subjectUserId: input.subjectUserId,
      entryDate: input.entryDate,
      amount: input.amount,
      currency: input.currency ?? "JPY",
      target: input.target ?? null,
      categoryIdGuess: input.categoryId ?? null,
      categoryNameGuess: null,
      tagsJson: null,
      memo: input.memo ?? null,
      confidence: 1,
      dedupeKey: createDedupeKey(input.entryType, input.currency ?? "JPY", input.amount),
      status: "pending",
      postedEntryId: null,
      createdAt: now,
      updatedAt: now
    });
    return this.createEntryFromSourceItem(item, input, actor);
  }

  async listEntries(filters: EntryFilters) {
    await this.assertNotPurged(filters.from, filters.to);
    return (await this.repos.entries.list(filters)).map((entry) => entryProfile(entry, this.config.displayNames ?? {}));
  }

  async updateEntry(id: string, input: EntryUpdateInput) {
    const existing = await this.getEntry(id);
    const { expectedRevision, tagIds, ...patch } = input;
    const next = editLedgerEntry(existing, patch, expectedRevision);
    if (!next) throw new AppError("CONFLICT", "明細が更新されたよ。再取得して変更内容を確認してね。");
    await this.assertDateWritable(existing.entryDate);
    await this.assertDateWritable(next.entryDate);
    await this.assertCategoryCanBeUsed(next.entryType, next.categoryId, next.categoryId !== existing.categoryId);
    if (tagIds !== undefined) {
      const previousIds = new Set(existing.tags.map((tag) => tag.id));
      await this.assertTagsCanBeUsed(tagIds.filter((id) => !previousIds.has(id)));
    }
    if (input.subjectUserId !== undefined && input.subjectUserId !== existing.subjectUserId &&
        !(await this.repos.users.listActive()).some((user) => user.id === input.subjectUserId)) validationError("対象者は有効な家族から選んでね。");
    const updated = await this.repos.entries.update(next, expectedRevision, tagIds === undefined ? undefined : [...new Set(tagIds)]);
    if (!updated) throw new AppError("CONFLICT", "明細が更新または削除されたよ。再取得して確認してね。");
    return entryProfile(updated, this.config.displayNames ?? {});
  }

  async getEntry(id: string) {
    const entry = await this.repos.entries.findById(id);
    if (!entry) notFound("entry not found");
    await this.assertNotPurged(entry.entryDate, entry.entryDate);
    if (entry.archivedAt) throw new AppError("ARCHIVED_YEAR", "アーカイブ済みの明細は通常画面から編集できないよ。");
    return entryProfile(entry, this.config.displayNames ?? {});
  }

  async deleteEntry(id: string) {
    const existing = await this.repos.entries.findById(id);
    if (!existing) notFound("entry not found");
    await this.assertDateWritable(existing.entryDate);
    await this.repos.duplicates.deleteByEntryId(id);
    await this.repos.entries.delete(id);
    if (existing.entrySourceItemId) {
      const item = await this.repos.entrySourceItems.findById(existing.entrySourceItemId);
      const source = existing.entrySourceId ? await this.repos.entrySources.findById(existing.entrySourceId) : null;
      if (item && source?.sourceType === "manual") {
        await this.repos.entrySourceItems.delete(item.id);
        const count = await this.repos.entrySourceItems.countBySourceId(item.entrySourceId);
        if (count === 0) await this.repos.entrySources.delete(item.entrySourceId);
      } else if (item) {
        await this.repos.entrySourceItems.update(item.id, {
          status: "pending",
          postedEntryId: null,
          updatedAt: nowIso()
        });
        await this.repos.entrySources.refreshStatus(item.entrySourceId);
      }
    }
    return { deleted: true };
  }

  async duplicateCandidates(entrySourceItemId: string): Promise<DuplicateCandidate[]> {
    const item = await this.repos.entrySourceItems.findById(entrySourceItemId);
    if (!item) notFound("entry source item not found");
    if (item.status !== "pending") return [];
    if (item.amount == null || item.entryDate == null) return [];
    const source = await this.repos.entrySources.findById(item.entrySourceId);
    if (!source) notFound("entry source not found");
    const candidates = await this.repos.entries.listDuplicateCandidates({ item, sourceType: source.sourceType, days: 45 });
    const result: DuplicateCandidate[] = [];
    for (const entry of candidates) {
      const pairKey = duplicatePairKey(item.id, entry.id);
      if (await this.repos.duplicates.findExclusion(pairKey)) continue;
      if (!this.isComparableSourcePair(source.sourceType, entry.source?.sourceType ?? "other")) continue;
      const reasons = ["金額一致", "日付が45日以内"];
      let score = 60;
      if (entry.category && item.categoryIdGuess && entry.category.id === item.categoryIdGuess) {
        score += 15;
        reasons.push("カテゴリ一致");
      }
      const textScore = textSimilarityScore(`${item.target ?? ""} ${item.memo ?? ""}`, `${entry.target ?? ""} ${entry.memo ?? ""}`);
      if (textScore > 0) {
        score += textScore;
        reasons.push("用途またはメモが近い");
      }
      if (source.sourceSha256 && source.sourceSha256 === entry.source?.sourceSha256) {
        score += 10;
        reasons.push("source hash一致");
      }
      result.push({ item, entry, score, reasons });
    }
    return result.sort((a, b) => b.score - a.score);
  }

  async markDuplicate(entrySourceItemId: string) {
    return this.deleteEntrySourceItem(entrySourceItemId);
  }

  async markNotDuplicate(entrySourceItemId: string, entryId: string, reason: string | null, actor: Actor) {
    const pairKey = duplicatePairKey(entrySourceItemId, entryId);
    const existing = await this.repos.duplicates.findExclusion(pairKey);
    if (existing) return existing;
    return this.repos.duplicates.createExclusion({
      id: newId("dex"),
      entrySourceItemId,
      entryId,
      pairKey,
      reason,
      createdBy: actor.displayName,
      createdAt: nowIso()
    });
  }

  async listFinancialAssets(includeInactive = false) {
    return (await this.repos.financialAssets.list(includeInactive)).sort((a, b) =>
      a.assetType.localeCompare(b.assetType) || a.name.localeCompare(b.name, "ja") || a.id.localeCompare(b.id));
  }

  async createFinancialAsset(input: FinancialAssetInput, actor: Actor): Promise<FinancialAsset> {
    if (input.ownerUserId != null && !await this.repos.users.findById(input.ownerUserId)) validationError("financial asset owner not found");
    const now = nowIso();
    return this.repos.financialAssets.create({
      id: newId("fa"),
      ownerUserId: input.ownerUserId ?? actor.id,
      name: input.name.trim(),
      assetType: input.assetType,
      quantityText: input.quantityText ?? null,
      valuationMinor: input.valuationMinor ?? null,
      currency: input.currency ?? "JPY",
      valuationUpdatedAt: input.valuationMinor == null ? null : now,
      valuationNote: input.valuationNote ?? null,
      updatedBy: actor.displayName,
      isActive: true,
      createdBy: actor.displayName,
      createdAt: now,
      updatedAt: now
    });
  }

  async updateFinancialAsset(id: string, input: Partial<FinancialAssetInput>, actor: Actor): Promise<FinancialAsset> {
    const existing = await this.repos.financialAssets.findById(id);
    if (!existing) notFound("financial asset not found");
    if (input.ownerUserId != null && !await this.repos.users.findById(input.ownerUserId)) validationError("financial asset owner not found");
    return this.repos.financialAssets.update(id, {
      ownerUserId: input.ownerUserId,
      name: input.name?.trim(),
      assetType: input.assetType,
      quantityText: input.quantityText,
      valuationMinor: input.valuationMinor,
      currency: input.currency,
      valuationUpdatedAt: input.valuationMinor === undefined ? existing.valuationUpdatedAt : nowIso(),
      valuationNote: input.valuationNote,
      updatedBy: actor.displayName,
      updatedAt: nowIso()
    });
  }

  async deleteFinancialAsset(id: string, actor: Actor) {
    if (!await this.repos.financialAssets.findById(id)) notFound("financial asset not found");
    return this.repos.financialAssets.deactivate(id, actor, nowIso());
  }

  async monthlySummary(filters: SummaryFilters) {
    await this.assertNotPurged(filters.from, filters.to, filters.year);
    return this.repos.summaries.monthly(filters);
  }

  async dailySummary(filters: SummaryFilters) {
    await this.assertNotPurged(filters.from, filters.to, filters.year);
    return this.repos.summaries.daily(filters);
  }

  async categorySummary(filters: SummaryFilters) {
    await this.assertNotPurged(filters.from, filters.to, filters.year);
    return this.repos.summaries.category(filters);
  }

  async cashflowSummary(year: number) {
    await this.assertNotPurged(`${year}-01-01`, `${year}-12-31`, year);
    return this.repos.summaries.cashflow(year);
  }

  async householdOverview(filters: SummaryFilters) {
    if (!filters.from || !filters.to) validationError("from and to are required");
    await this.assertNotPurged(filters.from, filters.to);
    return this.repos.summaries.householdOverview(filters);
  }

  async insightEntries(filters: EntryFilters) {
    if (!filters.from || !filters.to || !filters.limit) {
      validationError("from, to and limit are required");
    }
    return this.listEntries({ ...filters, limit: Math.min(filters.limit ?? 200, 200) });
  }

  async listArchiveYears() {
    return this.repos.archives.listYears();
  }

  async prepareArchive(currentYear: number, actor: Actor) {
    const year = archiveTargetYear(currentYear, this.config.liveCompletedYearsToKeep);
    const { from, to } = yearRange(year);
    const entries = await this.repos.entries.list({ from, to });
    const stats = summarizeEntries(entries);
    const now = nowIso();
    const existing = await this.repos.archives.findYear(year);
    if (existing) {
      if (isWriteLockedArchiveStatus(existing.status)) {
        throw new AppError("ARCHIVE_LOCKED_YEAR", `${year}年は外部バックアップ確認後のため再準備できません。`);
      }
      return this.repos.archives.updateYear(existing.id, {
        status: "due",
        entryCount: stats.entryCount,
        expenseCount: stats.expenseCount,
        incomeCount: stats.incomeCount,
        totalExpense: stats.totalExpense,
        totalIncome: stats.totalIncome,
        updatedAt: now
      });
    }
    return this.repos.archives.createYear({
      id: newId("arch"),
      year,
      status: "due",
      archiveFormat: "ndjson.gz",
      archiveFormatVersion: 1,
      ...stats,
      lastExportId: null,
      lastExportedAt: null,
      lastExportedBy: null,
      lastContentSha256: null,
      externalBackupConfirmedAt: null,
      externalBackupConfirmedBy: null,
      externalStorageNote: null,
      purgedAt: null,
      purgedBy: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now
    });
  }

  async buildArchive(year: number, actor: Actor) {
    const archiveYear = await this.repos.archives.findYear(year);
    if (!archiveYear || !["due", "exported"].includes(archiveYear.status)) {
      throw new AppError("CONFLICT", "archive year is not ready for download");
    }
    const pending = await this.repos.archives.countPendingSourceItemsForYear(year);
    if (pending > 0) {
      throw new AppError("ARCHIVE_BLOCKED_BY_PENDING_SOURCE_ITEMS", `${year}年に未確認の登録元明細があります。`, 409, {
        entrySourceItems: pending
      });
    }
    const now = nowIso();
    const exportId = newId("aexp");
    const entries = await this.repos.entries.listByYear(year);
    const stats = summarizeEntries(entries);
    const linesWithoutFooter = [
      archiveHeader(exportId, year, now),
      { type: "schema_info", app_schema_version: 1 },
      ...(await this.repos.taxonomy.listCategories(true)).map((category) => ({ type: "category_snapshot", category })),
      ...(await this.repos.taxonomy.listTags(true)).map((tag) => ({ type: "tag_snapshot", tag })),
      ...entries.map(archiveEntryRecord)
    ].map((record) => JSON.stringify(record));
    const payload = `${linesWithoutFooter.join("\n")}\n`;
    const payloadSha256 = await sha256Hex(payload);
    const fullNdjson = `${payload}${JSON.stringify(archiveFooter(exportId, stats, payloadSha256))}\n`;
    const createdExport: ArchiveExport = {
      id: exportId,
      archiveYearId: archiveYear.id,
      year,
      filename: archiveFilename(year),
      archiveFormat: "ndjson.gz",
      archiveFormatVersion: 1,
      contentSha256: payloadSha256,
      ...stats,
      generatedBy: actor.displayName,
      generatedAt: now,
      completedAt: now,
      status: "completed",
      errorMessage: null
    };
    await this.repos.archives.createExport(createdExport);
    await this.repos.archives.updateYear(archiveYear.id, {
      status: "exported",
      entryCount: stats.entryCount,
      expenseCount: stats.expenseCount,
      incomeCount: stats.incomeCount,
      totalExpense: stats.totalExpense,
      totalIncome: stats.totalIncome,
      lastExportId: exportId,
      lastExportedAt: now,
      lastExportedBy: actor.displayName,
      lastContentSha256: payloadSha256,
      updatedAt: now
    });
    return { archiveExport: createdExport, ndjson: fullNdjson };
  }

  async confirmExternalBackup(year: number, input: ConfirmExternalBackupInput, actor: Actor) {
    const archiveYear = await this.repos.archives.findYear(year);
    if (!archiveYear) notFound("archive year not found");
    if (archiveYear.lastExportId !== input.exportId) {
      throw new AppError("CONFLICT", "exportId is not the latest archive export");
    }
    const archiveExport = await this.repos.archives.findExport(input.exportId);
    if (!archiveExport || archiveExport.year !== year) notFound("archive export not found");
    if (archiveExport.contentSha256 !== input.contentSha256) {
      throw new AppError("CONFLICT", "contentSha256 does not match");
    }
    await this.assertArchiveExportMatchesCurrentData(year, archiveExport);
    return this.repos.archives.updateYear(archiveYear.id, {
      status: "external_confirmed",
      externalBackupConfirmedAt: nowIso(),
      externalBackupConfirmedBy: actor.displayName,
      externalStorageNote: input.externalStorageNote ?? null,
      updatedAt: nowIso()
    });
  }

  async purgeArchive(year: number, actor: Actor) {
    const archiveYear = await this.repos.archives.findYear(year);
    if (!archiveYear) notFound("archive year not found");
    if (!canPurgeArchiveYear(archiveYear)) {
      throw new AppError("ARCHIVE_NOT_EXTERNAL_CONFIRMED", "external backup is not confirmed");
    }
    if (!archiveYear.lastExportId) {
      throw new AppError("CONFLICT", "latest archive export is missing");
    }
    const archiveExport = await this.repos.archives.findExport(archiveYear.lastExportId);
    if (!archiveExport || archiveExport.year !== year) {
      throw new AppError("CONFLICT", "latest archive export is missing");
    }
    if (archiveYear.lastContentSha256 && archiveExport.contentSha256 !== archiveYear.lastContentSha256) {
      throw new AppError("CONFLICT", "archive year does not point to the latest export content");
    }
    await this.assertArchiveExportMatchesCurrentData(year, archiveExport);
    const pending = await this.repos.archives.countPendingSourceItemsForYear(year);
    if (pending > 0) {
      throw new AppError("ARCHIVE_BLOCKED_BY_PENDING_SOURCE_ITEMS", `${year}年に未確認の登録元明細があります。`, 409, {
        entrySourceItems: pending
      });
    }
    await this.repos.archives.updateYear(archiveYear.id, { status: "purging", updatedAt: nowIso() });
    try {
      await this.repos.entries.deleteByYear(year);
      const sourceItems = await this.repos.entrySourceItems.list({ from: `${year}-01-01`, to: `${year}-12-31` });
      const touchedSourceIds = new Set<string>();
      for (const item of sourceItems) {
        touchedSourceIds.add(item.entrySourceId);
        await this.repos.duplicates.deleteByEntrySourceItemId(item.id);
        await this.repos.entrySourceItems.delete(item.id);
      }
      for (const sourceId of touchedSourceIds) {
        const count = await this.repos.entrySourceItems.countBySourceId(sourceId);
        if (count === 0) await this.repos.entrySources.delete(sourceId);
      }
    } catch (error) {
      await this.repos.archives.updateYear(archiveYear.id, {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        updatedAt: nowIso()
      });
      throw error;
    }
    return this.repos.archives.updateYear(archiveYear.id, {
      status: "purged",
      purgedAt: nowIso(),
      purgedBy: actor.displayName,
      updatedAt: nowIso()
    });
  }

  private async createEntryFromSourceItem(item: EntrySourceItem, input: PostEntrySourceItemInput, actor: Actor) {
    assertIsoDate(input.entryDate, "entryDate");
    assertPositiveAmount(input.amount);
    if (!input.subjectUserId) validationError("subjectUserId is required");
    if (input.entryType === "expense" && !input.categoryId) validationError("categoryId is required for expense");
    if (!(input.currency ?? "JPY").trim()) validationError("通貨を入力してね。");
    await this.assertDateWritable(item.entryDate);
    await this.assertDateWritable(input.entryDate);
    await this.assertCategoryCanBeUsed(input.entryType, input.categoryId ?? null, true);
    await this.assertTagsCanBeUsed(input.tagIds ?? []);
    const now = nowIso();
    const entry: Entry = {
      id: newId("ent"),
      revision: crypto.randomUUID(),
      entryType: input.entryType,
      subjectUserId: input.subjectUserId,
      entryDate: input.entryDate,
      amount: input.amount,
      currency: input.currency ?? "JPY",
      categoryId: input.categoryId ?? null,
      target: input.target ?? null,
      memo: input.memo ?? null,
      entrySourceId: item.entrySourceId,
      entrySourceItemId: item.id,
      dedupeKey: createDedupeKey(input.entryType, input.currency ?? "JPY", input.amount),
      fixedAt: now,
      archivedAt: null,
      archiveYearId: null
    };
    const category = input.categoryId ? await this.repos.taxonomy.findCategoryById(input.categoryId) : null;
    const tags = await Promise.all([...new Set(input.tagIds ?? [])].map((id) => this.repos.taxonomy.findTagById(id)));
    const updatedItem: EntrySourceItem = {
      ...item,
      entryType: input.entryType,
      subjectUserId: input.subjectUserId,
      entryDate: input.entryDate,
      amount: input.amount,
      currency: input.currency ?? "JPY",
      target: input.target ?? null,
      categoryIdGuess: input.categoryId ?? null,
      categoryNameGuess: category?.name ?? null,
      tagsJson: JSON.stringify(tags.map((tag) => tag!.name)),
      memo: input.memo ?? null,
      dedupeKey: entry.dedupeKey,
      status: "posted",
      postedEntryId: entry.id,
      updatedAt: now
    };
    const created = await this.repos.entries.postSourceItem(entry, input.tagIds ?? [], updatedItem, item.updatedAt);
    if (!created) throw new AppError("CONFLICT", "明細が変更または確定されたよ。再取得して確認してね。");
    return created;
  }

  private async resolveCategoryName(name: string, entryType: EntryType): Promise<Category | null> {
    const matches = (await this.repos.taxonomy.listCategories()).filter((category) => category.kind === entryType && category.name === name);
    return matches.length === 1 ? matches[0] : null;
  }

  private async assertArchiveExportMatchesCurrentData(year: number, archiveExport: ArchiveExport): Promise<void> {
    const currentStats = summarizeEntries(await this.repos.entries.listByYear(year));
    if (
      currentStats.entryCount !== archiveExport.entryCount ||
      currentStats.expenseCount !== archiveExport.expenseCount ||
      currentStats.incomeCount !== archiveExport.incomeCount ||
      currentStats.totalExpense !== archiveExport.totalExpense ||
      currentStats.totalIncome !== archiveExport.totalIncome
    ) {
      throw new AppError("CONFLICT", "current data differs from exported archive");
    }
  }

  private async assertCategoryCanBeUsed(entryType: EntryType, categoryId: string | null | undefined, requireActive: boolean): Promise<void> {
    if (!categoryId) return;
    const category = await this.repos.taxonomy.findCategoryById(categoryId);
    if (!category) validationError("categoryId does not exist");
    if (category.kind !== entryType) validationError("category kind does not match entryType");
    if (requireActive && !category.isActive) validationError("category is inactive");
  }

  private async assertTagsCanBeUsed(tagIds: string[]): Promise<void> {
    const seen = new Set<string>();
    for (const tagId of tagIds) {
      if (seen.has(tagId)) continue;
      seen.add(tagId);
      const tag = await this.repos.taxonomy.findTagById(tagId);
      if (!tag) validationError(`tagId does not exist: ${tagId}`);
      if (!tag.isActive) validationError(`tag is inactive: ${tagId}`);
    }
  }

  private async assertDateWritable(date: string | null | undefined): Promise<void> {
    if (date == null) return;
    assertIsoDate(date, "entryDate");
    const archiveYear = await this.repos.archives.findYear(yearOf(date));
    if (archiveYear && isWriteLockedArchiveStatus(archiveYear.status)) {
      throw new AppError("ARCHIVE_LOCKED_YEAR", `${archiveYear.year}年は外部バックアップ確認後のため変更できません。`);
    }
  }

  private isComparableSourcePair(a: SourceType, b: SourceType): boolean {
    return (SOURCE_GROUP_A.includes(a) && SOURCE_GROUP_B.includes(b)) || (SOURCE_GROUP_B.includes(a) && SOURCE_GROUP_A.includes(b));
  }

  private async assertNotPurged(from?: string, to?: string, year?: number): Promise<void> {
    const years = new Set<number>();
    if (year) years.add(year);
    if (from) years.add(yearOf(from));
    if (to) years.add(yearOf(to));
    for (const y of years) {
      if (await this.repos.archives.isYearPurged(y)) {
        throw new AppError("ARCHIVED_YEAR", "この年のデータはアーカイブ済みです。通常UIでは閲覧できません。");
      }
    }
  }
}

export function sanitizeEntryFilters(filters: EntryFilters): EntryFilters {
  if (filters.from) assertIsoDate(filters.from, "from");
  if (filters.to) assertIsoDate(filters.to, "to");
  if (filters.limit != null && (!Number.isInteger(filters.limit) || filters.limit <= 0)) {
    validationError("limit must be positive integer");
  }
  return filters;
}

export function sanitizeActionItemAmount(amount: number | null | undefined): number | null | undefined {
  assertNullableAmount(amount);
  return amount;
}

function isWriteLockedArchiveStatus(status: ArchiveYear["status"]): boolean {
  return status === "external_confirmed" || status === "purging" || status === "purged";
}
