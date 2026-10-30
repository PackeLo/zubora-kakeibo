<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { apiPatch, apiPost, type Category, type Entry, type Tag, type User } from "../api/client";

const props = defineProps<{
  entry: Entry | null;
  categories: Category[];
  tags: Tag[];
  users: User[];
  defaultSubjectUserId: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ saved: [entry: Entry]; cancel: []; busy: [value: boolean] }>();
const busy = ref(false);
const error = ref("");
const form = reactive({ entryType: "expense" as "expense" | "income", entryDate: "", amount: "" as string | number,
  currency: "JPY", subjectUserId: "", categoryId: "", tagIds: [] as string[], target: "", memo: "" });
const categoriesForType = computed(() => props.categories.filter((category) => category.kind === form.entryType &&
  (category.isActive || category.id === props.entry?.categoryId)));
const availableTags = computed(() => {
  const selected = props.entry?.tags ?? [];
  return [...new Map([...props.tags.filter((tag) => tag.isActive), ...selected].map((tag) => [tag.id, tag])).values()];
});
const missing = computed(() => {
  const messages: string[] = [];
  const date = new Date(form.entryDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.entryDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== form.entryDate) messages.push("日付を入力してね。");
  if (!Number.isSafeInteger(Number(form.amount)) || Number(form.amount) <= 0) messages.push("金額は1以上の整数で入力してね。");
  if (!form.currency.trim()) messages.push("通貨を入力してね。");
  if (!form.subjectUserId) messages.push("対象者を選んでね。");
  if (form.entryType === "expense" && !form.categoryId) messages.push("支出のカテゴリを選んでね。");
  if (form.categoryId && !categoriesForType.value.some((category) => category.id === form.categoryId)) messages.push("種別に合うカテゴリを選んでね。");
  return messages;
});

function reset() {
  const entry = props.entry;
  Object.assign(form, { entryType: entry?.entryType ?? "expense", entryDate: entry?.entryDate ?? new Date().toISOString().slice(0, 10),
    amount: entry?.amount ?? "", currency: entry?.currency ?? "JPY", subjectUserId: entry?.subjectUserId ?? props.defaultSubjectUserId,
    categoryId: entry?.categoryId ?? "", tagIds: entry?.tags.map((tag) => tag.id) ?? [], target: entry?.target ?? "", memo: entry?.memo ?? "" });
  error.value = "";
}
watch(() => props.entry, reset, { immediate: true });
watch(() => props.defaultSubjectUserId, (id) => { if (!props.entry && !form.subjectUserId) form.subjectUserId = id; });
watch(() => form.entryType, () => {
  if (!categoriesForType.value.some((category) => category.id === form.categoryId)) form.categoryId = "";
});

async function save() {
  if (busy.value || props.disabled || missing.value.length) return;
  busy.value = true;
  emit("busy", true);
  error.value = "";
  try {
    const values = { ...form, amount: Number(form.amount), currency: form.currency.trim(), categoryId: form.categoryId || null,
      tagIds: [...form.tagIds], target: form.target || null, memo: form.memo || null };
    let saved: Entry;
    if (props.entry) {
      const previous = { ...props.entry, tagIds: props.entry.tags.map((tag) => tag.id) };
      const patch = Object.fromEntries(Object.entries(values).filter(([key, value]) =>
        JSON.stringify(value) !== JSON.stringify(previous[key as keyof typeof previous])));
      saved = await apiPatch<Entry>(`/api/entries/${props.entry.id}`, { ...patch, expectedRevision: props.entry.revision });
    } else {
      saved = await apiPost<Entry>("/api/entries", values);
    }
    if (!props.entry) reset();
    emit("saved", saved);
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
    emit("busy", false);
  }
}
</script>

<template>
  <form class="panel form entry-editor" novalidate @submit.prevent="save">
    <h2>{{ entry ? "明細を編集" : "手入力" }}</h2>
    <p v-if="entry">登録済みの明細を変更するよ。</p>
    <fieldset :disabled="busy || disabled">
      <label>種別<select v-model="form.entryType" name="entryType"><option value="expense">支出</option><option value="income">収入</option></select></label>
      <label>日付（必須）<input v-model="form.entryDate" name="entryDate" type="date" required /></label>
      <label>金額（必須）<input v-model="form.amount" name="amount" type="number" min="1" step="1" required /></label>
      <label>通貨（必須）<input v-model="form.currency" name="currency" required /></label>
      <label>対象者（必須）<select v-model="form.subjectUserId" name="manualSubjectUserId" aria-label="対象者" required>
        <option value="">対象者を選んでね</option>
        <option v-for="user in users" :key="user.id" :value="user.id">{{ user.displayName }}</option>
        <option v-if="entry?.subjectUserId && !users.some(user => user.id === entry?.subjectUserId)" :value="entry.subjectUserId">現在の対象者（{{ entry.subjectUserId }}）</option>
      </select></label>
      <label>{{ form.entryType === "expense" ? "カテゴリ（必須）" : "カテゴリ" }}<select v-model="form.categoryId" name="categoryId" :required="form.entryType === 'expense'">
        <option value="">カテゴリなし</option>
        <option v-for="category in categoriesForType" :key="category.id" :value="category.id">{{ category.name }}{{ category.isActive ? "" : "（無効）" }}</option>
      </select></label>
      <label>タグ<select v-model="form.tagIds" name="tagIds" multiple>
        <option v-for="tag in availableTags" :key="tag.id" :value="tag.id">{{ tag.name }}{{ tag.isActive ? "" : "（無効）" }}</option>
      </select></label>
      <label>用途<input v-model="form.target" name="target" /></label>
      <label>メモ<textarea v-model="form.memo" name="memo"></textarea></label>
      <ul v-if="missing.length" class="validation" aria-live="polite"><li v-for="message in missing" :key="message">{{ message }}</li></ul>
      <div class="actions">
        <button type="submit" class="primary" :disabled="missing.length > 0">{{ busy ? "保存中…" : entry ? "変更を保存" : "登録する" }}</button>
        <button v-if="entry" type="button" @click="emit('cancel')">キャンセル</button>
      </div>
    </fieldset>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
fieldset { display: grid; gap: 12px; padding: 0; border: 0; margin: 0; min-width: 0; }
label { display: grid; gap: 4px; font-size: 14px; }
.validation { padding-left: 20px; color: #92400e; font-size: 13px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
