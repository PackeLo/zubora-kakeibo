import { z } from "zod";
import type { EntryWithDetails, User } from "../domain/types";

export const displayNamesSchema = z.record(z.email(), z.string().trim().min(1));
export type DisplayNames = Readonly<Record<string, string>>;

export function parseDisplayNames(json: string | undefined): DisplayNames {
  const parsed = displayNamesSchema.parse(JSON.parse(json ?? "{}"));
  return Object.fromEntries(Object.entries(parsed).map(([email, name]) => [email.trim().toLowerCase(), name]));
}

export function personProfile(email: string, names: DisplayNames) {
  const normalized = email.trim().toLowerCase();
  return { email: normalized, displayName: names[normalized] ?? email };
}

export function publicUser(user: User, names: DisplayNames) {
  return { id: user.id, role: user.role, ...personProfile(user.displayName, names) };
}

export function entryProfile(entry: EntryWithDetails, names: DisplayNames): EntryWithDetails {
  const email = entry.source?.createdBy;
  return { ...entry, registeredBy: email ? personProfile(email, names) : null };
}
