<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import {
  Archive,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Database,
  FolderInput,
  ListChecks,
  PieChart,
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
  type PersonProfile,
  type Tag,
  type User
} from "./api/client";
import { createPieSlices, formatCurrency } from "./utils/chart";
import SourceItemReview from "./components/SourceItemReview.vue";
import EntryEditor from "./components/EntryEditor.vue";
import EntryDetails from "./components/EntryDetails.vue";
import EntryList from "./components/EntryList.vue";
import PersonName from "./components/PersonName.vue";
import { assetTypeNames, formatMoney } from "./utils/display";
import { movePeriod, periodRange, type DashboardPeriod } from "./utils/period";

type Tab = "dashboard" | "entries" | "source-items" | "duplicates" | "assets" | "taxonomy" | "archives";

const activeTab = ref<Tab>("dashboard");
const pendingOperations = ref(0);
const loading = computed(() => pendingOperations.value > 0);
const notice = ref("");
const error = ref("");
const currentUser = ref<User | null>(null);
const users = ref<User[]>([]);
const profiles = ref<PersonProfile[]>([]);

const taxonomy = reactive<{ categories: Category[]; incomeCategories: Category[]; tags: Tag[] }>({
  categories: [],
  incomeCategories: [],
  tags: []
});
const entries = ref<Entry[]>([]);
const sourceItems = ref<EntrySourceItem[]>([]);
const daily = ref<DailySummary[]>([]);
const monthly = ref<Array<{ month: string; incomeTotal: number; expenseTotal: number; netCashflow: number }>>([]);
const categorySummary = ref<CategorySummary[]>([]);
const assets = ref<FinancialAsset[]>([]);
const archives = ref<any[]>([]);
const duplicateMap = reactive<Record<string, any[]>>({});

const today = new Date().toISOString().slice(0, 10);
const monthStart = `${today.slice(0, 7)}-01`;
const dashboardPeriod = ref<DashboardPeriod>({ mode: "month", month: today.slice(0, 7) });
const filters = reactive({
  type: "all" as "all" | "expense" | "income",
  from: monthStart,
  to: today,
  categoryIds: [] as string[],
  tagIds: [] as string[],
  excludedCategoryIds: [] as string[],
  excludedTagIds: [] as string[],
  subjectUserIds: [] as string[],
  registeredByEmails: [] as string[]
});

type EntryView = { mode: "list" } | { mode: "details"; entry: Entry; origin: "dashboard" | "entries" }
  | { mode: "edit"; entry: Entry; origin: "dashboard" | "entries"; fromDetails: boolean };
const entryView = ref<EntryView>({ mode: "list" });
const entryContext = computed(() => entryView.value.mode !== "list" && entryView.value.origin === activeTab.value ? entryView.value : null);
const editingEntry = computed(() => entryContext.value?.mode === "edit" ? entryContext.value.entry : null);
const entryEditorBusy = ref(false);
type DashboardSelection = { kind: "category"; id: string | null; name: string } | { kind: "day"; date: string; name: string };
const dashboardCategory = ref<DashboardSelection | null>(null);

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
  ownerUserId: "",
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
const categoryLegend = computed(() => categorySummary.value.filter((item) => item.amount > 0));
const pieSlices = computed(() => createPieSlices(categoryLegend.value.map((item) => ({ label: item.categoryName, value: item.amount }))));
const incomeTotal = computed(() => daily.value.reduce((sum, day) => sum + day.incomeTotal, 0));
const expenseTotal = computed(() => daily.value.reduce((sum, day) => sum + day.expenseTotal, 0));
const assetTotals = computed(() => {
  const totals = new Map<string, number>();
  for (const asset of assets.value) if (asset.valuationMinor != null) {
    const currency = asset.currency || "JPY";
    totals.set(currency, (totals.get(currency) ?? 0) + asset.valuationMinor);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b));
});
const currentRange = computed(() => activeTab.value === "dashboard" ? periodRange(dashboardPeriod.value) : { from: filters.from, to: filters.to });
const exclusionSummary = computed(() => [
  filters.excludedCategoryIds.length ? `除外カテゴリ: ${filters.excludedCategoryIds.map(id => allCategories.value.find(category => category.id === id)?.name ?? id).join('、')}` : '',
  filters.excludedTagIds.length ? `除外タグ: ${filters.excludedTagIds.map(id => taxonomy.tags.find(tag => tag.id === id)?.name ?? id).join('、')}` : ''
].filter(Boolean).join('・'));
const filterSummary = computed(() => {
  const names = [
    ...filters.registeredByEmails.map((email) => profiles.value.find(person => person.email === email)?.displayName ?? email),
    ...filters.subjectUserIds.map((id) => users.value.find(user => user.id === id)?.displayName ?? "対象者")
  ];
  return `${currentRange.value.from}〜${currentRange.value.to}・${filters.type === 'all' ? '収入と支出' : filters.type === 'expense' ? '支出' : '収入'}${names.length ? `・${names.join('、')}` : ''}${filters.categoryIds.length ? `・カテゴリ${filters.categoryIds.length}件` : ''}${filters.tagIds.length ? `・タグ${filters.tagIds.length}件` : ''}${exclusionSummary.value ? `・${exclusionSummary.value}` : ''}`;
});
const dashboardEntries = computed(() => {
  const selected = dashboardCategory.value;
  if (!selected) return [];
  return entries.value.filter(entry => selected.kind === "day" ? entry.entryDate === selected.date : (entry.categoryId ?? null) === selected.id);
});
const annualMonths = computed(() => {
  const year = dashboardPeriod.value.mode === "year" ? dashboardPeriod.value.year : Number(dashboardPeriod.value.month.slice(0, 4));
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, "0")}`;
    return { month, incomeTotal: 0, expenseTotal: 0, netCashflow: 0, ...monthly.value.find(item => item.month === month) };
  });
});
const calendarDays = computed(() => {
  const map = new Map(daily.value.map((day) => [day.date, day]));
  const start = new Date(`${currentRange.value.from}T00:00:00Z`);
  const end = new Date(`${currentRange.value.to}T00:00:00Z`);
  const days: Array<{ date: string; summary?: DailySummary }> = [];
  for (let current = start; current <= end; current = new Date(current.getTime() + 86_400_000)) {
    const date = current.toISOString().slice(0, 10);
    days.push({ date, summary: map.get(date) });
    if (days.length > 370) break;
  }
  return days;
});
const calendarOffset = computed(() => new Date(`${currentRange.value.from}T00:00:00Z`).getUTCDay());

onMounted(() => {
  void refreshAll();
});

let refreshGeneration = 0;
async function refreshAll() {
  const generation = ++refreshGeneration;
  const query = buildFilterQuery();
  const selectedType = filters.type;
  pendingOperations.value += 1;
  error.value = "";
  notice.value = "";
  try {
    const me = await apiGet<User>("/api/me");
    const [tx, entryRows, itemRows, days, categories, assetRows, archiveRows, userRows, months] = await Promise.all([
      apiGet<typeof taxonomy>("/api/taxonomy", { includeInactive: true }),
      apiGet<{ items: Entry[] }>("/api/entries", query),
      apiGet<{ items: EntrySourceItem[] }>("/api/entry-source-items", { status: "pending", type: selectedType === "all" ? undefined : selectedType }),
      apiGet<{ days: DailySummary[] }>("/api/summaries/daily", query),
      apiGet<{ items: CategorySummary[] }>("/api/summaries/category", { ...query, type: selectedType === "all" ? "expense" : selectedType }),
      apiGet<{ items: FinancialAsset[] }>("/api/financial-assets"),
      me.role === "admin" ? apiGet<{ items: any[] }>("/api/admin/archive-years") : Promise.resolve({ items: [] }),
      apiGet<{ items: User[]; profiles?: PersonProfile[] }>("/api/users"),
      apiGet<{ months: typeof monthly.value }>("/api/summaries/monthly", query)
    ]);
    if (generation !== refreshGeneration) return;
    if (!currentUser.value) assetForm.ownerUserId = me.id;
    currentUser.value = me;
    taxonomy.categories = tx.categories;
    taxonomy.incomeCategories = tx.incomeCategories;
    taxonomy.tags = tx.tags;
    entries.value = entryRows.items;
    sourceItems.value = itemRows.items;
    daily.value = days.days;
    categorySummary.value = categories.items;
    assets.value = assetRows.items;
    archives.value = archiveRows.items;
    users.value = userRows.items;
    profiles.value = [...new Map([...userRows.items.map(user => ({ email: user.email ?? user.displayName, displayName: user.displayName })), ...(userRows.profiles ?? [])].map(person => [person.email, person])).values()];
    monthly.value = months.months ?? [];
  } catch (err) {
    if (generation === refreshGeneration) error.value = err instanceof Error ? err.message : String(err);
  } finally {
    pendingOperations.value -= 1;
  }
}

async function editEntry(id: string) {
  if (loading.value || entryEditorBusy.value) return;
  await run(async () => {
    const fromDetails = entryContext.value?.mode === "details";
    entryView.value = { mode: "edit", entry: await apiGet<Entry>(`/api/entries/${id}`), origin: activeTab.value === "dashboard" ? "dashboard" : "entries", fromDetails };
  });
}

async function viewEntry(id: string) {
  if (loading.value || entryEditorBusy.value) return;
  await run(async () => {
    entryView.value = { mode: "details", entry: await apiGet<Entry>(`/api/entries/${id}`), origin: activeTab.value === "dashboard" ? "dashboard" : "entries" };
  });
}

function cancelEntryEdit() {
  const view = entryView.value;
  entryView.value = view.mode === "edit" && view.fromDetails ? { mode: "details", entry: view.entry, origin: view.origin } : { mode: "list" };
}

async function entrySaved(saved: Entry) {
  const edited = editingEntry.value !== null;
  const view = entryView.value;
  entryView.value = view.mode === "edit" && view.fromDetails ? { mode: "details", entry: saved, origin: view.origin } : { mode: "list" };
  await refreshAll();
  notice.value = edited ? "明細の変更を保存した。" : "登録した。";
}

async function deleteEntry(id: string) {
  await run(async () => {
    await apiDelete(`/api/entries/${id}`);
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
    Object.assign(assetForm, { id: "", ownerUserId: currentUser.value?.id ?? "", name: "", assetType: "bank_deposit", quantityText: "", valuationMinor: 0, currency: "JPY", valuationNote: "" });
    await refreshAll();
  });
}

function editAsset(asset: FinancialAsset) {
  Object.assign(assetForm, {
    id: asset.id,
    ownerUserId: asset.ownerUserId ?? currentUser.value?.id ?? "",
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
    type: filters.type === "all" ? undefined : filters.type,
    ...currentRange.value,
    categoryIds: filters.categoryIds,
    tagIds: filters.tagIds,
    excludedCategoryIds: filters.excludedCategoryIds,
    excludedTagIds: filters.excludedTagIds,
    subjectUserIds: filters.subjectUserIds,
    registeredByEmails: filters.registeredByEmails
  };
}

function clearExclusions() {
  filters.excludedCategoryIds = [];
  filters.excludedTagIds = [];
  void refreshAll();
}

function setPeriodMode(mode: "month" | "year") {
  const period = dashboardPeriod.value;
  if (period.mode === mode) return;
  const year = period.mode === "year" ? period.year : Number(period.month.slice(0, 4));
  dashboardPeriod.value = mode === "year" ? { mode, year } : { mode, month: `${year}-01` };
  void refreshAll();
}

function selectMonth(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return;
  dashboardPeriod.value = { mode: "month", month };
  void refreshAll();
}

function selectYear(value: string) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) return;
  dashboardPeriod.value = { mode: "year", year };
  void refreshAll();
}

function shiftPeriod(step: number) { dashboardPeriod.value = movePeriod(dashboardPeriod.value, step); void refreshAll(); }

async function selectCategory(id: string | null, name: string) {
  dashboardCategory.value = { kind: "category", id, name };
  await nextTick();
  document.querySelector(".dashboard-entries")?.scrollIntoView?.({ block: "start" });
}

async function selectDay(date: string) {
  dashboardCategory.value = { kind: "day", date, name: new Intl.DateTimeFormat("ja-JP", { month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) };
  await nextTick();
  document.querySelector(".dashboard-entries")?.scrollIntoView?.({ block: "start" });
}

function changeTab(tab: Tab) {
  if (entryEditorBusy.value) return;
  entryView.value = { mode: "list" };
  activeTab.value = tab;
  if (tab === "dashboard" || tab === "entries") void refreshAll();
}

async function run(task: () => Promise<void>) {
  pendingOperations.value += 1;
  error.value = "";
  notice.value = "";
  try {
    await task();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    pendingOperations.value -= 1;
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
        <button v-for="tab in tabs" :key="tab.key" :class="{ active: activeTab === tab.key }" :disabled="entryEditorBusy" @click="changeTab(tab.key)">
          <component :is="tab.icon" :size="18" />
          <span>{{ tab.label }}</span>
        </button>
      </nav>
    </aside>

    <main class="main">
      <header class="topbar">
        <details v-if="activeTab === 'dashboard' || activeTab === 'entries'" class="search-panel" data-testid="search-panel">
          <summary><strong>検索・絞り込み</strong><span>{{ filterSummary }}</span></summary>
          <div class="filters">
            <label>種別<select v-model="filters.type" name="filterType" @change="refreshAll"><option value="all">収入と支出</option><option value="expense">支出</option><option value="income">収入</option></select></label>
            <template v-if="activeTab !== 'dashboard'">
              <label>開始日<input v-model="filters.from" name="filterFrom" type="date" @change="refreshAll" /></label>
              <label>終了日<input v-model="filters.to" name="filterTo" type="date" @change="refreshAll" /></label>
            </template>
            <label>含めるカテゴリ<select v-model="filters.categoryIds" name="filterCategories" multiple @change="refreshAll"><option v-for="category in allCategories" :key="category.id" :value="category.id">{{ category.name }}</option></select></label>
            <label>含めるタグ<select v-model="filters.tagIds" name="filterTags" multiple @change="refreshAll"><option v-for="tag in taxonomy.tags" :key="tag.id" :value="tag.id">{{ tag.name }}</option></select></label>
            <label>登録者<select v-model="filters.registeredByEmails" name="filterRegisteredBy" multiple @change="refreshAll"><option v-for="person in profiles" :key="person.email" :value="person.email">{{ person.displayName }}</option></select></label>
            <label>対象者<select v-model="filters.subjectUserIds" name="filterSubjects" multiple @change="refreshAll"><option v-for="user in users" :key="user.id" :value="user.id">{{ user.displayName }}</option></select></label>
          </div>
          <div class="exclusion-filters">
            <p class="muted">選んだカテゴリ、またはタグのどれかに該当する明細を、合計・グラフ・明細一覧から除外するよ。</p>
            <div class="exclusion-groups">
              <fieldset class="exclusion-options"><legend>除外するカテゴリ</legend>
                <label v-for="category in allCategories" :key="category.id"><input v-model="filters.excludedCategoryIds" type="checkbox" name="excludedCategories" :value="category.id" @change="refreshAll" /><span>{{ category.name }}<small v-if="!category.isActive">（無効）</small></span></label>
                <p v-if="!allCategories.length" class="muted">カテゴリがないよ。</p>
              </fieldset>
              <fieldset class="exclusion-options"><legend>除外するタグ</legend>
                <label v-for="tag in taxonomy.tags" :key="tag.id"><input v-model="filters.excludedTagIds" type="checkbox" name="excludedTags" :value="tag.id" @change="refreshAll" /><span>{{ tag.name }}<small v-if="!tag.isActive">（無効）</small></span></label>
                <p v-if="!taxonomy.tags.length" class="muted">タグがないよ。</p>
              </fieldset>
            </div>
            <button v-if="exclusionSummary" type="button" @click="clearExclusions">除外条件を解除</button>
          </div>
        </details>
        <button class="icon-button" title="再読み込み" @click="refreshAll">
          <RefreshCw :size="18" />
        </button>
      </header>

      <p v-if="notice" class="notice">{{ notice }}</p>
      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="loading" class="loading">読み込み中。</p>

      <EntryDetails v-if="entryContext?.mode === 'details'" :entry="entryContext.entry" :users="users" :busy="loading"
        @back="entryView = { mode: 'list' }" @edit="editEntry(entryContext!.entry.id)" />
      <EntryEditor v-if="activeTab === 'dashboard' && entryContext?.mode === 'edit'" :entry="editingEntry" :categories="allCategories" :tags="taxonomy.tags" :users="users"
        :default-subject-user-id="currentUser?.id ?? ''" :disabled="loading" @saved="entrySaved" @cancel="cancelEntryEdit" @busy="entryEditorBusy = $event" />

      <section v-if="activeTab === 'dashboard' && !entryContext" class="content-grid">
        <section class="panel wide period-panel">
          <div class="period-modes" aria-label="ダッシュボードの表示期間"><button type="button" :class="{ active: dashboardPeriod.mode === 'month' }" :disabled="loading" @click="setPeriodMode('month')">月別</button><button type="button" :class="{ active: dashboardPeriod.mode === 'year' }" :disabled="loading" @click="setPeriodMode('year')">年別</button></div>
          <div class="period-navigation"><button type="button" aria-label="前の期間" :disabled="loading" @click="shiftPeriod(-1)">前へ</button>
            <label v-if="dashboardPeriod.mode === 'month'">対象月<input name="dashboardMonth" type="month" :value="dashboardPeriod.month" :disabled="loading" @change="selectMonth(($event.target as HTMLInputElement).value)" /></label>
            <label v-else>対象年<input name="dashboardYear" type="number" min="1000" max="9999" :value="dashboardPeriod.year" :disabled="loading" @change="selectYear(($event.target as HTMLInputElement).value)" /></label>
            <button type="button" aria-label="次の期間" :disabled="loading" @click="shiftPeriod(1)">次へ</button></div>
        </section>
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
        <section v-if="dashboardPeriod.mode === 'month'" class="panel wide">
          <h2><CalendarDays :size="20" /> カレンダー</h2>
          <p class="muted">日付を押すと、その日の明細を確認できるよ。</p>
          <div class="calendar-grid">
            <span v-for="weekday in ['日', '月', '火', '水', '木', '金', '土']" :key="weekday" class="weekday">{{ weekday }}</span>
            <div v-for="pad in calendarOffset" :key="`pad-${pad}`" aria-hidden="true"></div>
            <button v-for="day in calendarDays" :key="day.date" type="button" class="calendar-day" :class="{ filled: day.summary }" :disabled="!day.summary?.entryCount" :aria-label="`${day.date}の明細 ${day.summary?.entryCount ?? 0}件`" @click="selectDay(day.date)">
              <time :datetime="day.date">{{ Number(day.date.slice(8)) }}</time>
              <strong v-if="day.summary?.expenseTotal" class="negative calendar-amount">−{{ formatCurrency(day.summary.expenseTotal) }}</strong>
              <span v-if="day.summary?.incomeTotal" class="positive calendar-amount">+{{ formatCurrency(day.summary.incomeTotal) }}</span>
              <span v-if="day.summary" class="day-indicators" aria-hidden="true"><i v-if="day.summary.expenseTotal" class="expense-dot"></i><i v-if="day.summary.incomeTotal" class="income-dot"></i></span>
              <small v-if="day.summary?.entryCount">{{ day.summary.entryCount }}件</small>
            </button>
          </div>
          <p class="calendar-key muted">赤は支出、緑は収入のある日だよ。</p>
        </section>

        <section v-else class="panel wide">
          <h2>月ごとの収支</h2>
          <div class="annual-months"><button v-for="month in annualMonths" :key="month.month" type="button" class="month-summary" :aria-label="`${month.month}の月別を表示`" :disabled="loading" @click="selectMonth(month.month)"><strong>{{ Number(month.month.slice(5)) }}月</strong><span>収入 {{ formatCurrency(month.incomeTotal) }}</span><span>支出 {{ formatCurrency(month.expenseTotal) }}</span><span>差額 {{ formatCurrency(month.netCashflow) }}</span></button></div>
        </section>

        <section class="panel wide">
          <h2><PieChart :size="20" /> {{ filters.type === 'income' ? '収入' : '支出' }}の内訳</h2>
          <p class="muted">カテゴリを押すと明細を確認できるよ。</p>
          <p v-if="!categoryLegend.length" class="empty-state">条件に一致する明細がないよ。</p>
          <svg v-else class="pie" viewBox="0 0 42 42" role="img" aria-label="カテゴリ別金額の割合">
            <circle cx="21" cy="21" r="15.915" fill="transparent" stroke="#e5e7eb" stroke-width="7" />
            <circle
              v-for="slice in pieSlices"
              :key="slice.label + slice.dashOffset"
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
            <li v-for="(category, index) in categoryLegend" :key="category.categoryId ?? 'uncategorized'">
              <button type="button" class="category-drilldown" :aria-label="`${category.categoryName}の明細を表示`" @click="selectCategory(category.categoryId, category.categoryName)">
                <i :style="{ background: pieSlices[index]?.color }"></i><span>{{ category.categoryName }}</span><b>{{ formatMoney(category.amount, category.currency) }}</b>
              </button>
            </li>
          </ul>
        </section>
        <section v-if="dashboardCategory" class="panel dashboard-entries wide">
          <div class="detail-header"><h2>{{ dashboardCategory.name }}の明細</h2><button type="button" @click="dashboardCategory = null">内訳を閉じる</button></div>
          <p class="muted">{{ currentRange.from }}〜{{ currentRange.to }}</p>
          <EntryList :entries="dashboardEntries" :busy="loading || entryEditorBusy" @details="viewEntry" @edit="editEntry" />
        </section>
      </section>

      <section v-if="activeTab === 'entries' && entryContext?.mode !== 'details'" class="split">
        <EntryEditor :entry="editingEntry" :categories="allCategories" :tags="taxonomy.tags" :users="users"
          :default-subject-user-id="currentUser?.id ?? ''" :disabled="loading"
          @saved="entrySaved" @cancel="cancelEntryEdit" @busy="entryEditorBusy = $event" />

        <section class="panel list-panel">
          <h2><ListChecks :size="20" /> 明細</h2>
          <EntryList :entries="entries" :busy="loading || entryEditorBusy" can-delete @details="viewEntry" @edit="editEntry" @remove="deleteEntry" />
        </section>
      </section>

      <section v-if="activeTab === 'source-items'" class="panel list-panel">
        <h2><FolderInput :size="20" /> 登録元明細</h2>
        <p v-if="sourceItems.length === 0">確認待ちの明細はないよ。</p>
        <SourceItemReview
          v-for="item in sourceItems"
          :key="item.id"
          :item="item"
          :categories="allCategories"
          :tags="taxonomy.tags"
          :users="users"
          :default-subject-user-id="currentUser?.id ?? ''"
          @changed="refreshAll"
          @remove="deleteSourceItem(item.id)"
        />
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
        <section class="panel wide asset-totals" data-testid="asset-totals">
          <h2>登録資産の合計（目安）</h2>
          <p class="muted">登録されている評価額の合計だよ。未登録分は含まれないよ。</p>
          <p v-if="assetTotals.length === 0">評価額の登録はまだないよ。</p>
          <div v-for="[currency, total] in assetTotals" :key="currency"><span>{{ currency }}</span><strong>{{ formatMoney(total, currency) }}</strong></div>
        </section>
        <form class="panel form" @submit.prevent="saveAsset">
          <h2><Database :size="20" /> 金融資産</h2>
          <select v-model="assetForm.ownerUserId" name="assetOwnerUserId" aria-label="所有者" required>
            <option value="">所有者を選んでね</option>
            <option v-for="user in users" :key="user.id" :value="user.id">{{ user.displayName }}</option>
          </select>
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
          <h2>登録資産</h2>
          <table class="asset-table">
            <thead><tr><th>資産名</th><th>種別</th><th>所有者</th><th>評価額</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="asset in assets" :key="asset.id">
                <td data-label="資産名">{{ asset.name }}</td>
                <td data-label="種別">{{ assetTypeNames[asset.assetType] ?? asset.assetType }}</td>
                <td data-label="所有者"><PersonName :name="users.find(user => user.id === asset.ownerUserId)?.displayName ?? '不明'" /></td>
                <td data-label="評価額">{{ asset.valuationMinor == null ? '未登録' : formatMoney(asset.valuationMinor, asset.currency) }}</td>
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
