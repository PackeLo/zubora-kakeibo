export function setClause(patch: Record<string, unknown>, columns: Record<string, string>): { sql: string; values: unknown[] } {
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  return {
    sql: entries.map(([key]) => `${columns[key] ?? key} = ?`).join(", "),
    values: entries.map(([, value]) => value)
  };
}

export function inClause(values: string[] | undefined, column: string, params: unknown[]): string {
  if (!values?.length) return "";
  params.push(...values);
  return ` AND ${column} IN (${values.map(() => "?").join(",")})`;
}
