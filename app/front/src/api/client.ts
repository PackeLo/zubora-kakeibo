export interface ApiError {
  error: string;
  message: string;
  details?: unknown;
}

export async function apiGet<T>(path: string, query?: Record<string, unknown>): Promise<T> {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) url.searchParams.set(key, value.join(","));
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return apiFetch<T>(url.pathname + url.search);
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body: body == null ? undefined : JSON.stringify(body) });
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) });
}

export async function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {})
    }
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(payload?.message ?? `HTTP ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export interface Category {
  id: string;
  code: string;
  name: string;
  kind: "expense" | "income";
  sortOrder: number;
  dedupeEnabled: boolean;
  isActive: boolean;
}

export interface Tag {
  id: string;
  name: string;
  isActive: boolean;
}

export interface Entry {
  id: string;
  entryType: "expense" | "income";
  subjectUserId: string | null;
  entryDate: string;
  amount: number;
  currency: string;
  categoryId: string | null;
  target: string | null;
  memo: string | null;
  category?: Category | null;
  tags: Tag[];
}

export interface EntrySourceItem {
  id: string;
  entrySourceId: string;
  entryType: "expense" | "income";
  subjectUserId: string | null;
  entryDate: string | null;
  amount: number | null;
  currency: string;
  target: string | null;
  categoryIdGuess: string | null;
  categoryNameGuess: string | null;
  tagsJson: string | null;
  memo: string | null;
  confidence: number | null;
  status: "pending" | "posted";
}

export interface FinancialAsset {
  id: string;
  ownerUserId: string | null;
  name: string;
  assetType: string;
  quantityText: string | null;
  valuationMinor: number | null;
  currency: string;
  valuationUpdatedAt: string | null;
  valuationNote: string | null;
  isActive: boolean;
}

export interface DailySummary {
  date: string;
  incomeTotal: number;
  expenseTotal: number;
  netCashflow: number;
  entryCount: number;
  currency: string;
}

export interface CategorySummary {
  categoryId: string | null;
  categoryName: string;
  amount: number;
  entryCount: number;
  currency: string;
}
