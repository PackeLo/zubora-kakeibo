export interface PieInput {
  label: string;
  value: number;
}

export interface PieSlice {
  label: string;
  value: number;
  color: string;
  dashArray: string;
  dashOffset: string;
}

const COLORS = ["#2563eb", "#16a34a", "#dc2626", "#ca8a04", "#7c3aed", "#0891b2", "#be123c", "#4b5563"];

export function createPieSlices(items: PieInput[]): PieSlice[] {
  const positive = items.filter((item) => item.value > 0);
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];
  let offset = 25;
  return positive.map((item, index) => {
    const ratio = item.value / total;
    const length = ratio * 100;
    const slice = {
      label: item.label,
      value: item.value,
      color: COLORS[index % COLORS.length],
      dashArray: `${length} ${100 - length}`,
      dashOffset: `${offset}`
    };
    offset -= length;
    return slice;
  });
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0
  }).format(amount);
}
