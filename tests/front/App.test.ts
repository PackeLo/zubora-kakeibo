import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import App from "../../app/front/src/App.vue";

afterEach(() => vi.unstubAllGlobals());

describe("signed-in user initialization", () => {
  it("uses the actual user for manual entries and asset ownership", async () => {
    const me = { id: "usr_access_real_user", displayName: "family@example.test", role: "admin" };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = String(input).split("?")[0];
      if (path === "/api/me") return Response.json(me);
      if (path === "/api/users") return Response.json({ items: [me] });
      if (path === "/api/taxonomy") return Response.json({ categories: [], incomeCategories: [], tags: [] });
      if (path === "/api/receipts") return Response.json({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0, filteredReceiptTotals: [] });
      if (path === "/api/summaries/daily") return Response.json({ days: [] });
      return Response.json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.findAll("nav button").find((button) => button.text() === "支出・収入")!.trigger("click");
    expect(wrapper.get('[name="manualSubjectUserId"]').element).toHaveProperty("value", me.id);
    expect(wrapper.get('[name="manualSubjectUserId"]').text()).toContain(me.displayName);
    await wrapper.findAll("nav button").find((button) => button.text() === "金融資産")!.trigger("click");
    expect(wrapper.get('[name="assetOwnerUserId"]').element).toHaveProperty("value", me.id);
    expect(wrapper.get('[name="assetOwnerUserId"]').text()).toContain(me.displayName);
    wrapper.unmount();
  });


  it("shows a receipt total with entries from different categories", async () => {
    const me = { id: "usr_access_real_user", displayName: "family@example.test", role: "admin" };
    const categories = [
      { id: "cat_food", code: "food", name: "食費", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true },
      { id: "cat_daily", code: "daily", name: "日用品", kind: "expense", sortOrder: 1, dedupeEnabled: true, isActive: true }
    ];
    const entries = [
      { id: "ent_bread", entryType: "expense", subjectUserId: me.id, entryDate: "2026-10-28", amount: 300, currency: "JPY", categoryId: "cat_food", target: "食パン", memo: null, receiptId: "rct_bakery", category: categories[0], tags: [] },
      { id: "ent_bag", entryType: "expense", subjectUserId: me.id, entryDate: "2026-10-28", amount: 200, currency: "JPY", categoryId: "cat_daily", target: "紙袋", memo: null, receiptId: "rct_bakery", category: categories[1], tags: [] }
    ];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = String(input).split("?")[0];
      if (path === "/api/me") return Response.json(me);
      if (path === "/api/users") return Response.json({ items: [me] });
      if (path === "/api/taxonomy") return Response.json({ categories, incomeCategories: [], tags: [] });
      if (path === "/api/entries") return Response.json({ items: entries });
      if (path === "/api/receipts") return Response.json({
        items: [{ id: "rct_bakery", entrySourceId: "es_bakery", displayName: "まちのパン屋", fromDate: "2026-10-28", toDate: "2026-10-28", entryCount: 2, totals: [{ currency: "JPY", amount: 500 }], entries }],
        page: 1,
        pageSize: 20,
        totalItems: 1,
        totalPages: 1,
        filteredReceiptTotals: [{ currency: "JPY", amount: 500 }]
      });
      if (path === "/api/summaries/daily") return Response.json({ days: [] });
      return Response.json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("confirm", vi.fn(() => true));
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.findAll("nav button").find((button) => button.text() === "レシート")!.trigger("click");
    expect(wrapper.text()).toContain("支出レシート");
    expect(wrapper.get<HTMLInputElement>('input[aria-label="レシート名"]').element.value).toBe("まちのパン屋");
    expect(wrapper.text()).toContain("食パン");
    expect(wrapper.text()).toContain("紙袋");
    expect(wrapper.text()).toContain("￥500");
    expect(wrapper.text()).toContain("食費");
    expect(wrapper.text()).toContain("日用品");
    await wrapper.findAll("button").find((button) => button.text() === "まとまりを解除")!.trigger("click");
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/receipts/rct_bakery", expect.objectContaining({ method: "DELETE" }));
    wrapper.unmount();
  });

  it("groups two ungrouped expense entries from the entries tab", async () => {
    const me = { id: "usr_access_real_user", displayName: "family@example.test", role: "admin" };
    const category = { id: "cat_food", code: "food", name: "食費", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true };
    const entries = [
      { id: "ent_1", entryType: "expense", subjectUserId: me.id, entryDate: "2026-10-28", amount: 300, currency: "JPY", categoryId: category.id, target: "食パン", memo: null, receiptId: null, category, tags: [] },
      { id: "ent_2", entryType: "expense", subjectUserId: me.id, entryDate: "2026-10-28", amount: 200, currency: "JPY", categoryId: category.id, target: "菓子パン", memo: null, receiptId: null, category, tags: [] }
    ];
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = String(input).split("?")[0];
      if (path === "/api/receipts" && init?.method === "POST") return Response.json({ id: "rct_created" }, { status: 201 });
      if (path === "/api/me") return Response.json(me);
      if (path === "/api/users") return Response.json({ items: [me] });
      if (path === "/api/taxonomy") return Response.json({ categories: [category], incomeCategories: [], tags: [] });
      if (path === "/api/entries") return Response.json({ items: entries });
      if (path === "/api/receipts") return Response.json({ items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0, filteredReceiptTotals: [] });
      if (path === "/api/summaries/daily") return Response.json({ days: [] });
      return Response.json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.findAll("nav button").find((button) => button.text() === "支出・収入")!.trigger("click");
    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"].row-checkbox');
    await checkboxes[0].setValue(true);
    await checkboxes[1].setValue(true);
    await wrapper.get<HTMLInputElement>(".receipt-group-form input").setValue("パン屋");
    await wrapper.get(".receipt-group-form").trigger("submit");
    await flushPromises();
    const postCall = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/receipts" && init?.method === "POST");
    expect(postCall).toBeTruthy();
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({ entryIds: ["ent_1", "ent_2"], displayName: "パン屋" });
    wrapper.unmount();
  });
});
