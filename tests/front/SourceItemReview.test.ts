import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import SourceItemReview from "../../app/front/src/components/SourceItemReview.vue";
import type { Category, EntrySourceItem, Tag, User } from "../../app/front/src/api/client";

const categories: Category[] = [
  { id: "cat_food", code: "food", name: "食費", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true },
  { id: "cat_daily", code: "daily", name: "日用品", kind: "expense", sortOrder: 1, dedupeEnabled: true, isActive: true },
  { id: "cat_salary", code: "salary", name: "給与", kind: "income", sortOrder: 0, dedupeEnabled: false, isActive: true }
];
const tags: Tag[] = [{ id: "tag_family", name: "家族", isActive: true }];
const users: User[] = [{ id: "usr_signed_in", displayName: "user@example.test", role: "admin" }];
const item: EntrySourceItem = {
  id: "esi_receipt", entrySourceId: "es_receipt", entryType: "expense", subjectUserId: null,
  entryDate: "2026-10-23", amount: 1000, currency: "JPY", target: "お弁当", categoryIdGuess: "cat_daily",
  categoryNameGuess: "日用品", tagsJson: JSON.stringify(["家族"]), memo: null, confidence: 0.8, status: "pending"
};
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
const wrappers: VueWrapper[] = [];

function mountReview(patch: Partial<EntrySourceItem> = {}) {
  const wrapper = mount(SourceItemReview, { props: { item: { ...item, ...patch }, categories, tags, users, defaultSubjectUserId: users[0].id } });
  wrappers.push(wrapper);
  return wrapper;
}

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  vi.unstubAllGlobals();
});

describe("source item review", () => {
  it("posts a corrected category and amount with the suggested tag and signed-in user", async () => {
    const wrapper = mountReview();
    await wrapper.get('[name="categoryId"]').setValue("cat_food");
    await wrapper.get('[name="amount"]').setValue(1200);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/entry-source-items/esi_receipt/post");
    expect(JSON.parse(String(init?.body))).toMatchObject({ categoryId: "cat_food", amount: 1200, tagIds: ["tag_family"], subjectUserId: "usr_signed_in" });
    expect(wrapper.emitted("changed")).toHaveLength(1);
  });

  it("allows missing date, amount and category to be completed before posting", async () => {
    const wrapper = mountReview({ entryDate: null, amount: null, categoryIdGuess: null });
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    await wrapper.get('[name="entryDate"]').setValue("2026-10-24");
    await wrapper.get('[name="amount"]').setValue(500);
    await wrapper.get('[name="categoryId"]').setValue("cat_food");
    expect(wrapper.get('button[type="submit"]').attributes("disabled")).toBeUndefined();
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ entryDate: "2026-10-24", amount: 500, categoryId: "cat_food" });
  });

  it("saves an incomplete draft and retains unmatched suggested tags", async () => {
    const wrapper = mountReview({ entryDate: null, tagsJson: JSON.stringify(["家族", "旅行"]) });
    await wrapper.get('[name="categoryId"]').setValue("cat_food");
    await wrapper.get('button[type="button"]').trigger("click");
    await flushPromises();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/entry-source-items/esi_receipt");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toMatchObject({ entryDate: null, categoryIdGuess: "cat_food", categoryNameGuess: "食費", tagsJson: JSON.stringify(["家族", "旅行"]) });
  });

  it("requires an explicit choice before dropping unknown tags", async () => {
    const wrapper = mountReview({ tagsJson: JSON.stringify(["家族", "未登録"]) });
    expect(wrapper.text()).toContain("未登録・無効な推定タグ: 未登録");
    await wrapper.get("form").trigger("submit");
    expect(fetchMock).not.toHaveBeenCalled();
    await wrapper.get('[name="discardUnmatchedTags"]').setValue(true);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ tagIds: ["tag_family"] });
  });

  it("shows malformed tag data instead of silently discarding it", async () => {
    const wrapper = mountReview({ tagsJson: "bad-json" });
    expect(wrapper.text()).toContain("推定タグの形式が不正");
    await wrapper.get('button[type="button"]').trigger("click");
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(2);
  });

  it("preserves corrections and reports API failures", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: "保存できなかった" }, { status: 500 }));
    const wrapper = mountReview();
    await wrapper.get('[name="amount"]').setValue(1400);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[name="amount"]').element).toHaveProperty("value", "1400");
    expect(wrapper.get('[role="alert"]').text()).toBe("保存できなかった");
    expect(wrapper.emitted("changed")).toBeUndefined();
    expect(wrapper.get("fieldset").attributes("disabled")).toBeUndefined();
  });

  it("clears an incompatible category when entry type changes", async () => {
    const wrapper = mountReview();
    await wrapper.get('[name="entryType"]').setValue("income");
    expect(wrapper.get('[name="categoryId"]').element).toHaveProperty("value", "");
    const options = wrapper.get('[name="categoryId"]').text();
    expect(options).toContain("給与");
    expect(options).not.toContain("日用品");
  });

  it("does not submit twice while a request is pending", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const wrapper = mountReview();
    await wrapper.get("form").trigger("submit");
    await wrapper.get("form").trigger("submit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    finish(Response.json({}));
    await flushPromises();
  });
});
