<script setup lang="ts">
import type { Entry } from "../api/client";
import { formatMoney } from "../utils/display";
import PersonName from "./PersonName.vue";
defineProps<{ entries: Entry[]; busy?: boolean; canDelete?: boolean }>();
defineEmits<{ details: [id: string]; edit: [id: string]; remove: [id: string] }>();
</script>
<template>
  <p v-if="entries.length === 0" class="empty-state">この条件の明細はないよ。</p>
  <table v-else class="entry-table">
    <thead><tr><th>日付</th><th>種別</th><th>カテゴリ</th><th>用途</th><th>タグ</th><th>金額</th><th>登録者</th><th>操作</th></tr></thead>
    <tbody>
      <tr v-for="entry in entries" :key="entry.id">
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
        <td class="entry-actions">
          <button type="button" aria-label="明細の詳細" :disabled="busy" @click="$emit('details', entry.id)">詳細</button>
          <button type="button" aria-label="明細を編集" :disabled="busy" @click="$emit('edit', entry.id)">編集</button>
          <button v-if="canDelete" type="button" class="danger" aria-label="明細を削除" :disabled="busy" @click="$emit('remove', entry.id)">削除</button>
        </td>
      </tr>
    </tbody>
  </table>
</template>
