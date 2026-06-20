import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../../worker/bindings";
import { KakeiboUseCases, sanitizeEntryFilters } from "../../application/useCases";
import { AppError, validationError } from "../../application/errors";
import { DomainValidationError } from "../../domain/errors";
import { daysBetween } from "../../domain/dates";
import { requireActionToken, requireAdmin, webActor } from "../auth/auth";
import {
  actionEntrySourceSchema,
  categorySchema,
  categoryUpdateSchema,
  confirmExternalBackupSchema,
  entrySourceItemUpdateSchema,
  entrySourceUpdateSchema,
  entryUpdateSchema,
  financialAssetSchema,
  financialAssetUpdateSchema,
  manualEntrySchema,
  markNotDuplicateSchema,
  parseCsv,
  parseNumber,
  postEntrySourceItemSchema,
  tagSchema,
  tagUpdateSchema
} from "./schemas";
import type { UnitOfWork } from "../../ports/repositories";
import type { Actor } from "../../domain/types";

const ACTION_SUMMARY_MAX_DAYS = 1461;
const ACTION_ENTRIES_MAX_DAYS = 400;

export function createApiApp(factory: (env: Env) => UnitOfWork) {
  const app = new Hono<{ Bindings: Env }>();

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: err.code, message: err.message, details: err.details ?? null }, err.status as 400);
    }
    if (err instanceof z.ZodError) {
      return c.json({ error: "VALIDATION_ERROR", message: "入力値が不正です。", details: err.flatten() }, 400);
    }
    if (err instanceof DomainValidationError) {
      return c.json({ error: "VALIDATION_ERROR", message: err.message, details: null }, 400);
    }
    console.error(err);
    return c.json({ error: "INTERNAL_ERROR", message: "内部エラーが発生しました。", details: null }, 500);
  });

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.use("/api/*", async (c, next) => {
    const repos = factory(c.env);
    c.set("useCases", new KakeiboUseCases(repos, configFromEnv(c.env)));
    await next();
  });

  app.use("/api/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path === "/api/health" || path.startsWith("/api/action/")) {
      await next();
      return;
    }
    const actor = webActor(c);
    c.set("actor", actor);
    await useCases(c).currentUser(actor);
    await next();
  });

  app.get("/api/me", async (c) => {
    return c.json(await useCases(c).currentUser(currentActor(c)));
  });

  app.get("/api/users", async (c) => c.json({ items: await useCases(c).listUsers() }));

  app.get("/api/action/taxonomy", async (c) => {
    requireActionToken(c);
    return c.json(await useCases(c).listTaxonomy(false));
  });

  app.post("/api/action/entry-sources", async (c) => {
    const actor = requireActionToken(c);
    const input = actionEntrySourceSchema.parse(await c.req.json());
    const idempotencyKey = c.req.header("Idempotency-Key");
    return c.json(await useCases(c).createActionEntrySource(input, actor, idempotencyKey));
  });

  app.get("/api/action/insights/overview", async (c) => {
    requireActionToken(c);
    return c.json(await useCases(c).actionOverview(actionPeriodFilters(c.req.query())));
  });

  app.get("/api/action/insights/monthly", async (c) => {
    requireActionToken(c);
    return c.json({ months: await useCases(c).monthlySummary(actionPeriodFilters(c.req.query())) });
  });

  app.get("/api/action/insights/category", async (c) => {
    requireActionToken(c);
    return c.json(await useCases(c).categorySummary(actionPeriodFilters(c.req.query())));
  });

  app.get("/api/action/insights/entries", async (c) => {
    requireActionToken(c);
    return c.json({ items: await useCases(c).actionEntries(actionEntryFilters(c.req.query())) });
  });

  app.get("/api/taxonomy", async (c) => c.json(await useCases(c).listTaxonomy(c.req.query("includeInactive") === "true")));
  app.post("/api/categories", async (c) => {
    const actor = requireAdminActor(c);
    return c.json(await useCases(c).createCategory(categorySchema.parse(await c.req.json()), actor), 201);
  });
  app.patch("/api/categories/:id", async (c) => {
    const actor = requireAdminActor(c);
    return c.json(await useCases(c).updateCategory(c.req.param("id"), categoryUpdateSchema.parse(await c.req.json()), actor));
  });
  app.delete("/api/categories/:id", async (c) => {
    const actor = requireAdminActor(c);
    return c.json(await useCases(c).deleteCategory(c.req.param("id"), actor));
  });
  app.post("/api/tags", async (c) => {
    requireAdminActor(c);
    return c.json(await useCases(c).createTag(tagSchema.parse(await c.req.json())), 201);
  });
  app.patch("/api/tags/:id", async (c) => {
    requireAdminActor(c);
    return c.json(await useCases(c).updateTag(c.req.param("id"), tagUpdateSchema.parse(await c.req.json())));
  });
  app.delete("/api/tags/:id", async (c) => {
    requireAdminActor(c);
    return c.json(await useCases(c).deleteTag(c.req.param("id")));
  });

  app.get("/api/entry-sources", async (c) => c.json({ items: await useCases(c).listEntrySources() }));
  app.get("/api/entry-sources/:id", async (c) => c.json(await useCases(c).getEntrySource(c.req.param("id"))));
  app.post("/api/entry-sources", async (c) => {
    const actor = currentActor(c);
    const input = actionEntrySourceSchema.parse(await c.req.json());
    return c.json(await useCases(c).createActionEntrySource(input, actor, c.req.header("Idempotency-Key")), 201);
  });
  app.patch("/api/entry-sources/:id", async (c) => {
    const actor = currentActor(c);
    return c.json(await useCases(c).updateEntrySource(c.req.param("id"), entrySourceUpdateSchema.parse(await c.req.json()), actor));
  });

  app.get("/api/entry-source-items", async (c) =>
    c.json({
      items: await useCases(c).listEntrySourceItems({
        status: c.req.query("status") as "pending" | "posted" | undefined,
        type: c.req.query("type") as "expense" | "income" | undefined,
        from: c.req.query("from"),
        to: c.req.query("to")
      })
    })
  );
  app.get("/api/entry-source-items/:id/duplicate-candidates", async (c) => c.json({ items: await useCases(c).duplicateCandidates(c.req.param("id")) }));
  app.patch("/api/entry-source-items/:id", async (c) => c.json(await useCases(c).updateEntrySourceItem(c.req.param("id"), entrySourceItemUpdateSchema.parse(await c.req.json()))));
  app.post("/api/entry-source-items/:id/post", async (c) => c.json(await useCases(c).postEntrySourceItem(c.req.param("id"), postEntrySourceItemSchema.parse(await c.req.json()), currentActor(c))));
  app.delete("/api/entry-source-items/:id", async (c) => c.json(await useCases(c).deleteEntrySourceItem(c.req.param("id"))));
  app.post("/api/entry-source-items/:id/mark-duplicate", async (c) => c.json(await useCases(c).markDuplicate(c.req.param("id"))));
  app.post("/api/entry-source-items/:id/mark-not-duplicate", async (c) => {
    const input = markNotDuplicateSchema.parse(await c.req.json());
    return c.json(await useCases(c).markNotDuplicate(c.req.param("id"), input.entryId, input.reason ?? null, currentActor(c)));
  });

  app.get("/api/entries", async (c) => c.json({ items: await useCases(c).listEntries(entryFilters(c.req.query())) }));
  app.post("/api/entries", async (c) => c.json(await useCases(c).createManualEntry(manualEntrySchema.parse(await c.req.json()), currentActor(c)), 201));
  app.patch("/api/entries/:id", async (c) => c.json(await useCases(c).updateEntry(c.req.param("id"), entryUpdateSchema.parse(await c.req.json()))));
  app.delete("/api/entries/:id", async (c) => c.json(await useCases(c).deleteEntry(c.req.param("id"))));

  app.get("/api/financial-assets", async (c) => c.json({ items: await useCases(c).listFinancialAssets(c.req.query("includeInactive") === "true") }));
  app.post("/api/financial-assets", async (c) => c.json(await useCases(c).createFinancialAsset(financialAssetSchema.parse(await c.req.json()), currentActor(c)), 201));
  app.patch("/api/financial-assets/:id", async (c) => c.json(await useCases(c).updateFinancialAsset(c.req.param("id"), financialAssetUpdateSchema.parse(await c.req.json()), currentActor(c))));
  app.delete("/api/financial-assets/:id", async (c) => c.json(await useCases(c).deleteFinancialAsset(c.req.param("id"), currentActor(c))));

  app.get("/api/summaries/monthly", async (c) => c.json({ months: await useCases(c).monthlySummary(summaryFilters(c.req.query())) }));
  app.get("/api/summaries/daily", async (c) => c.json({ days: await useCases(c).dailySummary(summaryFilters(c.req.query())) }));
  app.get("/api/summaries/category", async (c) => c.json({ items: await useCases(c).categorySummary(summaryFilters(c.req.query())) }));
  app.get("/api/summaries/cashflow", async (c) => {
    const year = parseNumber(c.req.query("year")) ?? new Date().getUTCFullYear();
    return c.json({ year, months: await useCases(c).cashflowSummary(year) });
  });

  app.get("/api/admin/archive-years", async (c) => {
    requireAdminActor(c);
    return c.json({ items: await useCases(c).listArchiveYears() });
  });
  app.post("/api/admin/archive-years/prepare", async (c) => {
    const actor = requireAdminActor(c);
    const year = parseNumber(c.req.query("currentYear")) ?? new Date().getUTCFullYear();
    return c.json(await useCases(c).prepareArchive(year, actor));
  });
  app.get("/api/admin/archive-years/:year/download", async (c) => {
    const actor = requireAdminActor(c);
    const year = Number(c.req.param("year"));
    const archive = await useCases(c).buildArchive(year, actor);
    const body = await gzipString(archive.ndjson);
    return new Response(body as BodyInit, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${archive.archiveExport.filename}"`
      }
    });
  });
  app.post("/api/admin/archive-years/:year/confirm-external-backup", async (c) => {
    const actor = requireAdminActor(c);
    return c.json(await useCases(c).confirmExternalBackup(Number(c.req.param("year")), confirmExternalBackupSchema.parse(await c.req.json()), actor));
  });
  app.post("/api/admin/archive-years/:year/purge", async (c) => {
    const actor = requireAdminActor(c);
    return c.json(await useCases(c).purgeArchive(Number(c.req.param("year")), actor));
  });

  return app;
}

declare module "hono" {
  interface ContextVariableMap {
    useCases: KakeiboUseCases;
    actor: Actor;
  }
}

function useCases(c: { get: (key: "useCases") => KakeiboUseCases }): KakeiboUseCases {
  return c.get("useCases");
}

function currentActor(c: { get: (key: "actor") => Actor }): Actor {
  return c.get("actor");
}

function requireAdminActor(c: { get: (key: "actor") => Actor }): Actor {
  const actor = currentActor(c);
  requireAdmin(actor);
  return actor;
}

function entryFilters(query: Record<string, string>) {
  return sanitizeEntryFilters({
    type: query.type as "expense" | "income" | undefined,
    from: query.from,
    to: query.to,
    categoryIds: parseCsv(query.categoryIds),
    tagIds: parseCsv(query.tagIds),
    subjectUserIds: parseCsv(query.subjectUserIds),
    limit: parseNumber(query.limit)
  });
}

function summaryFilters(query: Record<string, string>) {
  return {
    ...entryFilters(query),
    year: parseNumber(query.year)
  };
}

function actionPeriodFilters(query: Record<string, string>) {
  const filters = summaryFilters(query);
  if (!filters.from || !filters.to) {
    throw new AppError("VALIDATION_ERROR", "from and to are required");
  }
  assertDateSpan(filters.from, filters.to, ACTION_SUMMARY_MAX_DAYS);
  return filters;
}

function actionEntryFilters(query: Record<string, string>) {
  const filters = entryFilters(query);
  if (!filters.from || !filters.to) {
    throw new AppError("VALIDATION_ERROR", "from and to are required");
  }
  assertDateSpan(filters.from, filters.to, ACTION_ENTRIES_MAX_DAYS);
  return filters;
}

function assertDateSpan(from: string, to: string, maxDays: number) {
  if (from > to) {
    validationError("from must be earlier than or equal to to");
  }
  if (daysBetween(from, to) > maxDays) {
    validationError(`date range must be ${maxDays} days or less`);
  }
}

function configFromEnv(env: Env) {
  return {
    liveCompletedYearsToKeep: Number(env.LIVE_COMPLETED_YEARS_TO_KEEP ?? 3)
  };
}

async function gzipString(input: string): Promise<ReadableStream | Uint8Array> {
  if (typeof CompressionStream === "undefined") {
    return new TextEncoder().encode(input);
  }
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  return stream;
}
