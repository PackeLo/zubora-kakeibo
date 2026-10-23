import type { Actor } from "../../domain/types";
import { AppError } from "../../application/errors";

export const scopeDescriptions = {
  "kakeibo:read": "家計の分類・明細・集計・金融資産を読む",
  "kakeibo:import": "レシートなどを確認待ちの下書きとして登録する",
  "kakeibo:taxonomy:write": "カテゴリ・タグを登録、編集、削除または無効化する（管理者のみ）",
  "kakeibo:assets:write": "家族の金融資産を登録、編集、無効化する",
  offline_access: "接続を更新して継続利用する"
} as const;
export type KakeiboScope = keyof typeof scopeDescriptions;
export const supportedScopes = Object.keys(scopeDescriptions);

export function assertGrantScopes(scopes: string[], actor: Actor): void {
  for (const scope of scopes) {
    if (!supportedScopes.includes(scope)) throw new AppError("FORBIDDEN", "unsupported scope");
    if (scope === "kakeibo:taxonomy:write" && actor.role !== "admin") {
      throw new AppError("FORBIDDEN", "分類の変更は管理者のみ許可できます。");
    }
  }
}
