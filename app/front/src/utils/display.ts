export function compactName(name: string): string { return [...name].slice(0, 3).join(""); }

export function formatMoney(amount: number, currency = "JPY"): string {
  try {
    const formatter = new Intl.NumberFormat("ja-JP", { style: "currency", currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 0;
    return formatter.format(amount / 10 ** digits);
  } catch { return `${amount.toLocaleString("ja-JP")} ${currency}`; }
}

export const assetTypeNames: Record<string, string> = {
  cash: "現金", bank_deposit: "銀行預金", investment_trust: "投資信託", stock: "株式", crypto: "暗号資産", pension: "年金", other: "その他"
};
