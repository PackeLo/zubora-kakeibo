import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import App from "../../app/front/src/App.vue";

afterEach(() => vi.unstubAllGlobals());

describe("signed-in user initialization", () => {
  it("opens a posted entry for editing and saves it with PATCH instead of creating another entry", async () => {
    const category = { id: "cat_food", code: "food", name: "食費", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true };
    const me = { id: "usr_me", displayName: "本人", role: "admin" };
    let entry = { id: "ent_saved", revision: "original", entryType: "expense", entryDate: "2026-10-24", amount: 100, currency: "JPY",
      subjectUserId: me.id, categoryId: category.id, category, tags: [], target: null, memo: null };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const path = String(input).split("?")[0];
      if (path === "/api/me") return Response.json(me);
      if (path === "/api/users") return Response.json({ items: [me] });
      if (path === "/api/taxonomy") return Response.json({ categories: [category], incomeCategories: [], tags: [] });
      if (path === "/api/summaries/daily") return Response.json({ days: [] });
      if (path === "/api/entries/ent_saved") {
        if (init?.method === "PATCH") entry = { ...entry, ...JSON.parse(String(init.body)), revision: "updated" };
        return Response.json(entry);
      }
      if (path === "/api/entries") return Response.json({ items: [entry] });
      return Response.json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const wrapper = mount(App);
    await flushPromises();
    await wrapper.findAll("nav button").find((button) => button.text() === "支出・収入")!.trigger("click");
    await flushPromises();
    await wrapper.get('[aria-label="明細を編集"]').trigger("click");
    await flushPromises();
    expect(wrapper.get(".entry-editor").text()).toContain("明細を編集");
    await wrapper.get('.entry-editor [name="amount"]').setValue(120);
    await wrapper.get(".entry-editor").trigger("submit");
    await flushPromises();
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH" || init?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("/api/entries/ent_saved");
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({ expectedRevision: "original", amount: 120 });
    expect(wrapper.text()).toContain("明細の変更を保存した。");
    expect(wrapper.get(".entry-editor").text()).toContain("手入力");
    wrapper.unmount();
  });

  it("uses the actual user for manual entries and asset ownership", async () => {
    const me = { id: "usr_access_real_user", displayName: "family@example.test", role: "admin" };
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = String(input).split("?")[0];
      if (path === "/api/me") return Response.json(me);
      if (path === "/api/users") return Response.json({ items: [me] });
      if (path === "/api/taxonomy") return Response.json({ categories: [], incomeCategories: [], tags: [] });
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
});
