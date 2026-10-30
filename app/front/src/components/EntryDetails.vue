<script setup lang="ts">
import { onMounted, ref } from "vue";
import type { Entry, User } from "../api/client";
import { formatMoney } from "../utils/display";
const props = defineProps<{ entry: Entry; users: User[]; busy?: boolean }>();
defineEmits<{ edit: []; back: [] }>();
const heading = ref<HTMLElement>();
onMounted(() => { heading.value?.focus({ preventScroll: true }); heading.value?.scrollIntoView?.({ block: "start" }); });
function subjectName() { return props.users.find((user) => user.id === props.entry.subjectUserId)?.displayName ?? "不明"; }
</script>
<template>
  <section class="panel entry-details">
    <div class="detail-header"><h2 ref="heading" tabindex="-1">明細の詳細</h2><button type="button" :disabled="busy" @click="$emit('back')">元の一覧に戻る</button></div>
    <p class="detail-amount">{{ formatMoney(entry.amount, entry.currency) }}</p>
    <dl class="detail-fields">
      <div><dt>日付</dt><dd>{{ entry.entryDate }}</dd></div>
      <div><dt>種別</dt><dd>{{ entry.entryType === "expense" ? "支出" : "収入" }}</dd></div>
      <div><dt>カテゴリ</dt><dd>{{ entry.category?.name ?? "未分類" }}</dd></div>
      <div><dt>タグ</dt><dd>{{ entry.tags.length ? entry.tags.map(tag => tag.name).join("、") : "なし" }}</dd></div>
      <div><dt>対象者</dt><dd>{{ subjectName() }}</dd></div>
      <div><dt>登録者</dt><dd>{{ entry.registeredBy?.displayName ?? "不明" }}</dd></div>
      <div class="detail-wide"><dt>用途</dt><dd>{{ entry.target || "なし" }}</dd></div>
      <div class="detail-wide"><dt>メモ</dt><dd class="detail-note" data-testid="entry-memo">{{ entry.memo || "なし" }}</dd></div>
    </dl>
    <button type="button" class="primary" :disabled="busy" @click="$emit('edit')">この明細を編集</button>
  </section>
</template>
