import { describe, expect, it } from "vitest";
import { InMemoryUnitOfWork } from "@back/adapters/memory/InMemoryRepositories";
import { KakeiboUseCases } from "@back/application/useCases";
import { actorFromSitesIdentity } from "@back/adapters/auth/sites-token";
import type { Actor } from "@back/domain/types";

const yuka: Actor = { id: "yuka", displayName: "yuka@example.test", role: "admin" };
const hiro: Actor = { id: "hiro", displayName: "hiro@example.test", role: "member" };
const names = { "yuka@example.test": "ゆうか", "hiro@example.test": "ひろゆき" };

describe("household display names and registration filters", () => {
  it("projects names without changing the canonical identity used by Sites authentication", async () => {
    const repos = new InMemoryUnitOfWork();
    const app = new KakeiboUseCases(repos, { liveCompletedYearsToKeep: 3, displayNames: names });
    expect(await app.currentUser(yuka)).toMatchObject({ id: yuka.id, email: yuka.displayName, displayName: "ゆうか" });
    expect(await repos.users.findById(yuka.id)).toMatchObject({ displayName: yuka.displayName });
    const actor = await actorFromSitesIdentity({ kind: "sites", subject: "site-scope", email: yuka.displayName, issuer: "https://site.example", expiresAt: 9999999999 }, { HOUSEHOLD_EMAILS: yuka.displayName, ADMIN_EMAILS: yuka.displayName, DB: {} as D1Database, LIVE_COMPLETED_YEARS_TO_KEEP: "3", ALLOW_DEV_AUTH: "false" }, repos);
    expect(actor.id).toBe(yuka.id);
    expect(actor.displayName).toBe(yuka.displayName);
    expect(JSON.stringify(await app.listUsers())).not.toContain("passwordHash");
  });

  it("filters by the registrant independently of the expense subject in entries and every summary", async () => {
    const repos = new InMemoryUnitOfWork();
    const app = new KakeiboUseCases(repos, { liveCompletedYearsToKeep: 3, displayNames: names });
    await app.currentUser(yuka); await app.currentUser(hiro);
    const category = await app.createCategory({ code: "food", name: "食費", kind: "expense" }, yuka);
    const base = { entryType: "expense" as const, entryDate: "2026-10-24", subjectUserId: hiro.id, categoryId: category.id };
    const first = await app.createManualEntry({ ...base, amount: 100 }, yuka);
    await app.createManualEntry({ ...base, amount: 200 }, hiro);
    const filters = { from: "2026-10-01", to: "2026-10-31", subjectUserIds: [hiro.id], registeredByEmails: [yuka.displayName] };
    expect(await app.listEntries(filters)).toMatchObject([{ id: first.id, amount: 100, registeredBy: { displayName: "ゆうか" }, subjectUserId: hiro.id }]);
    expect(await app.dailySummary(filters)).toMatchObject([{ expenseTotal: 100 }]);
    expect(await app.monthlySummary(filters)).toMatchObject([{ expenseTotal: 100 }]);
    expect(await app.categorySummary(filters)).toMatchObject([{ amount: 100 }]);
    expect(await app.householdOverview(filters)).toMatchObject({ expenseTotal: 100 });
    expect(await app.listEntries({ ...filters, subjectUserIds: [yuka.id] })).toEqual([]);
  });

  it("orders assets by type and then by name after changes", async () => {
    const app = new KakeiboUseCases(new InMemoryUnitOfWork(), { liveCompletedYearsToKeep: 3 });
    const stock = await app.createFinancialAsset({ name: "Z株", assetType: "stock" }, yuka);
    await app.createFinancialAsset({ name: "B預金", assetType: "bank_deposit" }, yuka);
    await app.createFinancialAsset({ name: "A預金", assetType: "bank_deposit" }, yuka);
    expect((await app.listFinancialAssets()).map(asset => asset.name)).toEqual(["A預金", "B預金", "Z株"]);
    await app.updateFinancialAsset(stock.id, { assetType: "bank_deposit", name: "C預金" }, yuka);
    expect((await app.listFinancialAssets()).map(asset => asset.name)).toEqual(["A預金", "B預金", "C預金"]);
  });
});
