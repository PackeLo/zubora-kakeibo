<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  Archive,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Database,
  FolderInput,
  ListChecks,
  PieChart,
  Plus,
  RefreshCw,
  Save,
  Tag as TagIcon,
  Trash2
} from "lucide-vue-next";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  type Category,
  type CategorySummary,
  type DailySummary,
  type Entry,
  type EntrySourceItem,
  type FinancialAsset,
  type Tag
} from "./api/client";
import { createPieSlices, formatCurrency } from "./utils/chart";

type Tab = "dashboard" | "entries" | "source-items" | "duplicates" | "assets" | "taxonomy" | "archives";

const activeTab = ref<Tab>("dashboard");
const loading = ref(false);
const notice = ref("");
const error = ref("");

const taxonomy = reactive<{ categories: Category[]; incomeCategories: Category[]; tags: Tag[] }>({
  categories: [],
  incomeCategories: [],
  tags: []
});
const entries = ref<Entry[]>([]);
const sourceItems = ref<EntrySourceItem[]>([]);
const daily = ref<DailySummary[]>([]);
const categorySummary = ref<CategorySummary[]>([]);
const assets = ref<FinancialAsset[]>([]);
const archives = ref<any[]>([]);
const duplicateMap = reactive<Record<string, any[]>>({});

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
const filters = reactive({
  type: "expense" as "expense" | "income",
  from: monthStart,
  to: today,
  categoryIds: [] as string[],
  tagIds: [] as string[],
  subjectUserIdsText: ""
});

const entryForm = reactive({
  entryType: "expense" as "expense" | "income",
  entryDate: today,
  amount: 0,
  subjectUserId: "usr_local_example_test",
  categoryId: "",
  tagIds: [] as string[],
  target: "",
  memo: ""
});

const categoryForm = reactive({
  id: "",
  code: "",
  name: "",
  kind: "expense" as "expense" | "income",
  sortOrder: 0,
  dedupeEnabled: true,
  isActive: true
});

const tagForm = reactive({
  id: "",
  name: "",
  isActive: true
});

const assetForm = reactive({
  id: "",
  ownerUserId: "usr_local_example_test",
  name: "",
  assetType: "bank_deposit",
  quantityText: "",
  valuationMinor: 0,
  currency: "JPY",
  valuationNote: ""
});

const archiveConfirm = reactive({
  year: new Date().getFullYear() - 4,
  exportId: "",
  contentSha256: "",
  externalStorageNote: ""
});

const tabs: Array<{ key: Tab; label: string; icon: any }> = [
  { key: "dashboard", label: "ダッシュボード", icon: BarChart3 },
  { key: "entries", label: "支出・収入", icon: CircleDollarSign },
  { key: "source-items", label: "登録元明細", icon: FolderInput },
  { key: "duplicates", label: "重複確認", icon: ListChecks },
  { key: "assets", label: "金融資産", icon: Database },
  { key: "taxonomy", label: "カテゴリ・タグ", icon: TagIcon },
  { key: "archives", label: "アーカイブ", icon: Archive }
];

const allCategories = computed(() => [...taxonomy.categories, ...taxonomy.incomeCategories]);
const activeCategoriesForForm = computed(() => allCategories.value.filter((category) => category.kind === entryForm.entryType && category.isActive));
const pieSlices = computed(() => createPieSlices(categorySummary.value.map((item) => ({ label: item.categoryName, value: item.amount }))));
const incomeTotal = computed(() => daily.value.reduce((sum, day) => sum + day.incomeTotal, 0));
const expenseTotal = computed(() => daily.value.reduce((sum, day) => sum + day.expenseTotal, 0));
const assetTotal = computed(() => assets.value.reduce((sum, asset) => sum + (asset.valuationMinor ?? 0), 0));
const calendarDays = computed(() => {
  const map = new Map(daily.value.map((day) => [day.date, day]));
  const start = new Date(`${filters.from}T00:00:00Z`);
  const end = new Date(`${filters.to}T00:00:00Z`);
  const days: Array<{ date: string; summary?: DailySummary }> = [];
  for (let current = start; current <= end; current = new Date(current.getTime() + 86_400_000)) {
    const date = current.toISOString().slice(0, 10);
    days.push({ date, summary: map.get(date) });
    if (days.length > 370) break;
  }
  return days;
});

onMounted(() => {
  void refreshAll();
});

async function refreshAll() {
  await run(async () => {
    const [tx, entryRows, itemRows, days, categories, assetRows, archiveRows] = await Promise.all([
      apiGet<typeof taxonomy>("/api/taxonomy", { includeInactive: true }),
      apiGet<{ items: Entry[] }>("/api/entries", buildFilterQuery()),
      apiGet<{ items: EntrySourceItem[] }>("/api/entry-source-items", { status: "pending", type: filters.type }),
      apiGet<{ days: DailySummary[] }>("/api/summaries/daily", buildFilterQuery()),
      apiGet<{ items: CategorySummary[] }>("/api/summaries/category", buildFilterQuery()),
      apiGet<{ items: FinancialAsset[] }>("/api/financial-assets"),
      apiGet<{ items: any[] }>("/api/admin/archive-years").catch(() => ({ items: [] }))
    ]);
    taxonomy.categories = tx.categories;
    taxonomy.incomeCategories = tx.incomeCategories;
    taxonomy.tags = tx.tags;
    entries.value = entryRows.items;
    sourceItems.value = itemRows.items;
    daily.value = days.days;
    categorySummary.value = categories.items;
    assets.value = assetRows.items;
    archives.value = archiveRows.items;
  });
}

async function saveEntry() {
  await run(async () => {
    await apiPost<Entry>("/api/entries", {
      ...entryForm,
      amount: Number(entryForm.amount),
      categoryId: entryForm.categoryId || null,
      target: entryForm.target || null,
      memo: entryForm.memo || null
    });
    entryForm.amount = 0;
    entryForm.target = "";
    entryForm.memo = "";
    await refreshAll();
    notice.value = "登録した。";
  });
}

async function deleteEntry(id: string) {
  await run(async () => {
    await apiDelete(`/api/entries/${id}`);
    await refreshAll();
  });
}

async function postSourceItem(item: EntrySourceItem) {
  await run(async () => {
    await apiPost(`/api/entry-source-items/${item.id}/post`, {
      entryType: item.entryType,
      entryDate: item.entryDate,
      amount: item.amount,
      currency: item.currency,
      subjectUserId: item.subjectUserId || entryForm.subjectUserId,
      categoryId: item.categoryIdGuess,
      tagIds: [],
      target: item.target,
      memo: item.memo
    });
    await refreshAll();
  });
}

async function deleteSourceItem(id: string) {
  await run(async () => {
    await apiDelete(`/api/entry-source-items/${id}`);
    await refreshAll();
  });
}

async function loadDuplicateCandidates(itemId: string) {
  await run(async () => {
    const response = await apiGet<{ items: any[] }>(`/api/entry-source-items/${itemId}/duplicate-candidates`);
    duplicateMap[itemId] = response.items;
  });
}

async function markDuplicate(itemId: string) {
  await run(async () => {
    await apiPost(`/api/entry-source-items/${itemId}/mark-duplicate`);
    await refreshAll();
  });
}

async function markNotDuplicate(itemId: string, entryId: string) {
  await run(async () => {
    await apiPost(`/api/entry-source-items/${itemId}/mark-not-duplicate`, { entryId, reason: "UIで別物と判断" });
    await loadDuplicateCandidates(itemId);
  });
}

async function saveCategory() {
  await run(async () => {
    const body = { ...categoryForm, sortOrder: Number(categoryForm.sortOrder) };
    if (categoryForm.id) await apiPatch(`/api/categories/${categoryForm.id}`, body);
    else await apiPost("/api/categories", body);
    Object.assign(categoryForm, { id: "", code: "", name: "", kind: "expense", sortOrder: 0, dedupeEnabled: true, isActive: true });
    await refreshAll();
  });
}

function editCategory(category: Category) {
  Object.assign(categoryForm, category);
}

async function deleteCategory(id: string) {
  await run(async () => {
    const result = await apiDelete<{ mode: string; references: { entries: number; entrySourceItems: number } }>(`/api/categories/${id}`);
    notice.value = result.mode === "deleted" ? "カテゴリを削除した。" : `使用中のため無効化した。参照 ${result.references.entries + result.references.entrySourceItems} 件。`;
    await refreshAll();
  });
}

async function saveTag() {
  await run(async () => {
    if (tagForm.id) await apiPatch(`/api/tags/${tagForm.id}`, tagForm);
    else await apiPost("/api/tags", tagForm);
    Object.assign(tagForm, { id: "", name: "", isActive: true });
    await refreshAll();
  });
}

function editTag(tag: Tag) {
  Object.assign(tagForm, tag);
}

async function deleteTag(id: string) {
  await run(async () => {
    const result = await apiDelete<{ mode: string; references: { entries: number; entrySourceItems: number } }>(`/api/tags/${id}`);
    notice.value = result.mode === "deleted" ? "タグを削除した。" : `使用中のため無効化した。参照 ${result.references.entries + result.references.entrySourceItems} 件。`;
    await refreshAll();
  });
}

async function saveAsset() {
  await run(async () => {
    const body = {
      ...assetForm,
      valuationMinor: Number(assetForm.valuationMinor),
      quantityText: assetForm.quantityText || null,
      valuationNote: assetForm.valuationNote || null
    };
    if (assetForm.id) await apiPatch(`/api/financial-assets/${assetForm.id}`, body);
    else await apiPost("/api/financial-assets", body);
    Object.assign(assetForm, { id: "", name: "", assetType: "bank_deposit", quantityText: "", valuationMinor: 0, currency: "JPY", valuationNote: "" });
    await refreshAll();
  });
}

function editAsset(asset: FinancialAsset) {
  Object.assign(assetForm, {
    id: asset.id,
    ownerUserId: asset.ownerUserId ?? "usr_local_example_test",
    name: asset.name,
    assetType: asset.assetType,
    quantityText: asset.quantityText ?? "",
    valuationMinor: asset.valuationMinor ?? 0,
    currency: asset.currency,
    valuationNote: asset.valuationNote ?? ""
  });
}

async function deleteAsset(id: string) {
  await run(async () => {
    await apiDelete(`/api/financial-assets/${id}`);
    await refreshAll();
  });
}

async function prepareArchive() {
  await run(async () => {
    const year = new Date().getFullYear();
    await apiPost(`/api/admin/archive-years/prepare?currentYear=${year}`);
    await refreshAll();
  });
}

async function confirmArchive() {
  await run(async () => {
    await apiPost(`/api/admin/archive-years/${archiveConfirm.year}/confirm-external-backup`, archiveConfirm);
    await refreshAll();
  });
}

async function purgeArchive() {
  if (!window.confirm(`${archiveConfirm.year}年の本データをパージします。外部バックアップを確認済みの場合だけ続行してください。`)) return;
  await run(async () => {
    await apiPost(`/api/admin/archive-years/${archiveConfirm.year}/purge`);
    await refreshAll();
  });
}

function archiveDownloadUrl(year: number) {
  return `/api/admin/archive-years/${year}/download`;
}

function buildFilterQuery() {
  return {
    type: filters.type,
    from: filters.from,
    to: filters.to,
    categoryIds: filters.categoryIds,
    tagIds: filters.tagIds,
    subjectUserIds: filters.subjectUserIdsText
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

async function run(task: () => Promise<void>) {
  loading.value = true;
  error.value = "";
  notice.value = "";
  try {
    await task();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand">
        <CircleDollarSign :size="28" />
        <div>
          <strong>ズボラ家計簿</strong>
          <span>Family cashflow</span>
        </div>
      </div>
      <nav>
        <button v-for="tab in tabs" :key="tab.key" :class="{ active: activeTab === tab.key }" @click="activeTab = tab.key">
          <component :is="tab.icon" :size="18" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>
    </aside>

    <main class="main">
      <header class="topbar">
        <div class="filters">
          <select v-model="filters.type" @change="refreshAll">
            <option value="expense">支出</option>
            <option value="income">収入</option>
          </select>
          <input v-model="filters.from" type="date" @change="refreshAll" />
          <input v-model="filters.to" type="date" @change="refreshAll" />
          <select v-model="filters.categoryIds" multiple @change="refreshAll">
            <option v-for="category in allCategories" :key="category.id" :value="category.id">{{ category.name }}</option>
          </select>
          <select v-model="filters.tagIds" multiple @change="refreshAll">
            <option v-for="tag in taxonomy.tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
          </select>
          <input v-model="filters.subjectUserIdsText" placeholder="対象ユーザーID,ID" @change="refreshAll" />
        </div>
        <button class="icon-button" title="再読み込み" @click="refreshAll">
          <RefreshCw :size="18" />
        </button>
      </header>

      <p v-if="notice" class="notice">{{ notice }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="loading" class="loading">読み込み中。</p>

      <section v-if="activeTab === 'dashboard'" class="content-grid">
        <div class="metric">
          <span>収入</span>
          <strong>{{ formatCurrency(incomeTotal) }}</strong>
        </div>
        <div class="metric">
          <span>支出</span>
          <strong>{{ formatCurrency(expenseTotal) }}</strong>
        </div>
        <div class="metric">
          <span>差額</span>
          <strong>{{ formatCurrency(incomeTotal - expenseTotal) }}</strong>
        </div>
        <div class="metric">
          <span>資産現在値</span>
          <strong>{{ formatCurrency(assetTotal) }}</strong>
        </div>

        <section class="panel wide">
          <h2><CalendarDays :size="20" /> カレンダー</h2>
          <div class="calendar-grid">
            <div v-for="day in calendarDays" :key="day.date" class="calendar-day" :class="{ filled: day.summary }">
              <time>{{ day.date.slice(5) }}</time>
              <strong>{{ day.summary ? formatCurrency(day.summary.expenseTotal || day.summary.incomeTotal) : "" }}</strong>
              <small>{{ day.summary?.entryCount ?? "" }}</small>
            </div>
          </div>
        </section>

        <section class="panel">
          <h2><PieChart :size="20" /> カテゴリ</h2>
          <svg class="pie" viewBox="0 0 42 42" role="img">
            <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#e5e7eb" stroke-width="7" />
            <circle
              v-for="slice in pieSlices"
              :key="slice.label"
              cx="21"
              cy="21"
              r="15.915"
              fill="transparent"
              :stroke="slice.color"
              stroke-width="7"
              :stroke-dasharray="slice.dashArray"
              :stroke-dashoffset="slice.dashOffset"
            />
          </svg>
          <ul class="legend">
            <li v-for="slice in pieSlices" :key="slice.label">
              <i :style="{ background: slice.color }"></i>
              <span>{{ slice.label }}</span>
              <b>{{ formatCurrency(slice.value) }}</b>
            </li>
          </ul>
        </section>
      </section>

      <section v-if="activeTab === 'entries'" class="split">
        <form class="panel form" @submit.prevent="saveEntry">
          <h2><Plus :size="20" /> 手入力</h2>
          <select v-model="entryForm.entryType">
            <option value="expense">支出</option>
            <option value="income">収入</option>
          </select>
          <input v-model="entryForm.entryDate" type="date" required />
          <input v-model.number="entryForm.amount" type="number" min="1" placeholder="金額" required />
          <input v-model="entryForm.subjectUserId" placeholder="対象ユーザーID" required />
          <select v-model="entryForm.categoryId">
            <option value="">カテゴリなし</option>
            <option v-for="category in activeCategoriesForForm" :key="category.id" :value="category.id">{{ category.name }}</option>
          </select>
          <select v-model="entryForm.tagIds" multiple>
            <option v-for="tag in taxonomy.tags.filter((item) => item.isActive)" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
          </select>
          <input v-model="entryForm.target" placeholder="用途" />
          <textarea v-model="entryForm.memo" placeholder="メモ"></textarea>
          <button class="primary"><Save :size="18" /> 保存</button>
        </form>

        <section class="panel list-panel">
          <h2><ListChecks :size="20" /> 明細</h2>
          <table>
            <thead>
              <tr><th>日付</th><th>種別</th><th>カテゴリ</th><th>用途</th><th>金額</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="entry in entries" :key="entry.id">
                <td>{{ entry.entryDate }}</td>
                <td>{{ entry.entryType }}</td>
                <td>{{ entry.category?.name ?? "未分類" }}</td>
                <td>{{ entry.target }}</td>
                <td>{{ formatCurrency(entry.amount) }}</td>
                <td><button class="icon-button danger" title="削除" @click="deleteEntry(entry.id)"><Trash2 :size="16" /></button></td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>

      <section v-if="activeTab === 'source-items'" class="panel list-panel">
        <h2><FolderInput :size="20" /> 登録元明細</h2>
        <table>
          <thead>
            <tr><th>日付</th><th>種別</th><th>推定カテゴリ</th><th>用途</th><th>金額</th><th>信頼度</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="item in sourceItems" :key="item.id">
              <td>{{ item.entryDate }}</td>
              <td>{{ item.entryType }}</td>
              <td>{{ item.categoryNameGuess }}</td>
              <td>{{ item.target }}</td>
              <td>{{ item.amount == null ? "" : formatCurrency(item.amount) }}</td>
              <td>{{ item.confidence ?? "" }}</td>
              <td class="actions">
                <button class="primary small" @click="postSourceItem(item)">entry化</button>
                <button class="icon-button danger" title="削除" @click="deleteSourceItem(item.id)"><Trash2 :size="16" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-if="activeTab === 'duplicates'" class="panel list-panel">
        <h2><ListChecks :size="20" /> 重複候補</h2>
        <div v-for="item in sourceItems" :key="item.id" class="duplicate-block">
          <div class="duplicate-head">
            <strong>{{ item.entryDate }} {{ item.target }} {{ item.amount == null ? "" : formatCurrency(item.amount) }}</strong>
            <button class="small" @click="loadDuplicateCandidates(item.id)">候補取得</button>
          </div>
          <div v-for="candidate in duplicateMap[item.id] ?? []" :key="candidate.entry.id" class="candidate-row">
            <span>{{ candidate.entry.entryDate }} {{ candidate.entry.target }} {{ formatCurrency(candidate.entry.amount) }}</span>
            <b>{{ candidate.score }}</b>
            <button class="danger small" @click="markDuplicate(item.id)">重複</button>
            <button class="small" @click="markNotDuplicate(item.id, candidate.entry.id)">別物</button>
          </div>
        </div>
      </section>

      <section v-if="activeTab === 'assets'" class="split">
        <form class="panel form" @submit.prevent="saveAsset">
          <h2><Database :size="20" /> 金融資産</h2>
          <input v-model="assetForm.name" placeholder="資産名" required />
          <select v-model="assetForm.assetType">
            <option value="cash">現金</option>
            <option value="bank_deposit">銀行預金</option>
            <option value="investment_trust">投資信託</option>
            <option value="stock">株式</option>
            <option value="crypto">暗号資産</option>
            <option value="pension">年金</option>
            <option value="other">その他</option>
          </select>
          <input v-model="assetForm.quantityText" placeholder="数量メモ" />
          <input v-model.number="assetForm.valuationMinor" type="number" min="0" placeholder="評価額" />
          <textarea v-model="assetForm.valuationNote" placeholder="評価メモ"></textarea>
          <button class="primary"><Save :size="18" /> 保存</button>
        </form>
        <section class="panel list-panel">
          <h2>現在値</h2>
          <table>
            <tbody>
              <tr v-for="asset in assets" :key="asset.id">
                <td>{{ asset.name }}</td>
                <td>{{ asset.assetType }}</td>
                <td>{{ formatCurrency(asset.valuationMinor ?? 0) }}</td>
                <td class="actions">
                  <button class="small" @click="editAsset(asset)">編集</button>
                  <button class="icon-button danger" title="無効化" @click="deleteAsset(asset.id)"><Trash2 :size="16" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>

      <section v-if="activeTab === 'taxonomy'" class="split">
        <form class="panel form" @submit.prevent="saveCategory">
          <h2><TagIcon :size="20" /> カテゴリ</h2>
          <input v-model="categoryForm.code" placeholder="コード" required />
          <input v-model="categoryForm.name" placeholder="名前" required />
          <select v-model="categoryForm.kind">
            <option value="expense">支出</option>
            <option value="income">収入</option>
          </select>
          <input v-model.number="categoryForm.sortOrder" type="number" placeholder="表示順" />
          <label><input v-model="categoryForm.dedupeEnabled" type="checkbox" /> 重複判定</label>
          <label><input v-model="categoryForm.isActive" type="checkbox" /> 有効</label>
          <button class="primary"><Save :size="18" /> 保存</button>
        </form>
        <form class="panel form" @submit.prevent="saveTag">
          <h2><TagIcon :size="20" /> タグ</h2>
          <input v-model="tagForm.name" placeholder="名前" required />
          <label><input v-model="tagForm.isActive" type="checkbox" /> 有効</label>
          <button class="primary"><Save :size="18" /> 保存</button>
        </form>
        <section class="panel list-panel wide">
          <h2>一覧</h2>
          <table>
            <tbody>
              <tr v-for="category in allCategories" :key="category.id">
                <td>{{ category.kind }}</td>
                <td>{{ category.code }}</td>
                <td>{{ category.name }}</td>
                <td>{{ category.isActive ? "有効" : "無効" }}</td>
                <td class="actions">
                  <button class="small" @click="editCategory(category)">編集</button>
                  <button class="icon-button danger" title="削除または無効化" @click="deleteCategory(category.id)"><Trash2 :size="16" /></button>
                </td>
              </tr>
              <tr v-for="tag in taxonomy.tags" :key="tag.id">
                <td>tag</td>
                <td></td>
                <td>{{ tag.name }}</td>
                <td>{{ tag.isActive ? "有効" : "無効" }}</td>
                <td class="actions">
                  <button class="small" @click="editTag(tag)">編集</button>
                  <button class="icon-button danger" title="削除または無効化" @click="deleteTag(tag.id)"><Trash2 :size="16" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>

      <section v-if="activeTab === 'archives'" class="split">
        <section class="panel form">
          <h2><Archive :size="20" /> 操作</h2>
          <button class="primary" @click="prepareArchive">prepare</button>
          <input v-model.number="archiveConfirm.year" type="number" placeholder="年" />
          <input v-model="archiveConfirm.exportId" placeholder="exportId" />
          <input v-model="archiveConfirm.contentSha256" placeholder="content sha256" />
          <textarea v-model="archiveConfirm.externalStorageNote" placeholder="外部保存メモ"></textarea>
          <button @click="confirmArchive">外部保存確認</button>
          <button class="danger" @click="purgeArchive">パージ</button>
        </section>
        <section class="panel list-panel">
          <h2>アーカイブ年</h2>
          <table>
            <tbody>
              <tr v-for="archive in archives" :key="archive.id">
                <td>{{ archive.year }}</td>
                <td>{{ archive.status }}</td>
                <td>{{ archive.entryCount }}</td>
                <td><a :href="archiveDownloadUrl(archive.year)">download</a></td>
              </tr>
            </tbody>
          </table>
        </section>
      </section>
    </main>
  </div>
</template>
