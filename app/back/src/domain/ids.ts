export type IdPrefix =
  | "usr"
  | "cat"
  | "tag"
  | "es"
  | "esi"
  | "ent"
  | "fa"
  | "dex"
  | "arch"
  | "aexp";

export function newId(prefix: IdPrefix): string {
  const random = crypto.randomUUID().replaceAll("-", "");
  return `${prefix}_${random}`;
}
