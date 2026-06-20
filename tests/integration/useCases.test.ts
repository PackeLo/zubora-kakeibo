import { describe, expect, it } from "vitest";
import { InMemoryUnitOfWork } from "@back/adapters/memory/InMemoryRepositories";
import { KakeiboUseCases } from "@back/application/useCases";
import type { Actor } from "@back/domain/types";

const actor: Actor = { id: "usr_local", displayName: "local@example.test", role: "admin" };

function createUseCases() {
  const repos = new InMemoryUnitOfWork();
  const useCases = new KakeiboUseCases(repos, { liveCompletedYearsToKeep: 3 });
  return { repos, useCases };
}

describe("kakeibo use cases", () => {
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
    const result = await useCases.createActionEntrySource(
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

    await expect(useCases.updateEntry(entry.id, { memo: "変更" })).rejects.toThrow(/変更できません/);
    await expect(useCases.deleteEntry(entry.id)).rejects.toThrow(/変更できません/);
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
