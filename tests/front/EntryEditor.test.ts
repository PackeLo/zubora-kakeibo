import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import EntryEditor from "../../app/front/src/components/EntryEditor.vue";
import type { Category, Entry, Tag } from "../../app/front/src/api/client";

const category: Category = { id: "cat_food", code: "food", name: "食費", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true };
const tag: Tag = { id: "tag_family", name: "家族", isActive: true };
const entry: Entry = { id: "ent_edit", revision: "original", entryType: "expense", entryDate: "2026-10-24", amount: 100,
  currency: "JPY", subjectUserId: "usr_me", categoryId: category.id, category, tags: [tag], target: "お弁当", memo: "メモ" };
const wrappers: VueWrapper[] = [];
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
function editor(value: Entry | null = entry) {
  const wrapper = mount(EntryEditor, { props: { entry: value, categories: [category], tags: [tag], users: [{ id: "usr_me", displayName: "本人", role: "admin" }], defaultSubjectUserId: "usr_me" } });
  wrappers.push(wrapper);
  return wrapper;
}
beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...entry, revision: "updated" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { wrappers.splice(0).forEach((wrapper) => wrapper.unmount()); vi.unstubAllGlobals(); });

describe("posted entry editor", () => {
  it("saves only corrections to the same entry with its original revision", async () => {
    const wrapper = editor();
    expect(wrapper.text()).toContain("明細を編集");
    await wrapper.get('[name="amount"]').setValue(150);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/entries/ent_edit");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ expectedRevision: "original", amount: 150 });
    expect(wrapper.emitted("saved")).toHaveLength(1);
  });

  it("keeps user corrections and shows conflicts without silently retrying", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: "別の編集が保存されたよ。再取得してね。" }, { status: 409 }));
    const wrapper = editor();
    await wrapper.get('[name="amount"]').setValue(222);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain("再取得");
    expect(wrapper.get('[name="amount"]').element).toHaveProperty("value", "222");
    expect(wrapper.emitted("saved")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("cancels without saving or mutating the entry", async () => {
    const wrapper = editor();
    await wrapper.get('[name="memo"]').setValue("変更途中");
    await wrapper.get('button[type="button"]').trigger("click");
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(entry.memo).toBe("メモ");
  });

  it("preserves selected inactive categories and tags while editing other values", async () => {
    const wrapper = editor({ ...entry, category: { ...category, isActive: false }, tags: [{ ...tag, isActive: false }] });
    await wrapper.setProps({ categories: [{ ...category, isActive: false }], tags: [{ ...tag, isActive: false }] });
    expect(wrapper.get('[name="categoryId"]').text()).toContain("食費（無効）");
    expect(wrapper.get('[name="tagIds"]').text()).toContain("家族（無効）");
    await wrapper.get('[name="amount"]').setValue(155);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ expectedRevision: "original", amount: 155 });
  });

  it("explains required fields and sends a new entry only in creation mode", async () => {
    const wrapper = editor(null);
    expect(wrapper.text()).toContain("金額は1以上");
    expect(wrapper.text()).toContain("支出のカテゴリ");
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[name="amount"]').setValue(300);
    await wrapper.get('[name="categoryId"]').setValue(category.id);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/entries");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ amount: 300, subjectUserId: "usr_me", currency: "JPY" });
    expect(wrapper.find('button[type="button"]').exists()).toBe(false);
  });

  it("clears an incompatible category and only submits once during a request", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const wrapper = editor();
    await wrapper.get('[name="entryType"]').setValue("income");
    expect(wrapper.get('[name="categoryId"]').element).toHaveProperty("value", "");
    await wrapper.get("form").trigger("submit");
    await wrapper.get("form").trigger("submit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(Response.json(entry));
    await flushPromises();
  });
});
