import { describe, expect, it, vi } from "vitest";
import { InMemoryUnitOfWork } from "@back/adapters/memory/InMemoryRepositories";
import { KakeiboUseCases } from "@back/application/useCases";
import type { Actor, EntryWithDetails } from "@back/domain/types";

const actor: Actor = { id: "usr_local", displayName: "local@example.test", role: "admin" };

function createUseCases() {
  const repos = new InMemoryUnitOfWork();
  const useCases = new KakeiboUseCases(repos, { liveCompletedYearsToKeep: 3 });
  return { repos, useCases };
}

describe("kakeibo use cases", () => {
  async function posted() {
    const f = createUseCases();
    await f.useCases.currentUser(actor);
    const category = await f.useCases.createCategory({ code: "edit-food", name: "食費", kind: "expense" }, actor);
    const tag = await f.useCases.createTag({ name: "家族" });
    const entry = await f.useCases.createManualEntry({ entryType: "expense", entryDate: "2026-10-24", amount: 100,
      subjectUserId: actor.id, categoryId: category.id, tagIds: [tag.id], target: "元の用途", memo: "元のメモ" }, actor);
    return { ...f, entry, category, tag };
  }

  it("edits the same posted entry, updates totals and preserves the import snapshot, fixed time and omitted fields", async () => {
    const f = await posted();
    const before = await f.useCases.getEntrySourceItem(f.entry.entrySourceItemId!);
    const result = await f.useCases.updateEntry(f.entry.id, { expectedRevision: f.entry.revision, amount: 120, memo: null });
    expect(result).toMatchObject({ id: f.entry.id, amount: 120, memo: null, target: "元の用途", fixedAt: f.entry.fixedAt, tags: [{ id: f.tag.id }] });
    expect(result.revision).not.toBe(f.entry.revision);
    expect(await f.useCases.getEntrySourceItem(f.entry.entrySourceItemId!)).toEqual(before);
    expect((await f.repos.entries.list({}))).toHaveLength(1);
    expect(await f.useCases.householdOverview({ from: "2026-10-24", to: "2026-10-24" })).toMatchObject({ expenseTotal: 120 });
  });

  it("keeps existing inactive classifications while rejecting a newly selected inactive classification", async () => {
    const f = await posted();
    await f.useCases.updateCategory(f.category.id, { isActive: false }, actor);
    await f.useCases.updateTag(f.tag.id, { isActive: false });
    const edited = await f.useCases.updateEntry(f.entry.id, { expectedRevision: f.entry.revision, amount: 125, categoryId: f.category.id, tagIds: [f.tag.id] });
    expect(edited).toMatchObject({ amount: 125, categoryId: f.category.id, tags: [{ id: f.tag.id }] });
    const inactive = await f.useCases.createTag({ name: "新たな無効タグ", isActive: false });
    await expect(f.useCases.updateEntry(f.entry.id, { expectedRevision: edited.revision, tagIds: [inactive.id] })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("clears tags and nullable notes explicitly without altering the entry identity", async () => {
    const f = await posted();
    expect(await f.useCases.updateEntry(f.entry.id, { expectedRevision: f.entry.revision, tagIds: [], target: null })).toMatchObject({ id: f.entry.id, tags: [], target: null, amount: 100 });
  });

  it("rejects incompatible kinds and invalid references before changing a posted entry", async () => {
    const f = await posted();
    for (const patch of [{ entryType: "income" as const }, { subjectUserId: "unknown" }, { tagIds: ["unknown"] }, { categoryId: "unknown" }]) {
      await expect(f.useCases.updateEntry(f.entry.id, { expectedRevision: f.entry.revision, ...patch })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(await f.useCases.getEntry(f.entry.id)).toMatchObject({ revision: f.entry.revision, entryType: "expense", tags: [{ id: f.tag.id }] });
    const income = await f.useCases.updateEntry(f.entry.id, { expectedRevision: f.entry.revision, entryType: "income", categoryId: null });
    expect(income).toMatchObject({ entryType: "income", categoryId: null });
    expect(await f.useCases.householdOverview({ from: "2026-10-24", to: "2026-10-24" })).toMatchObject({ incomeTotal: 100, expenseTotal: 0 });
  });

  it("rejects stale and simultaneous edits without overwriting newer values or tags", async () => {
    const f = await posted();
    const winner = await f.useCases.updateEntry(f.entry.id, { expectedRevision: f.entry.revision, amount: 150 });
    await expect(f.useCases.updateEntry(f.entry.id, { expectedRevision: f.entry.revision, amount: 999, tagIds: [] })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await f.useCases.getEntry(f.entry.id)).toMatchObject({ amount: 150, tags: [{ id: f.tag.id }] });
    const results = await Promise.allSettled([
      f.useCases.updateEntry(f.entry.id, { expectedRevision: winner.revision, amount: 200 }),
      f.useCases.updateEntry(f.entry.id, { expectedRevision: winner.revision, amount: 300, tagIds: [] })
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  async function draft(confidence: number | null = 0.96) {
    const fixture = createUseCases();
    await fixture.useCases.currentUser(actor);
    const category = await fixture.useCases.createCategory({ code: "draft-food", name: "食費", kind: "expense" }, actor);
    const tag = await fixture.useCases.createTag({ name: "スーパー" });
    const source = await fixture.useCases.createEntrySource({ sourceType: "receipt", items: [{
      entryType: "expense", subjectUserId: actor.id, entryDate: "2026-10-24", amount: 123,
      categoryCodeGuess: category.code, tags: [tag.name], confidence
    }] }, actor);
    return { ...fixture, category, tag, id: source.createdEntrySourceItemIds[0] };
  }

  it("preserves omitted draft values, clears explicit nulls and arrays and regenerates deduplication data", async () => {
    const f = await draft();
    expect(await f.useCases.updateEntrySourceItem(f.id, { memo: "変更" })).toMatchObject({ amount: 123, categoryIdGuess: f.category.id, tagsJson: '["スーパー"]' });
    expect(await f.useCases.updateEntrySourceItem(f.id, { amount: null, tags: [], categoryIdGuess: null, subjectUserId: null })).toMatchObject({ amount: null, dedupeKey: null, tagsJson: "[]", categoryNameGuess: null, subjectUserId: null });
    expect((await f.repos.entries.list({}))).toEqual([]);
  });

  it("validates category kind changes, active classifications and new tag names before saving", async () => {
    const f = await draft();
    for (const patch of [{ entryType: "income" as const }, { subjectUserId: "unknown" }, { tags: ["未登録"] }]) {
      await expect(f.useCases.updateEntrySourceItem(f.id, patch)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    }
    expect(await f.useCases.getEntrySourceItem(f.id)).toMatchObject({ entryType: "expense", subjectUserId: actor.id, tagsJson: '["スーパー"]' });
    await f.useCases.updateCategory(f.category.id, { isActive: false }, actor);
    await expect(f.useCases.updateEntrySourceItem(f.id, { categoryIdGuess: f.category.id })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it.each([null, 0, 0.9499, 0.95])("leaves confidence %s pending when automatic confirmation is requested", async (confidence) => {
    const f = await draft(confidence);
    await expect(f.useCases.postHighConfidenceSourceItem(f.id, actor)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await f.useCases.getEntrySourceItem(f.id)).toMatchObject({ status: "pending" });
    expect(await f.repos.entries.list({})).toEqual([]);
  });

  it("posts confidence above 95% once, returns its result on retry and blocks subsequent draft editing", async () => {
    const f = await draft(0.9501);
    const entry = await f.useCases.postHighConfidenceSourceItem(f.id, actor);
    expect(await f.useCases.postHighConfidenceSourceItem(f.id, actor)).toEqual(entry);
    expect(await f.useCases.getEntrySourceItem(f.id)).toMatchObject({ status: "posted", postedEntryId: entry.id, tagsJson: '["スーパー"]' });
    expect(await f.repos.entries.list({})).toHaveLength(1);
    await expect(f.useCases.updateEntrySourceItem(f.id, { memo: "不可" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("leaves incomplete or invalid high-confidence drafts pending", async () => {
    for (const patch of [{ entryDate: null }, { amount: null }, { amount: 0 }, { categoryIdGuess: null }, { subjectUserId: null }]) {
      const f = await draft();
      await f.useCases.updateEntrySourceItem(f.id, patch);
      await expect(f.useCases.postHighConfidenceSourceItem(f.id, actor)).rejects.toBeDefined();
      expect(await f.repos.entries.list({})).toEqual([]);
      expect(await f.useCases.getEntrySourceItem(f.id)).toMatchObject({ status: "pending" });
    }
    const f = await draft();
    await f.repos.entrySourceItems.update(f.id, { tagsJson: '["不明タグ"]' });
    await expect(f.useCases.postHighConfidenceSourceItem(f.id, actor)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await f.repos.entries.list({})).toEqual([]);
  });

  it("leaves duplicate candidates for human review", async () => {
    const f = await draft();
    const entry = await f.useCases.createManualEntry({ entryType: "expense", entryDate: "2026-10-24", amount: 123, subjectUserId: actor.id, categoryId: f.category.id }, actor);
    await f.repos.entrySources.update(entry.entrySourceId!, { sourceType: "bank_statement" });
    await expect(f.useCases.postHighConfidenceSourceItem(f.id, actor)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await f.useCases.getEntrySourceItem(f.id)).toMatchObject({ status: "pending" });
    expect(await f.repos.entries.list({})).toHaveLength(1);
  });

  it("rejects stale edits and posts instead of replacing newer draft values", async () => {
    const f = await draft();
    const update = f.repos.entrySourceItems.updatePending.bind(f.repos.entrySourceItems);
    vi.spyOn(f.repos.entrySourceItems, "updatePending").mockImplementationOnce(async (item, expected) => {
      await f.repos.entrySourceItems.update(f.id, { memo: "別の編集", updatedAt: "2099-01-01T00:00:00.000Z" });
      return update(item, expected);
    });
    await expect(f.useCases.updateEntrySourceItem(f.id, { memo: "古い編集" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await f.useCases.getEntrySourceItem(f.id)).toMatchObject({ memo: "別の編集" });
    const post = f.repos.entries.postSourceItem.bind(f.repos.entries);
    vi.spyOn(f.repos.entries, "postSourceItem").mockImplementationOnce(async (entry, tags, item, expected) => {
      await f.repos.entrySourceItems.update(f.id, { updatedAt: "2099-01-02T00:00:00.000Z" });
      return post(entry, tags, item, expected);
    });
    await expect(f.useCases.postHighConfidenceSourceItem(f.id, actor)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await f.repos.entries.list({})).toEqual([]);
  });

  it("allows only one concurrent confirmation and refreshes the source status", async () => {
    const f = await draft();
    const results = await Promise.allSettled([f.useCases.postHighConfidenceSourceItem(f.id, actor), f.useCases.postHighConfidenceSourceItem(f.id, actor)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await f.repos.entries.list({})).toHaveLength(1);
    const item = await f.useCases.getEntrySourceItem(f.id);
    expect(await f.repos.entrySources.findById(item.entrySourceId)).toMatchObject({ status: "posted" });
  });

  it("rejects duplicate classification identities and changing the kind of a used category", async () => {
    const { useCases } = createUseCases();
    const category = await useCases.createCategory({ code: "identity", name: "分類", kind: "expense" }, actor);
    await expect(useCases.createCategory({ code: "identity", name: "別分類", kind: "income" }, actor)).rejects.toMatchObject({ code: "CONFLICT" });
    const tag = await useCases.createTag({ name: "同じタグ" });
    await expect(useCases.createTag({ name: "同じタグ" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await useCases.updateTag(tag.id, { name: "同じタグ" })).toMatchObject({ name: "同じタグ" });
    await useCases.createEntrySource({ sourceType: "receipt", items: [{ entryType: "expense", categoryCodeGuess: "identity" }] }, actor);
    await expect(useCases.updateCategory(category.id, { kind: "income" }, actor)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await useCases.updateCategory(category.id, { name: "更新した分類" }, actor)).toMatchObject({ name: "更新した分類", kind: "expense" });
  });

  it("returns not found when deleting an unknown financial asset", async () => {
    const { useCases } = createUseCases();
    await expect(useCases.deleteFinancialAsset("missing", actor)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an unknown financial asset owner", async () => {
    const { useCases } = createUseCases();
    await expect(useCases.createFinancialAsset({ name: "預金", assetType: "bank_deposit", ownerUserId: "unknown-user" }, actor)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("creates manual entry with manual source and source item", async () => {
    const { repos, useCases } = createUseCases();
    const category = await useCases.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
    const entry = await useCases.createManualEntry(
      {
        entryType: "expense",
        entryDate: "2026-06-20",
        amount: 1280,
        subjectUserId: actor.id,
        categoryId: category.id,
        tagIds: [],
        target: "昼食",
        memo: ""
      },
      actor
    );

    expect(entry.entrySourceId).toBeTruthy();
    expect(entry.entrySourceItemId).toBeTruthy();
    const source = await repos.entrySources.findById(entry.entrySourceId!);
    const item = await repos.entrySourceItems.findById(entry.entrySourceItemId!);
    expect(source?.sourceType).toBe("manual");
    expect(item?.status).toBe("posted");
  });

  it("keeps ChatGPT action entry source items pending", async () => {
    const { repos, useCases } = createUseCases();
    const result = await useCases.createEntrySource(
      {
        sourceType: "receipt",
        displayName: "レシート",
        items: [
          {
            entryType: "expense",
            entryDate: "2026-06-20",
            amount: 900,
            currency: "JPY",
            target: "弁当",
            confidence: 0.8
          }
        ]
      },
      actor,
      "idem-1"
    );
    const item = await repos.entrySourceItems.findById(result.createdEntrySourceItemIds[0]);
    expect(item?.status).toBe("pending");
    expect((await repos.entries.list({}))).toHaveLength(0);
  });

  it("groups confirmed receipt items, keeps mixed categories, and preserves entry summaries", async () => {
    const { repos, useCases } = createUseCases();
    const food = await useCases.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
    const daily = await useCases.createCategory({ code: "daily", name: "日用品", kind: "expense" }, actor);
    const income = await useCases.createCategory({ code: "refund", name: "返金", kind: "income" }, actor);
    const imported = await useCases.createEntrySource({
      sourceType: "receipt",
      displayName: "まちのパン屋",
      items: [
        { entryType: "expense", entryDate: "2026-06-20", amount: 300, target: "食パン" },
        { entryType: "expense", entryDate: "2026-06-20", amount: 200, target: "紙袋" },
        { entryType: "income", entryDate: "2026-06-20", amount: 100, target: "返金" }
      ]
    }, actor);
    const first = await useCases.postEntrySourceItem(imported.createdEntrySourceItemIds[0], {
      entryType: "expense", entryDate: "2026-06-20", amount: 300, subjectUserId: actor.id, categoryId: food.id, tagIds: []
    }, actor);
    expect(await useCases.listReceipts({ page: 1, pageSize: 20 })).toMatchObject({
      totalItems: 1,
      items: [{ entryCount: 1, totals: [{ currency: "JPY", amount: 300 }] }]
    });
    const second = await useCases.postEntrySourceItem(imported.createdEntrySourceItemIds[1], {
      entryType: "expense", entryDate: "2026-06-20", amount: 200, subjectUserId: actor.id, categoryId: daily.id, tagIds: []
    }, actor);
    const refund = await useCases.postEntrySourceItem(imported.createdEntrySourceItemIds[2], {
      entryType: "income", entryDate: "2026-06-20", amount: 100, subjectUserId: actor.id, categoryId: income.id, tagIds: []
    }, actor);
    expect(first.receiptId).toBeTruthy();
    expect(second.receiptId).toBe(first.receiptId);
    expect(refund.receiptId).toBeNull();

    const filtered = await useCases.listReceipts({ categoryIds: [food.id], page: 1, pageSize: 20 });
    expect(filtered).toMatchObject({
      totalItems: 1,
      filteredReceiptTotals: [{ currency: "JPY", amount: 500 }],
      items: [{ displayName: "まちのパン屋", entryCount: 2, totals: [{ currency: "JPY", amount: 500 }] }]
    });
    expect(new Set(filtered.items[0].entries.map((entry) => entry.category?.name))).toEqual(new Set(["食費", "日用品"]));
    expect(await useCases.dailySummary({ type: "expense", from: "2026-06-20", to: "2026-06-20" })).toMatchObject([{ expenseTotal: 500, entryCount: 2 }]);

    await useCases.deleteReceipt(first.receiptId!);
    expect((await repos.entries.findById(first.id))?.receiptId).toBeNull();
    expect((await repos.entries.findById(second.id))?.receiptId).toBeNull();
    expect(await useCases.dailySummary({ type: "expense", from: "2026-06-20", to: "2026-06-20" })).toMatchObject([{ expenseTotal: 500, entryCount: 2 }]);
  });

  it("keeps receipt totals separate by currency and removes only empty receipts after entry deletion", async () => {
    const { repos, useCases } = createUseCases();
    const category = await useCases.createCategory({ code: "travel", name: "旅行", kind: "expense" }, actor);
    const tag = await useCases.createTag({ name: "出張" });
    const jpy = await useCases.createManualEntry({
      entryType: "expense", entryDate: "2026-06-20", amount: 1000, currency: "JPY", subjectUserId: actor.id,
      categoryId: category.id, tagIds: [tag.id], target: "国内交通"
    }, actor);
    const usd = await useCases.createManualEntry({
      entryType: "expense", entryDate: "2026-06-21", amount: 20, currency: "USD", subjectUserId: actor.id,
      categoryId: category.id, tagIds: [tag.id], target: "海外交通"
    }, actor);
    const receipt = await useCases.createReceipt({ entryIds: [jpy.id, usd.id], displayName: "旅行" }, actor);
    const listed = await useCases.listReceipts({ tagIds: [tag.id], page: 1, pageSize: 20 });
    expect(listed.items[0].totals).toEqual([{ currency: "JPY", amount: 1000 }, { currency: "USD", amount: 20 }]);
    expect(listed.filteredReceiptTotals).toEqual([{ currency: "JPY", amount: 1000 }, { currency: "USD", amount: 20 }]);

    await useCases.deleteEntry(jpy.id);
    expect(await repos.receipts.findById(receipt.id)).not.toBeNull();
    expect((await useCases.listReceipts({ page: 1, pageSize: 20 })).items[0]).toMatchObject({ entryCount: 1, totals: [{ currency: "USD", amount: 20 }] });
    await useCases.deleteEntry(usd.id);
    expect(await repos.receipts.findById(receipt.id)).toBeNull();
  });

  it("manually groups past expenses and paginates by whole receipts", async () => {
    const { useCases } = createUseCases();
    const category = await useCases.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
    const entries: EntryWithDetails[] = [];
    for (const [index, amount] of [100, 200, 300, 400].entries()) {
      entries.push(await useCases.createManualEntry({
        entryType: "expense",
        entryDate: `2026-06-${20 + index}`,
        amount,
        subjectUserId: actor.id,
        categoryId: category.id,
        tagIds: [],
        target: `品物${index + 1}`
      }, actor));
    }
    await useCases.createReceipt({ entryIds: [entries[0].id, entries[1].id], displayName: "買物A" }, actor);
    await useCases.createReceipt({ entryIds: [entries[2].id, entries[3].id], displayName: "買物B" }, actor);

    const firstPage = await useCases.listReceipts({ page: 1, pageSize: 1 });
    const secondPage = await useCases.listReceipts({ page: 2, pageSize: 1 });
    expect(firstPage).toMatchObject({ totalItems: 2, totalPages: 2, filteredReceiptTotals: [{ currency: "JPY", amount: 1000 }] });
    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(1);
    expect([...firstPage.items, ...secondPage.items].flatMap((receipt) => receipt.entries)).toHaveLength(4);
    await expect(useCases.createReceipt({ entryIds: [entries[0].id, entries[2].id] }, actor)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects an invalid manual receipt without partially grouping valid entries", async () => {
    const { repos, useCases } = createUseCases();
    const expenseCategory = await useCases.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
    const incomeCategory = await useCases.createCategory({ code: "salary", name: "給与", kind: "income" }, actor);
    const expense = await useCases.createManualEntry({
      entryType: "expense", entryDate: "2026-06-20", amount: 100, subjectUserId: actor.id,
      categoryId: expenseCategory.id, tagIds: [], target: "パン"
    }, actor);
    const income = await useCases.createManualEntry({
      entryType: "income", entryDate: "2026-06-20", amount: 200, subjectUserId: actor.id,
      categoryId: incomeCategory.id, tagIds: [], target: "返金"
    }, actor);

    await expect(useCases.createReceipt({ entryIds: [expense.id, income.id] }, actor)).rejects.toThrow(/only expense/);
    expect((await repos.entries.findById(expense.id))?.receiptId).toBeNull();
    expect((await repos.entries.findById(income.id))?.receiptId).toBeNull();
    await expect(useCases.createReceipt({ entryIds: [expense.id, "ent_missing"] }, actor)).rejects.toThrow(/entry not found/);
    expect((await repos.entries.findById(expense.id))?.receiptId).toBeNull();
    const now = new Date().toISOString();
    await expect(repos.receipts.create({
      id: "rct_failed",
      entrySourceId: null,
      displayName: "失敗するまとまり",
      createdAt: now,
      updatedAt: now
    }, [expense.id, "ent_missing"])).resolves.toBeNull();
    expect(await repos.receipts.findById("rct_failed")).toBeNull();
    expect((await repos.entries.findById(expense.id))?.receiptId).toBeNull();
  });

  it("physically deletes unused category and deactivates used category", async () => {
    const { repos, useCases } = createUseCases();
    const unused = await useCases.createCategory({ code: "tmp", name: "仮", kind: "expense" }, actor);
    await expect(useCases.deleteCategory(unused.id, actor)).resolves.toMatchObject({ mode: "deleted" });

    const used = await useCases.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
    await useCases.createManualEntry(
      {
        entryType: "expense",
        entryDate: "2026-06-20",
        amount: 1280,
        subjectUserId: actor.id,
        categoryId: used.id,
        tagIds: [],
        target: "昼食"
      },
      actor
    );
    const result = await useCases.deleteCategory(used.id, actor);
    expect(result.mode).toBe("deactivated");
    expect((await repos.taxonomy.findCategoryById(used.id))?.isActive).toBe(false);
  });

  it("rejects unknown tags and category kind mismatches", async () => {
    const { useCases } = createUseCases();
    const incomeCategory = await useCases.createCategory({ code: "salary", name: "給与", kind: "income" }, actor);
    await expect(
      useCases.createManualEntry(
        {
          entryType: "expense",
          entryDate: "2026-06-20",
          amount: 1280,
          subjectUserId: actor.id,
          categoryId: incomeCategory.id,
          tagIds: [],
          target: "昼食"
        },
        actor
      )
    ).rejects.toThrow(/category kind/);

    const expenseCategory = await useCases.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
    await expect(
      useCases.createManualEntry(
        {
          entryType: "expense",
          entryDate: "2026-06-20",
          amount: 1280,
          subjectUserId: actor.id,
          categoryId: expenseCategory.id,
          tagIds: ["tag_missing"],
          target: "昼食"
        },
        actor
      )
    ).rejects.toThrow(/tagId does not exist/);
  });

  it("requires confirmed external backup before purge", async () => {
    const { useCases } = createUseCases();
    const archive = await useCases.prepareArchive(2027, actor);
    await expect(useCases.purgeArchive(archive.year, actor)).rejects.toThrow(/external backup/);
  });

  it("locks entry writes after external backup confirmation", async () => {
    const { useCases } = createUseCases();
    const category = await useCases.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
    const entry = await useCases.createManualEntry(
      {
        entryType: "expense",
        entryDate: "2023-06-20",
        amount: 1280,
        subjectUserId: actor.id,
        categoryId: category.id,
        tagIds: [],
        target: "昼食"
      },
      actor
    );
    const secondEntry = await useCases.createManualEntry(
      {
        entryType: "expense",
        entryDate: "2023-06-20",
        amount: 220,
        subjectUserId: actor.id,
        categoryId: category.id,
        tagIds: [],
        target: "飲み物"
      },
      actor
    );
    const receipt = await useCases.createReceipt({ entryIds: [entry.id, secondEntry.id], displayName: "昼食" }, actor);
    const ungroupedEntries = await Promise.all([300, 400].map((amount, index) => useCases.createManualEntry(
      {
        entryType: "expense",
        entryDate: "2023-06-21",
        amount,
        subjectUserId: actor.id,
        categoryId: category.id,
        tagIds: [],
        target: `未整理${index + 1}`
      },
      actor
    )));
    const archiveYear = await useCases.prepareArchive(2027, actor);
    const archive = await useCases.buildArchive(archiveYear.year, actor);
    expect(archive.ndjson).toContain(`\"receipt\":{\"id\":\"${receipt.id}\",\"display_name\":\"昼食\"}`);
    await useCases.confirmExternalBackup(
      archiveYear.year,
      {
        exportId: archive.archiveExport.id,
        contentSha256: archive.archiveExport.contentSha256 ?? "",
        externalStorageNote: "external"
      },
      actor
    );

    await expect(useCases.updateEntry(entry.id, { memo: "変更", expectedRevision: entry.revision })).rejects.toThrow(/変更できません/);
    await expect(useCases.deleteEntry(entry.id)).rejects.toThrow(/変更できません/);
    await expect(useCases.updateReceipt(receipt.id, { displayName: "変更" }, actor)).rejects.toThrow(/変更できません/);
    await expect(useCases.deleteReceipt(receipt.id)).rejects.toThrow(/変更できません/);
    await expect(useCases.createReceipt({ entryIds: ungroupedEntries.map((row) => row.id) }, actor)).rejects.toThrow(/変更できません/);
    await expect(
      useCases.createManualEntry(
        {
          entryType: "expense",
          entryDate: "2023-07-01",
          amount: 500,
          subjectUserId: actor.id,
          categoryId: category.id,
          tagIds: [],
          target: "追加"
        },
        actor
      )
    ).rejects.toThrow(/変更できません/);
  });

  it("revalidates archive stats immediately before purge", async () => {
    const { repos, useCases } = createUseCases();
    const category = await useCases.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
    await useCases.createManualEntry(
      {
        entryType: "expense",
        entryDate: "2023-06-20",
        amount: 1280,
        subjectUserId: actor.id,
        categoryId: category.id,
        tagIds: [],
        target: "昼食"
      },
      actor
    );
    const archiveYear = await useCases.prepareArchive(2027, actor);
    const archive = await useCases.buildArchive(archiveYear.year, actor);
    await useCases.confirmExternalBackup(
      archiveYear.year,
      {
        exportId: archive.archiveExport.id,
        contentSha256: archive.archiveExport.contentSha256 ?? "",
        externalStorageNote: "external"
      },
      actor
    );
    await repos.entries.create(
      {
        id: "ent_late",
        revision: crypto.randomUUID(),
        entryType: "expense",
        entryDate: "2023-12-01",
        amount: 1,
        currency: "JPY",
        subjectUserId: actor.id,
        categoryId: category.id,
        target: "late",
        memo: null,
        entrySourceId: null,
        entrySourceItemId: null,
        receiptId: null,
        dedupeKey: null,
        fixedAt: new Date().toISOString(),
        archivedAt: null,
        archiveYearId: null
      },
      []
    );

    await expect(useCases.purgeArchive(archiveYear.year, actor)).rejects.toThrow(/current data differs/);
  });
});
