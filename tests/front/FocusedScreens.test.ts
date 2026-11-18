import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import App from "../../app/front/src/App.vue";
import { createAppRouter } from "../../app/front/src/router";

afterEach(() => vi.unstubAllGlobals());

const me = { id: "yuka", email: "yuka@example.test", displayName: "ゆうか", role: "admin" };
const food = { id: "food", code: "food", name: "食費", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true };
const tagFamily = { id: "tag_family", name: "家族", isActive: true };
const entryFood = { id: "ent_food", revision: "r1", entryType: "expense", entryDate: "2024-02-10", amount: 1000, currency: "JPY", categoryId: "food", category: food, tags: [], subjectUserId: "yuka", target: "食材", memo: "メモ1" };
const sourceItem = { id: "esi_lunch", entrySourceId: "es_lunch", entryType: "expense", subjectUserId: "yuka", entryDate: "2024-02-10", amount: 800, currency: "JPY", target: "お弁当", categoryIdGuess: "food", categoryNameGuess: "食費", tagsJson: JSON.stringify(["家族"]), memo: null, confidence: 0.9, status: "pending" };

function buildFetch() {
  let entries = [{ ...entryFood }];
  let sourceItems = [{ ...sourceItem }];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), "https://ui.example.test");
    const path = url.pathname;
    const method = init?.method ?? "GET";
    if (path === "/api/me") return Response.json(me);
    if (path === "/api/users") return Response.json({ items: [me], profiles: [me] });
    if (path === "/api/taxonomy") return Response.json({ categories: [food], incomeCategories: [], tags: [tagFamily] });
    if (path === "/api/entries" && method === "GET") return Response.json({ items: entries });
    if (path === "/api/entries" && method === "POST") {
      const created = { id: "ent_created", revision: "r1", tags: [], category: food, ...JSON.parse(String(init?.body)) };
      entries = [created, ...entries];
      return Response.json(created, { status: 201 });
    }
    const entryMatch = path.match(/^\/api\/entries\/(.+)$/);
    if (entryMatch && method === "GET") {
      const found = entries.find((entry) => entry.id === entryMatch[1]);
      return found ? Response.json(found) : Response.json({ error: "NOT_FOUND" }, { status: 404 });
    }
    if (path === "/api/entry-source-items" && method === "GET") return Response.json({ items: sourceItems });
    const postMatch = path.match(/^\/api\/entry-source-items\/(.+)\/post$/);
    if (postMatch && method === "POST") {
      sourceItems = sourceItems.filter((item) => item.id !== postMatch[1]);
      return Response.json({ id: "ent_posted" }, { status: 201 });
    }
    const itemMatch = path.match(/^\/api\/entry-source-items\/(.+)$/);
    if (itemMatch && method === "PATCH") return Response.json({ id: itemMatch[1] });
    if (itemMatch && method === "DELETE") {
      sourceItems = sourceItems.filter((item) => item.id !== itemMatch[1]);
      return Response.json({});
    }
    if (path === "/api/receipts") return Response.json({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0, filteredReceiptTotals: [] });
    if (path === "/api/summaries/category") return Response.json({ items: [] });
    if (path === "/api/summaries/daily") return Response.json({ days: [] });
    if (path === "/api/summaries/monthly") return Response.json({ months: [] });
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

function writes(fetchMock: ReturnType<typeof buildFetch>, method: string, path: string) {
  return fetchMock.mock.calls.filter(([input, init]) => String(input).split("?")[0] === path && (init?.method ?? "GET") === method);
}

function buttonByText(wrapper: Awaited<ReturnType<typeof mountAt>>["wrapper"], text: string) {
  return wrapper.findAll("button").find((button) => button.text() === text)!;
}

describe("entry-new screen", () => {
  it("entries list has no manual entry form; 新規登録 opens /entries/new as the entry-new route", async () => {
    const { wrapper, router } = await mountAt("/entries");
    expect(router.currentRoute.value.path).toBe("/entries");
    expect(wrapper.find(".entry-editor").exists()).toBe(false);
    expect(wrapper.find('[name="manualSubjectUserId"]').exists()).toBe(false);
    await buttonByText(wrapper, "新規登録").trigger("click");
    await flushPromises();
    // /entries/new は /entries/:id ではなく静的セグメントの entry-new として解決される。
    expect(router.currentRoute.value.name).toBe("entry-new");
    expect(router.currentRoute.value.path).toBe("/entries/new");
    expect(wrapper.find(".entry-editor").exists()).toBe(true);
    wrapper.unmount();
  });

  it("submitting on /entries/new posts the entry and returns to the list", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/entries");
    await buttonByText(wrapper, "新規登録").trigger("click");
    await flushPromises();
    await wrapper.get('.entry-editor [name="amount"]').setValue(1500);
    await wrapper.get('.entry-editor [name="categoryId"]').setValue("food");
    await wrapper.get('.entry-editor [name="target"]').setValue("昼食");
    await wrapper.get(".entry-editor").trigger("submit");
    await flushPromises();
    const posts = writes(fetchMock, "POST", "/api/entries");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ amount: 1500, categoryId: "food", target: "昼食" });
    expect(router.currentRoute.value.path).toBe("/entries");
    expect(wrapper.text()).toContain("登録した。");
    expect(wrapper.text()).toContain("昼食");
    expect(wrapper.find(".entry-editor").exists()).toBe(false);
    wrapper.unmount();
  });

  it("一覧に戻る on /entries/new returns without saving", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/entries/new");
    expect(router.currentRoute.value.name).toBe("entry-new");
    await buttonByText(wrapper, "一覧に戻る").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/entries");
    expect(writes(fetchMock, "POST", "/api/entries")).toHaveLength(0);
    wrapper.unmount();
  });
});

describe("source item register screen", () => {
  it("source-items list shows summaries with 登録/削除 buttons and no form fields", async () => {
    const { wrapper, router } = await mountAt("/source-items");
    expect(router.currentRoute.value.path).toBe("/source-items");
    const row = wrapper.get('[data-testid="source-item-row"]');
    expect(row.text()).toContain("2024-02-10");
    expect(row.text()).toContain("お弁当");
    expect(row.text()).toContain("推定カテゴリ: 食費");
    expect(row.text()).toContain("信頼度: 90%");
    expect(wrapper.find(".source-review").exists()).toBe(false);
    expect(wrapper.find('[name="amount"]').exists()).toBe(false);
    expect(wrapper.find('[name="entryDate"]').exists()).toBe(false);
    expect(buttonByText(wrapper, "登録")).toBeTruthy();
    expect(buttonByText(wrapper, "削除")).toBeTruthy();
    wrapper.unmount();
  });

  it("登録 opens the register screen and posting returns to the list", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/source-items");
    await buttonByText(wrapper, "登録").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("source-item-register");
    expect(router.currentRoute.value.path).toBe("/source-items/esi_lunch/register");
    expect(wrapper.find(".source-review").exists()).toBe(true);
    await wrapper.get(".source-review").trigger("submit");
    await flushPromises();
    expect(writes(fetchMock, "POST", "/api/entry-source-items/esi_lunch/post")).toHaveLength(1);
    expect(router.currentRoute.value.path).toBe("/source-items");
    expect(wrapper.find('[data-testid="source-item-row"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("確認待ちの明細はないよ。");
    wrapper.unmount();
  });

  it("draft save on the register screen stays on the screen", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/source-items/esi_lunch/register");
    expect(router.currentRoute.value.name).toBe("source-item-register");
    await buttonByText(wrapper, "下書き保存").trigger("click");
    await flushPromises();
    expect(writes(fetchMock, "PATCH", "/api/entry-source-items/esi_lunch")).toHaveLength(1);
    expect(writes(fetchMock, "POST", "/api/entry-source-items/esi_lunch/post")).toHaveLength(0);
    expect(router.currentRoute.value.path).toBe("/source-items/esi_lunch/register");
    expect(wrapper.find(".source-review").exists()).toBe(true);
    expect(wrapper.text()).toContain("下書きを保存した。");
    wrapper.unmount();
  });

  it("削除 on the register screen deletes and returns to the list", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/source-items");
    await buttonByText(wrapper, "登録").trigger("click");
    await flushPromises();
    // SourceItemReview 内の削除ボタン（サマリー行の削除と区別するためフォーム内から探す）。
    const removeButton = wrapper.findAll(".source-review button").find((button) => button.text() === "削除")!;
    await removeButton.trigger("click");
    await flushPromises();
    expect(writes(fetchMock, "DELETE", "/api/entry-source-items/esi_lunch")).toHaveLength(1);
    expect(router.currentRoute.value.path).toBe("/source-items");
    wrapper.unmount();
  });

  it("削除 on the list deletes the item in place", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/source-items");
    await buttonByText(wrapper, "削除").trigger("click");
    await flushPromises();
    expect(writes(fetchMock, "DELETE", "/api/entry-source-items/esi_lunch")).toHaveLength(1);
    expect(router.currentRoute.value.path).toBe("/source-items");
    expect(wrapper.find('[data-testid="source-item-row"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("an unknown source item id shows the not-found panel", async () => {
    const { wrapper, router } = await mountAt("/source-items/esi_missing/register");
    expect(router.currentRoute.value.path).toBe("/source-items/esi_missing/register");
    expect(wrapper.find('[data-testid="source-item-not-found"]').exists()).toBe(true);
    expect(wrapper.find(".source-review").exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("focused chrome", () => {
  it.each([
    "/entries/ent_food",
    "/entries/ent_food/edit",
    "/entries/new",
    "/assets/new",
    "/source-items/esi_lunch/register"
  ])("focused screen %s hides the sidebar nav and the search panel", async (path) => {
    const { wrapper } = await mountAt(path);
    expect(wrapper.find(".sidebar").exists()).toBe(false);
    expect(wrapper.find("nav").exists()).toBe(false);
    expect(wrapper.find('[data-testid="search-panel"]').exists()).toBe(false);
    expect(wrapper.get(".app-shell").classes()).toContain("focused");
    wrapper.unmount();
  });

  it("list screens keep the sidebar nav and the search panel", async () => {
    const { wrapper } = await mountAt("/entries");
    expect(wrapper.find(".sidebar").exists()).toBe(true);
    expect(wrapper.find("nav").exists()).toBe(true);
    expect(wrapper.find('[data-testid="search-panel"]').exists()).toBe(true);
    expect(wrapper.get(".app-shell").classes()).not.toContain("focused");
    wrapper.unmount();
  });

  it("dashboard keeps the sidebar nav and the search panel", async () => {
    const { wrapper } = await mountAt("/dashboard");
    expect(wrapper.find("nav").exists()).toBe(true);
    expect(wrapper.find('[data-testid="search-panel"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
