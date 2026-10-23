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
