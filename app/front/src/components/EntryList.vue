<script setup lang="ts">
import { computed } from "vue";
import type { Entry } from "../api/client";
import { formatMoney } from "../utils/display";
import PersonName from "./PersonName.vue";
const props = defineProps<{ entries: Entry[]; busy?: boolean; canDelete?: boolean; selectedIds?: string[] }>();
const emit = defineEmits<{ details: [id: string]; edit: [id: string]; remove: [id: string]; "update:selectedIds": [ids: string[]] }>();
// selectedIds を渡したときだけ、レシートにまとめるための選択列を出す。
const selectable = computed(() => props.selectedIds !== undefined);
const canGroup = (entry: Entry) => entry.entryType === "expense" && !entry.receiptId;
function toggle(id: string, checked: boolean) {
  const current = props.selectedIds ?? [];
  emit("update:selectedIds", checked ? [...current, id] : current.filter((selected) => selected !== id));
}
</script>
<template>
  <p v-if="entries.length === 0" class="empty-state">この条件の明細はないよ。</p>
  <table v-else class="entry-table">
    <thead><tr><th v-if="selectable">選択</th><th>日付</th><th>種別</th><th>カテゴリ</th><th>用途</th><th>タグ</th><th>金額</th><th>登録者</th><th v-if="selectable">レシート</th><th>操作</th></tr></thead>
    <tbody>
      <tr v-for="entry in entries" :key="entry.id">
        <td v-if="selectable" data-label="選択">
          <input class="row-checkbox" type="checkbox" :checked="selectedIds!.includes(entry.id)" :disabled="busy || !canGroup(entry)"
            :aria-label="`${entry.target || entry.entryDate}をレシートにまとめる`" @change="toggle(entry.id, ($event.target as HTMLInputElement).checked)" />
        </td>
        <td data-label="日付"><time>{{ entry.entryDate }}</time></td>
        <td data-label="種別">{{ entry.entryType === "expense" ? "支出" : "収入" }}</td>
        <td data-label="カテゴリ">{{ entry.category?.name ?? "未分類" }}</td>
        <td data-label="用途" class="entry-target">{{ entry.target || "なし" }}</td>
        <td data-label="タグ" class="entry-tags">
          <ul v-if="entry.tags.length" class="entry-tag-list" aria-label="タグ">
            <li v-for="tag in entry.tags" :key="tag.id" class="entry-tag">{{ tag.name }}</li>
          </ul>
          <span v-else class="muted">なし</span>
        </td>
        <td data-label="金額" class="entry-amount">{{ formatMoney(entry.amount, entry.currency) }}</td>
        <td data-label="登録者"><PersonName :name="entry.registeredBy?.displayName ?? '不明'" /></td>
        <td v-if="selectable" data-label="レシート">{{ entry.receiptId ? "所属済み" : "なし" }}</td>
        <td class="entry-actions">
          <button type="button" aria-label="明細の詳細" :disabled="busy" @click="$emit('details', entry.id)">詳細</button>
          <button type="button" aria-label="明細を編集" :disabled="busy" @click="$emit('edit', entry.id)">編集</button>
          <button v-if="canDelete" type="button" class="danger" aria-label="明細を削除" :disabled="busy" @click="$emit('remove', entry.id)">削除</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>
