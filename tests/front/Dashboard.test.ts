import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import App from "../../app/front/src/App.vue";

afterEach(() => vi.unstubAllGlobals());

async function dashboard(exclusionData = false) {
  const day = `${new Date().toISOString().slice(0, 7)}-10`;
  const people = [{ id: "yuka", email: "yuka@example.test", displayName: "ゆうか", role: "admin" }, { id: "hiro", email: "hiro@example.test", displayName: "ひろゆき", role: "member" }];
  const category = { id: "entertainment", code: "entertainment", name: "娯楽", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true };
  const advance = { ...category, id: "advance", name: "立替金" };
  const food = { ...category, id: "food", name: "食費" };
  const excludedTag = { id: "refund", name: "精算対象", isActive: true };
  let entry = { id: "ent_movie", revision: "first", entryType: "expense", entryDate: day, amount: exclusionData ? 2000 : 210, currency: "JPY", categoryId: category.id, category, tags: [],
    subjectUserId: "yuka", registeredBy: { email: people[1].email, displayName: people[1].displayName }, target: "映画", memo: "チケット\nポップコーン" };
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), "https://ui.example.test");
    const rows = exclusionData ? [entry, { ...entry, id: "ent_food", amount: 3000, categoryId: food.id, category: food }, { ...entry, id: "ent_advance", amount: 5000, categoryId: advance.id, category: advance, tags: [excludedTag] }] : [entry];
    const visible = rows.filter(row => !url.searchParams.get("excludedCategoryIds")?.split(",").includes(row.categoryId) && !row.tags.some(tag => url.searchParams.get("excludedTagIds")?.split(",").includes(tag.id)));
    const expense = visible.reduce((sum, row) => sum + row.amount, 0);
    if (url.pathname === "/api/me") return Response.json(people[0]);
    if (url.pathname === "/api/users") return Response.json({ items: people, profiles: people });
    if (url.pathname === "/api/taxonomy") return Response.json({ categories: exclusionData ? [category, food, advance] : [category], incomeCategories: [], tags: exclusionData ? [excludedTag] : [] });
    if (url.pathname === "/api/entries") return Response.json({ items: visible });
    if (url.pathname === "/api/entries/ent_movie") {
      if (init?.method === "PATCH") entry = { ...entry, ...JSON.parse(String(init.body)), revision: "second" };
      return Response.json(entry);
    }
    if (url.pathname === "/api/summaries/category") return Response.json({ items: visible.map(row => ({ categoryId: row.categoryId, categoryName: row.category.name, amount: row.amount, entryCount: 1, currency: "JPY" })) });
    if (url.pathname === "/api/summaries/daily") return Response.json({ days: [{ date: day, incomeTotal: 300, expenseTotal: expense, netCashflow: 300 - expense, entryCount: visible.length + 1, currency: "JPY" }] });
    if (url.pathname === "/api/summaries/monthly") return Response.json({ months: [{ month: day.slice(0, 7), incomeTotal: 300, expenseTotal: expense, netCashflow: 300 - expense }] });
    if (url.pathname === "/api/financial-assets") return Response.json({ items: [{ id: "a", name: "預金", assetType: "bank_deposit", ownerUserId: "yuka", valuationMinor: 1000, currency: "JPY" }, { id: "b", name: "海外株", assetType: "stock", ownerUserId: "hiro", valuationMinor: 12345, currency: "USD" }] });
    return Response.json({ items: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const wrapper = mount(App);
  await flushPromises();
  return { wrapper, fetchMock, people };
}

describe("mobile dashboard workflow", () => {
  it("recalculates the chart after category/tag exclusion, retains conditions through details and clears them", async () => {
    const { wrapper, fetchMock } = await dashboard(true);
    expect(wrapper.findAll(".pie circle[stroke-dasharray]").map(slice => slice.attributes("stroke-dasharray"))).toEqual(["20 80", "30 70", "50 50"]);
    await wrapper.get('[name="excludedCategories"][value="advance"]').setValue(true);
    await flushPromises();
    expect(wrapper.findAll(".pie circle[stroke-dasharray]").map(slice => slice.attributes("stroke-dasharray"))).toEqual(["40 60", "60 40"]);
    expect(wrapper.get(".search-panel summary").text()).toContain("除外カテゴリ: 立替金");
    expect(wrapper.get(".legend").text()).not.toContain("立替金");
    await wrapper.get('[name="excludedTags"][value="refund"]').setValue(true);
    await flushPromises();
    expect(wrapper.get(".search-panel summary").text()).toContain("除外タグ: 精算対象");
    for (const path of ["entries", "summaries/daily", "summaries/monthly", "summaries/category"]) {
      const request = fetchMock.mock.calls.filter(([url]) => String(url).startsWith(`/api/${path}?`)).at(-1)!;
      const query = new URL(String(request[0]), "https://ui.test").searchParams;
      expect(query.get("excludedCategoryIds")).toBe("advance");
      expect(query.get("excludedTagIds")).toBe("refund");
    }
    await wrapper.get('[aria-label="娯楽の明細を表示"]').trigger("click");
    await wrapper.get('.dashboard-entries [aria-label="明細の詳細"]').trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find(button => button.text() === "元の一覧に戻る")!.trigger("click");
    expect((wrapper.get('[name="excludedCategories"][value="advance"]').element as HTMLInputElement).checked).toBe(true);
    await wrapper.findAll("button").find(button => button.text() === "年別")!.trigger("click");
    await flushPromises();
    expect(wrapper.get(".search-panel summary").text()).toContain("除外カテゴリ: 立替金");
    await wrapper.findAll("button").find(button => button.text() === "除外条件を解除")!.trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".pie circle[stroke-dasharray]")).toHaveLength(3);
    expect(wrapper.get(".search-panel summary").text()).not.toContain("除外");
    wrapper.unmount();
  });

  it("shows an empty state when every category is excluded and removes the previous pie", async () => {
    const { wrapper } = await dashboard(true);
    for (const id of ["advance", "food", "entertainment"]) {
      await wrapper.get(`[name="excludedCategories"][value="${id}"]`).setValue(true);
      await flushPromises();
    }
    expect(wrapper.find(".pie").exists()).toBe(false);
    expect(wrapper.text()).toContain("条件に一致する明細がないよ。");
    expect(wrapper.text()).not.toContain("NaN");
    wrapper.unmount();
  });

  it("keeps search closed by default and sends names as the correct registration and subject identifiers", async () => {
    const { wrapper, fetchMock } = await dashboard();
    const search = wrapper.get('[data-testid="search-panel"]');
    expect(search.attributes("open")).toBeUndefined();
    expect(wrapper.get('[name="filterRegisteredBy"]').text()).toContain("ひろゆき");
    await wrapper.get('[name="filterRegisteredBy"]').setValue(["hiro@example.test"]);
    await flushPromises();
    await wrapper.get('[name="filterSubjects"]').setValue(["yuka"]);
    await flushPromises();
    const lastEntries = fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/entries?")).at(-1)!;
    const query = new URL(String(lastEntries[0]), "https://ui.test").searchParams;
    expect(query.get("registeredByEmails")).toBe("hiro@example.test");
    expect(query.get("subjectUserIds")).toBe("yuka");
    expect(search.text()).toContain("ひろゆき");
    expect(search.attributes("open")).toBeUndefined();
    expect(wrapper.find('[placeholder="対象ユーザーID,ID"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("moves between full-year and full-month views", async () => {
    const { wrapper, fetchMock } = await dashboard();
    await wrapper.findAll("button").find(button => button.text() === "年別")!.trigger("click");
    await flushPromises();
    await wrapper.get('[name="dashboardYear"]').setValue(2024);
    await flushPromises();
    expect(wrapper.findAll(".month-summary")).toHaveLength(12);
    let url = String(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/entries?")).at(-1)![0]);
    expect(url).toContain("from=2024-01-01");
    expect(url).toContain("to=2024-12-31");
    await wrapper.get('[aria-label="2024-02の月別を表示"]').trigger("click");
    await flushPromises();
    url = String(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/entries?")).at(-1)![0]);
    expect(url).toContain("from=2024-02-01");
    expect(url).toContain("to=2024-02-29");
    expect(wrapper.findAll(".calendar-day")).toHaveLength(29);
    wrapper.unmount();
  });

  it("opens category details, cancels and saves an edit, then returns to the same dashboard drilldown", async () => {
    const { wrapper, fetchMock } = await dashboard();
    await wrapper.get('[aria-label="娯楽の明細を表示"]').trigger("click");
    expect(wrapper.get(".dashboard-entries").text()).toContain("映画");
    await wrapper.get('.dashboard-entries [aria-label="明細の詳細"]').trigger("click");
    await flushPromises();
    expect(wrapper.get('[data-testid="entry-memo"]').element.textContent).toBe("チケット\nポップコーン");
    await wrapper.findAll("button").find(button => button.text() === "この明細を編集")!.trigger("click");
    await flushPromises();
    await wrapper.get('.entry-editor button[type="button"]').trigger("click");
    expect(wrapper.find(".entry-details").exists()).toBe(true);
    await wrapper.findAll("button").find(button => button.text() === "この明細を編集")!.trigger("click");
    await flushPromises();
    await wrapper.get('.entry-editor [name="memo"]').setValue("更新したメモ");
    await wrapper.get(".entry-editor").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[data-testid="entry-memo"]').text()).toBe("更新したメモ");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
    await wrapper.findAll("button").find(button => button.text() === "元の一覧に戻る")!.trigger("click");
    expect(wrapper.get(".dashboard-entries").text()).toContain("娯楽の明細");
    expect(wrapper.find('[name="dashboardMonth"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows asset totals only on the asset screen and keeps different currencies separate", async () => {
    const { wrapper } = await dashboard();
    expect(wrapper.find('[data-testid="asset-totals"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("資産現在値");
    await wrapper.findAll("nav button").find(button => button.text() === "金融資産")!.trigger("click");
    const totals = wrapper.get('[data-testid="asset-totals"]');
    expect(totals.text()).toContain("JPY");
    expect(totals.text()).toContain("USD");
    expect(totals.text()).toContain("123.45");
    expect(totals.find("details").exists()).toBe(false);
    expect(wrapper.get(".asset-table").text()).toContain("銀行預金");
    expect(wrapper.get(".asset-table").text()).toContain("株式");
    wrapper.unmount();
  });

  it("opens a calendar day's entries without changing the selected period", async () => {
    const { wrapper } = await dashboard();
    const month = wrapper.get('[name="dashboardMonth"]').element as HTMLInputElement;
    const selected = month.value;
    await wrapper.get(".calendar-day.filled").trigger("click");
    expect(wrapper.get(".dashboard-entries").text()).toContain("映画");
    expect((wrapper.get('[name="dashboardMonth"]').element as HTMLInputElement).value).toBe(selected);
    wrapper.unmount();
  });
});
