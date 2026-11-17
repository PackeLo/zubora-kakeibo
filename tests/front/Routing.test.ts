import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import App from "../../app/front/src/App.vue";
import { createAppRouter } from "../../app/front/src/router";

afterEach(() => vi.unstubAllGlobals());

const me = { id: "yuka", email: "yuka@example.test", displayName: "ゆうか", role: "admin" };
const food = { id: "food", code: "food", name: "食費", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true };
const fun = { id: "entertainment", code: "entertainment", name: "娯楽", kind: "expense", sortOrder: 1, dedupeEnabled: true, isActive: true };

function buildFetch() {
  let entries = [
    { id: "ent_food", revision: "r1", entryType: "expense", entryDate: "2024-02-10", amount: 1000, currency: "JPY", categoryId: food.id, category: food, tags: [], subjectUserId: "yuka", target: "食材", memo: "メモ1" },
    { id: "ent_movie", revision: "r1", entryType: "expense", entryDate: "2024-02-11", amount: 210, currency: "JPY", categoryId: fun.id, category: fun, tags: [], subjectUserId: "yuka", target: "映画", memo: "チケット" }
  ];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), "https://ui.example.test");
    if (url.pathname === "/api/me") return Response.json(me);
    if (url.pathname === "/api/users") return Response.json({ items: [me], profiles: [me] });
    if (url.pathname === "/api/taxonomy") return Response.json({ categories: [food, fun], incomeCategories: [], tags: [] });
    if (url.pathname === "/api/entries") return Response.json({ items: entries });
    const detailMatch = url.pathname.match(/^\/api\/entries\/(.+)$/);
    if (detailMatch) {
      const found = entries.find((entry) => entry.id === detailMatch[1]);
      if (!found) return Response.json({ error: "NOT_FOUND", message: "明細が見つかりません" }, { status: 404 });
      if (init?.method === "PATCH") {
        const updated = { ...found, ...JSON.parse(String(init.body)), revision: "r2" };
        entries = entries.map((entry) => (entry.id === updated.id ? updated : entry));
        return Response.json(updated);
      }
      return Response.json(found);
    }
    if (url.pathname === "/api/receipts") {
      const page = Number(url.searchParams.get("page") ?? "1");
      return Response.json({
        items: [{ id: `rct_${page}`, entrySourceId: null, displayName: `レシート${page}ページ目`, fromDate: "2024-02-10", toDate: "2024-02-10", entryCount: 1, totals: [{ currency: "JPY", amount: 100 }], entries: [] }],
        page, pageSize: 20, totalItems: 2, totalPages: 2, filteredReceiptTotals: [{ currency: "JPY", amount: 100 }]
      });
    }
    if (url.pathname === "/api/summaries/category") return Response.json({ items: [
      { categoryId: food.id, categoryName: food.name, amount: 1000, entryCount: 1, currency: "JPY" },
      { categoryId: fun.id, categoryName: fun.name, amount: 210, entryCount: 1, currency: "JPY" }
    ] });
    if (url.pathname === "/api/summaries/daily") return Response.json({ days: [{ date: "2024-02-10", incomeTotal: 0, expenseTotal: 1000, netCashflow: -1000, entryCount: 1, currency: "JPY" }] });
    if (url.pathname === "/api/summaries/monthly") return Response.json({ months: [] });
    return Response.json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function mountAt(path: string) {
  const fetchMock = buildFetch();
  const router = createAppRouter(createMemoryHistory());
  await router.push(path);
  const wrapper = mount(App, { global: { plugins: [router] } });
  await flushPromises();
  return { wrapper, router, fetchMock };
}

describe("routing navigation", () => {
  it("dashboard → category → details → edit → back×3 returns in reverse order", async () => {
    const { wrapper, router } = await mountAt("/dashboard?month=2024-02");
    expect(router.currentRoute.value.path).toBe("/dashboard");
    await wrapper.get('[aria-label="食費の明細を表示"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/dashboard/category/food");
    expect(wrapper.get(".dashboard-entries").text()).toContain("食材");
    await wrapper.get('.dashboard-entries [aria-label="明細の詳細"]').trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/entries/ent_food");
    expect(wrapper.find(".entry-details").exists()).toBe(true);
    await wrapper.findAll("button").find((button) => button.text() === "この明細を編集")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/entries/ent_food/edit");
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/entries/ent_food");
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/dashboard/category/food");
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/dashboard");
    wrapper.unmount();
  });

  it("save from details does not duplicate the details entry in history", async () => {
    const { wrapper, router } = await mountAt("/dashboard?month=2024-02");
    await wrapper.get('[aria-label="食費の明細を表示"]').trigger("click");
    await flushPromises();
    await wrapper.get('.dashboard-entries [aria-label="明細の詳細"]').trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text() === "この明細を編集")!.trigger("click");
    await flushPromises();
    await wrapper.get('.entry-editor [name="memo"]').setValue("更新したメモ");
    await wrapper.get(".entry-editor").trigger("submit");
    await flushPromises();
    // 保存後は詳細へ戻り、履歴に詳細が二重に積まれていないこと（もう1回戻るとカテゴリ明細）。
    expect(router.currentRoute.value.path).toBe("/entries/ent_food");
    expect(wrapper.get('[data-testid="entry-memo"]').text()).toBe("更新したメモ");
    router.back();
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/dashboard/category/food");
    wrapper.unmount();
  });

  it("direct landing on /entries/:id shows details and its back button goes to /entries", async () => {
    const { wrapper, router } = await mountAt("/entries/ent_food");
    expect(router.currentRoute.value.path).toBe("/entries/ent_food");
    expect(wrapper.find(".entry-details").exists()).toBe(true);
    expect(wrapper.text()).toContain("食材");
    await wrapper.findAll("button").find((button) => button.text() === "元の一覧に戻る")!.trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/entries");
    wrapper.unmount();
  });

  it("direct landing on /entries/:id/edit saves to details via replace", async () => {
    const { wrapper, router } = await mountAt("/entries/ent_food/edit");
    expect(wrapper.find(".entry-editor").exists()).toBe(true);
    await wrapper.get('.entry-editor [name="memo"]').setValue("直接着地の編集");
    await wrapper.get(".entry-editor").trigger("submit");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/entries/ent_food");
    expect(wrapper.get('[data-testid="entry-memo"]').text()).toBe("直接着地の編集");
    wrapper.unmount();
  });

  it("fresh mount at a category URL restores category and period (reload equivalent)", async () => {
    const { wrapper, router } = await mountAt("/dashboard/category/food?month=2024-02");
    expect(router.currentRoute.value.path).toBe("/dashboard/category/food");
    expect(wrapper.get(".dashboard-entries").text()).toContain("食費の明細");
    expect(wrapper.get(".dashboard-entries").text()).toContain("食材");
    expect((wrapper.get('[name="dashboardMonth"]').element as HTMLInputElement).value).toBe("2024-02");
    wrapper.unmount();
  });

  it("fresh mount at receipts page 2 restores the page (reload equivalent)", async () => {
    const { wrapper, router } = await mountAt("/receipts?page=2");
    expect(router.currentRoute.value.query.page).toBe("2");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="レシート名"]').element.value).toBe("レシート2ページ目");
    expect(wrapper.text()).toContain("2 / 2");
    wrapper.unmount();
  });

  it("invalid entry id shows an error state instead of crashing or redirecting", async () => {
    const { wrapper, router } = await mountAt("/entries/ent_missing");
    expect(router.currentRoute.value.path).toBe("/entries/ent_missing");
    expect(wrapper.find('[data-testid="entry-not-found"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("unknown path shows the not-found state instead of redirecting to dashboard", async () => {
    const { wrapper, router } = await mountAt("/no-such-screen");
    expect(router.currentRoute.value.path).toBe("/no-such-screen");
    expect(wrapper.find('[data-testid="not-found"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("invalid month query is normalized without crashing", async () => {
    const { wrapper, router } = await mountAt("/dashboard?month=2024-13");
    await flushPromises();
    expect(router.currentRoute.value.query.month).toBeUndefined();
    expect(wrapper.find('[name="dashboardMonth"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
