import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import EntryDetails from "../../app/front/src/components/EntryDetails.vue";
import EntryList from "../../app/front/src/components/EntryList.vue";
import type { Entry } from "../../app/front/src/api/client";

const entry: Entry = { id: "ent_detail", revision: "private-revision", entryType: "expense", entryDate: "2026-10-24", amount: 1234,
  currency: "JPY", subjectUserId: "user_hiro", categoryId: null, tags: [{ id: "tag", name: "スーパー", isActive: true }],
  target: "週末の買い物", memo: "1行目\n<img src=x onerror=alert(1)>\n" + "長文".repeat(100),
  registeredBy: { email: "yuka@example.test", displayName: "ゆうか" } };

describe("entry details and responsive list", () => {
  it("shows full notes as text with separate registrant and subject names and no internal identifiers", async () => {
    const wrapper = mount(EntryDetails, { props: { entry, users: [{ id: "user_hiro", displayName: "ひろゆき", role: "member" }] } });
    expect(wrapper.get('[data-testid="entry-memo"]').element.textContent).toBe(entry.memo);
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.text()).toContain("ゆうか");
    expect(wrapper.text()).toContain("ひろゆき");
    expect(wrapper.text()).not.toContain(entry.id);
    expect(wrapper.text()).not.toContain(entry.revision);
    await wrapper.findAll("button").find(button => button.text() === "この明細を編集")!.trigger("click");
    expect(wrapper.emitted("edit")).toHaveLength(1);
    wrapper.unmount();
  });

  it("marks omitted notes and tags as absent", () => {
    const wrapper = mount(EntryDetails, { props: { entry: { ...entry, memo: null, target: null, tags: [] }, users: [] } });
    expect(wrapper.get('[data-testid="entry-memo"]').text()).toBe("なし");
    expect(wrapper.text()).toContain("不明");
    wrapper.unmount();
  });

  it("keeps the formal name available while rendering three characters for compact layouts", async () => {
    const wrapper = mount(EntryList, { props: { entries: [{ ...entry, registeredBy: { email: "hiro@example.test", displayName: "ひろゆき" } }] } });
    expect(wrapper.get(".person-full").text()).toBe("ひろゆき");
    expect(wrapper.get(".person-compact").text()).toBe("ひろゆ");
    expect(wrapper.get(".person-compact").attributes("aria-hidden")).toBe("true");
    await wrapper.get('[aria-label="明細の詳細"]').trigger("click");
    expect(wrapper.emitted("details")).toEqual([[entry.id]]);
    wrapper.unmount();
  });
});
