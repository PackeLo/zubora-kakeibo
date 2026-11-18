import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import App from "../../app/front/src/App.vue";
import { createAppRouter } from "../../app/front/src/router";

afterEach(() => vi.unstubAllGlobals());

const me = { id: "yuka", email: "yuka@example.test", displayName: "ゆうか", role: "admin" };
const food = { id: "food", code: "food", name: "食費", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true };
const salary = { id: "salary", code: "salary", name: "給与", kind: "income", sortOrder: 0, dedupeEnabled: true, isActive: true };
const tagConvenience = { id: "tag_convenience", name: "コンビニ", isActive: true };
const bankAsset = { id: "asset_bank", ownerUserId: "yuka", name: "普通預金", assetType: "bank_deposit", quantityText: "数量メモA", valuationMinor: 5000, currency: "JPY", valuationNote: "評価メモA", isActive: true };

function buildFetch() {
  let categories = [{ ...food }];
  let incomeCategories = [{ ...salary }];
  let tags = [{ ...tagConvenience }];
  let assets = [{ ...bankAsset }];
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input), "https://ui.example.test");
    const path = url.pathname;
    const method = init?.method ?? "GET";
    if (path === "/api/me") return Response.json(me);
    if (path === "/api/users") return Response.json({ items: [me], profiles: [me] });
    if (path === "/api/taxonomy" && method === "GET") return Response.json({ categories, incomeCategories, tags });
    if (path === "/api/categories" && method === "POST") {
      const created = { id: "cat_created", ...JSON.parse(String(init?.body)) };
      categories = [...categories, created];
      return Response.json(created, { status: 201 });
    }
    const categoryMatch = path.match(/^\/api\/categories\/(.+)$/);
    if (categoryMatch && method === "PATCH") {
      const patch = JSON.parse(String(init?.body));
      const apply = (list: typeof categories) => list.map((category) => (category.id === categoryMatch[1] ? { ...category, ...patch } : category));
      categories = apply(categories);
      incomeCategories = apply(incomeCategories);
      return Response.json({ id: categoryMatch[1], ...patch });
    }
    if (path === "/api/tags" && method === "POST") {
      const created = { id: "tag_created", ...JSON.parse(String(init?.body)) };
      tags = [...tags, created];
      return Response.json(created, { status: 201 });
    }
    const tagMatch = path.match(/^\/api\/tags\/(.+)$/);
    if (tagMatch && method === "PATCH") {
      const patch = JSON.parse(String(init?.body));
      tags = tags.map((tag) => (tag.id === tagMatch[1] ? { ...tag, ...patch } : tag));
      return Response.json({ id: tagMatch[1], ...patch });
    }
    if (path === "/api/financial-assets" && method === "GET") return Response.json({ items: assets });
    if (path === "/api/financial-assets" && method === "POST") {
      const created = { id: "asset_created", ...JSON.parse(String(init?.body)) };
      assets = [...assets, created];
      return Response.json(created, { status: 201 });
    }
    const assetMatch = path.match(/^\/api\/financial-assets\/(.+)$/);
    if (assetMatch && method === "PATCH") {
      const patch = JSON.parse(String(init?.body));
      assets = assets.map((asset) => (asset.id === assetMatch[1] ? { ...asset, ...patch } : asset));
      return Response.json({ id: assetMatch[1], ...patch });
    }
    if (path === "/api/entries") return Response.json({ items: [] });
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

describe("asset form screens", () => {
  it("assets list has no inline form; 新規登録 opens the form screen and キャンセル returns without saving", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/assets");
    expect(router.currentRoute.value.path).toBe("/assets");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find('[name="assetOwnerUserId"]').exists()).toBe(false);
    expect(wrapper.get(".asset-table").text()).toContain("普通預金");
    await buttonByText(wrapper, "新規登録").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/assets/new");
    expect(wrapper.find('[name="assetOwnerUserId"]').exists()).toBe(true);
    await buttonByText(wrapper, "キャンセル").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/assets");
    expect(writes(fetchMock, "POST", "/api/financial-assets")).toHaveLength(0);
    wrapper.unmount();
  });

  it("submitting the new asset form posts and returns to the list", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/assets/new");
    expect(router.currentRoute.value.path).toBe("/assets/new");
    await wrapper.get('input[placeholder="資産名"]').setValue("定期預金");
    await wrapper.get('input[placeholder="評価額"]').setValue(12000);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const posts = writes(fetchMock, "POST", "/api/financial-assets");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ name: "定期預金", valuationMinor: 12000, ownerUserId: "yuka" });
    expect(router.currentRoute.value.path).toBe("/assets");
    expect(wrapper.get(".asset-table").text()).toContain("定期預金");
    wrapper.unmount();
  });

  it("direct landing on an asset edit URL shows the form prefilled and patches on submit", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/assets/asset_bank/edit");
    expect(router.currentRoute.value.path).toBe("/assets/asset_bank/edit");
    expect((wrapper.get('input[placeholder="資産名"]').element as HTMLInputElement).value).toBe("普通預金");
    expect((wrapper.get('input[placeholder="数量メモ"]').element as HTMLInputElement).value).toBe("数量メモA");
    expect((wrapper.get('input[placeholder="評価額"]').element as HTMLInputElement).value).toBe("5000");
    await wrapper.get('input[placeholder="資産名"]').setValue("普通預金（改）");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const patches = writes(fetchMock, "PATCH", "/api/financial-assets/asset_bank");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0][1]?.body))).toMatchObject({ name: "普通預金（改）" });
    expect(router.currentRoute.value.path).toBe("/assets");
    expect(wrapper.get(".asset-table").text()).toContain("普通預金（改）");
    wrapper.unmount();
  });

  it("an unknown asset id shows the not-found panel", async () => {
    const { wrapper, router } = await mountAt("/assets/asset_missing/edit");
    expect(router.currentRoute.value.path).toBe("/assets/asset_missing/edit");
    expect(wrapper.find('[data-testid="asset-not-found"]').exists()).toBe(true);
    expect(wrapper.find("form").exists()).toBe(false);
    wrapper.unmount();
  });
});

describe("taxonomy form screens", () => {
  it("taxonomy list has no inline forms; add buttons open the form screens", async () => {
    const { wrapper, router } = await mountAt("/taxonomy");
    expect(router.currentRoute.value.path).toBe("/taxonomy");
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.find('input[placeholder="コード"]').exists()).toBe(false);
    await buttonByText(wrapper, "カテゴリを追加").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/taxonomy/category/new");
    await router.push("/taxonomy");
    await flushPromises();
    await buttonByText(wrapper, "タグを追加").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.path).toBe("/taxonomy/tag/new");
    wrapper.unmount();
  });

  it("submitting the new category form posts and returns to the list", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/taxonomy/category/new");
    await wrapper.get('input[placeholder="コード"]').setValue("medical");
    await wrapper.get('input[placeholder="名前"]').setValue("医療費");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const posts = writes(fetchMock, "POST", "/api/categories");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ code: "medical", name: "医療費", kind: "expense" });
    expect(router.currentRoute.value.path).toBe("/taxonomy");
    expect(wrapper.text()).toContain("医療費");
    wrapper.unmount();
  });

  it("direct landing on a category edit URL patches on submit and returns", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/taxonomy/category/salary/edit");
    expect((wrapper.get('input[placeholder="名前"]').element as HTMLInputElement).value).toBe("給与");
    expect((wrapper.get('input[placeholder="コード"]').element as HTMLInputElement).value).toBe("salary");
    await wrapper.get('input[placeholder="名前"]').setValue("給与（改）");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const patches = writes(fetchMock, "PATCH", "/api/categories/salary");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0][1]?.body))).toMatchObject({ name: "給与（改）", kind: "income" });
    expect(router.currentRoute.value.path).toBe("/taxonomy");
    wrapper.unmount();
  });

  it("submitting the new tag form posts and returns to the list", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/taxonomy/tag/new");
    await wrapper.get('input[placeholder="名前"]').setValue("スーパー");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const posts = writes(fetchMock, "POST", "/api/tags");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1]?.body))).toMatchObject({ name: "スーパー", isActive: true });
    expect(router.currentRoute.value.path).toBe("/taxonomy");
    expect(wrapper.text()).toContain("スーパー");
    wrapper.unmount();
  });

  it("direct landing on a tag edit URL patches on submit and returns", async () => {
    const { wrapper, router, fetchMock } = await mountAt("/taxonomy/tag/tag_convenience/edit");
    expect((wrapper.get('input[placeholder="名前"]').element as HTMLInputElement).value).toBe("コンビニ");
    await wrapper.get('input[placeholder="名前"]').setValue("コンビニ（改）");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const patches = writes(fetchMock, "PATCH", "/api/tags/tag_convenience");
    expect(patches).toHaveLength(1);
    expect(JSON.parse(String(patches[0][1]?.body))).toMatchObject({ name: "コンビニ（改）" });
    expect(router.currentRoute.value.path).toBe("/taxonomy");
    wrapper.unmount();
  });

  it("an unknown category id shows the not-found panel", async () => {
    const { wrapper, router } = await mountAt("/taxonomy/category/cat_missing/edit");
    expect(router.currentRoute.value.path).toBe("/taxonomy/category/cat_missing/edit");
    expect(wrapper.find('[data-testid="category-not-found"]').exists()).toBe(true);
    expect(wrapper.find("form").exists()).toBe(false);
    wrapper.unmount();
  });

  it("an unknown tag id shows the not-found panel", async () => {
    const { wrapper, router } = await mountAt("/taxonomy/tag/tag_missing/edit");
    expect(router.currentRoute.value.path).toBe("/taxonomy/tag/tag_missing/edit");
    expect(wrapper.find('[data-testid="tag-not-found"]').exists()).toBe(true);
    expect(wrapper.find("form").exists()).toBe(false);
    wrapper.unmount();
  });
});
