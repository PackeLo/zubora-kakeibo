<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { apiPatch, apiPost, type Category, type EntrySourceItem, type PostSourceItemInput, type Tag, type User } from "../api/client";

const props = defineProps<{
  item: EntrySourceItem;
  categories: Category[];
  tags: Tag[];
  users: User[];
  defaultSubjectUserId: string;
}>();
const emit = defineEmits<{ changed: []; remove: [] }>();
const busy = ref(false);
const error = ref("");
const notice = ref("");
const discardUnmatchedTags = ref(false);
const form = reactive({
  entryType: "expense" as "expense" | "income",
  entryDate: "",
  amount: "" as number | string,
  currency: "JPY",
  subjectUserId: "",
  categoryId: "",
  tagIds: [] as string[],
  target: "",
  memo: ""
});

const activeTags = computed(() => props.tags.filter((tag) => tag.isActive));
const categoriesForType = computed(() => props.categories.filter((category) => category.isActive && category.kind === form.entryType));
const suggestedTagNames = computed<string[] | null>(() => {
  if (!props.item.tagsJson) return [];
  try {
    const names: unknown = JSON.parse(props.item.tagsJson);
    return Array.isArray(names) && names.every((name) => typeof name === "string") ? names : null;
  } catch {
    return null;
  }
});
const unmatchedTags = computed(() => (suggestedTagNames.value ?? []).filter((name) => !activeTags.value.some((tag) => tag.name === name)));
const hasUnresolvedTags = computed(() => suggestedTagNames.value === null || unmatchedTags.value.length > 0);
const canPost = computed(() => {
  return Boolean(form.entryDate && form.subjectUserId && form.currency.trim())
    && props.users.some((user) => user.id === form.subjectUserId)
    && Number.isSafeInteger(Number(form.amount)) && Number(form.amount) > 0
    && (form.entryType !== "expense" || Boolean(form.categoryId))
    && (!form.categoryId || categoriesForType.value.some((category) => category.id === form.categoryId))
    && (!hasUnresolvedTags.value || discardUnmatchedTags.value);
});

watch(() => props.item, (item) => {
  Object.assign(form, {
    entryType: item.entryType,
    entryDate: item.entryDate ?? "",
    amount: item.amount ?? "",
    currency: item.currency,
    subjectUserId: item.subjectUserId ?? props.defaultSubjectUserId,
    categoryId: item.categoryIdGuess ?? "",
    tagIds: activeTags.value.filter((tag) => suggestedTagNames.value?.includes(tag.name)).map((tag) => tag.id),
    target: item.target ?? "",
    memo: item.memo ?? ""
  });
  discardUnmatchedTags.value = false;
}, { immediate: true });

watch(() => form.entryType, () => {
  if (!categoriesForType.value.some((category) => category.id === form.categoryId)) form.categoryId = "";
});

async function save(mode: "draft" | "post") {
  if (busy.value || mode === "post" && !canPost.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    const values = {
      entryType: form.entryType,
      entryDate: form.entryDate || null,
      amount: form.amount === "" ? null : Number(form.amount),
      currency: form.currency,
      subjectUserId: form.subjectUserId || null,
      target: form.target || null,
      memo: form.memo || null
    };
    if (mode === "draft") {
      const tagNames = activeTags.value.filter((tag) => form.tagIds.includes(tag.id)).map((tag) => tag.name);
      if (!discardUnmatchedTags.value) tagNames.push(...unmatchedTags.value);
      if (suggestedTagNames.value === null && !discardUnmatchedTags.value) {
        throw new Error("推定タグの形式を確認して、不要なら「未解決の推定タグを外す」を選んでね。");
      }
      await apiPatch(`/api/entry-source-items/${props.item.id}`, {
        ...values,
        categoryIdGuess: form.categoryId || null,
        categoryNameGuess: categoriesForType.value.find((category) => category.id === form.categoryId)?.name ?? null,
        tagsJson: JSON.stringify([...new Set(tagNames)])
      });
      notice.value = "下書きを保存した。";
    } else {
      const input: PostSourceItemInput = {
        ...values,
        entryDate: form.entryDate,
        amount: Number(form.amount),
        subjectUserId: form.subjectUserId,
        categoryId: form.categoryId || null,
        tagIds: [...form.tagIds]
      };
      await apiPost(`/api/entry-source-items/${props.item.id}/post`, input);
    }
    emit("changed");
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="source-review" @submit.prevent="save('post')">
    <p class="source-suggestion">
      推定カテゴリ: {{ item.categoryNameGuess ?? "未分類" }} ・ 信頼度: {{ item.confidence == null ? "不明" : `${Math.round(item.confidence * 100)}%` }}
    </p>
    <fieldset :disabled="busy">
      <div class="review-fields">
        <label>種別<select v-model="form.entryType" name="entryType"><option value="expense">支出</option><option value="income">収入</option></select></label>
        <label>日付<input v-model="form.entryDate" name="entryDate" type="date" /></label>
        <label>金額<input v-model="form.amount" name="amount" type="number" min="1" step="1" /></label>
        <label>通貨<input v-model="form.currency" name="currency" required /></label>
        <label>対象者<select v-model="form.subjectUserId" name="subjectUserId"><option value="">選んでね</option><option v-for="user in users" :key="user.id" :value="user.id">{{ user.displayName }}</option></select></label>
        <label>カテゴリ<select v-model="form.categoryId" name="categoryId"><option value="">未分類</option><option v-for="category in categoriesForType" :key="category.id" :value="category.id">{{ category.name }}</option></select></label>
        <label>タグ<select v-model="form.tagIds" name="tagIds" multiple><option v-for="tag in activeTags" :key="tag.id" :value="tag.id">{{ tag.name }}</option></select></label>
        <label>用途<input v-model="form.target" name="target" /></label>
        <label class="review-memo">メモ<textarea v-model="form.memo" name="memo"></textarea></label>
      </div>
      <div v-if="hasUnresolvedTags" class="review-warning" role="alert">
        <p>{{ suggestedTagNames === null ? "推定タグの形式が不正だよ。" : `未登録・無効な推定タグ: ${unmatchedTags.join('、')}。必要なタグはカテゴリ・タグ画面で登録してから戻ってね。` }}</p>
        <label><input v-model="discardUnmatchedTags" type="checkbox" name="discardUnmatchedTags" />未解決の推定タグを外す</label>
      </div>
      <p v-if="!canPost" class="source-suggestion">日付・正の整数の金額・対象者・支出カテゴリ・タグを確認してね。</p>
      <div class="actions">
        <button type="button" @click="save('draft')">下書き保存</button>
        <button type="submit" class="primary" :disabled="!canPost">確認して確定</button>
        <button type="button" class="danger" @click="emit('remove')">削除</button>
      </div>
    </fieldset>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
  </form>
</template>

<style scoped>
.source-review { border-top: 1px solid #e2e8f0; padding: 14px 0; }
fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
.review-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 12px; }
label { display: grid; gap: 4px; font-size: 14px; }
.review-memo { grid-column: 1 / -1; }
.source-suggestion { color: #64748b; font-size: 13px; }
.review-warning { background: #fffbeb; color: #92400e; padding: 10px; margin-bottom: 12px; border-radius: 6px; }
.review-warning label { display: flex; align-items: center; }
input[type="checkbox"] { width: auto; }
button:disabled { cursor: not-allowed; opacity: 0.5; }
.actions { flex-wrap: wrap; }
</style>
