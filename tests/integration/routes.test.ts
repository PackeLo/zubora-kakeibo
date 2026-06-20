import { describe, expect, it } from "vitest";
import { createApiApp } from "@back/adapters/http/app";
import { InMemoryUnitOfWork } from "@back/adapters/memory/InMemoryRepositories";
import type { Env } from "@back/worker/bindings";

function createTestApp() {
  const repos = new InMemoryUnitOfWork();
  const app = createApiApp(() => repos);
  const env: Env = {
    DB: {} as D1Database,
    GPT_ACTION_TOKEN: "token",
    LIVE_COMPLETED_YEARS_TO_KEEP: "3"
  };
  return { app, env, repos };
}

describe("routes", () => {
  it("requires web authentication for normal API on production hosts", async () => {
    const { app, env } = createTestApp();
    const response = await app.request("https://app.example.test/api/taxonomy", {}, env);
    expect(response.status).toBe(401);
  });

  it("rejects action calls without token", async () => {
    const { app, env } = createTestApp();
    const response = await app.request("/api/action/taxonomy", {}, env);
    expect(response.status).toBe(401);
  });

  it("creates action entry source with token", async () => {
    const { app, env } = createTestApp();
    const response = await app.request(
      "/api/action/entry-sources",
      {
        method: "POST",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "receipt",
          items: [{ entryType: "expense", entryDate: "2026-06-20", amount: 1000 }]
        })
      },
      env
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { createdEntrySourceItemIds: string[] };
    expect(payload.createdEntrySourceItemIds).toHaveLength(1);
  });

  it("requires limit for action entries insight", async () => {
    const { app, env } = createTestApp();
    const response = await app.request(
      "/api/action/insights/entries?from=2026-06-01&to=2026-06-30",
      { headers: { Authorization: "Bearer token" } },
      env
    );
    expect(response.status).toBe(400);
  });

  it("limits action entry insight date ranges", async () => {
    const { app, env } = createTestApp();
    const response = await app.request(
      "/api/action/insights/entries?from=2024-01-01&to=2026-01-31&limit=10",
      { headers: { Authorization: "Bearer token" } },
      env
    );
    expect(response.status).toBe(400);
  });

  it("maps domain validation errors to bad request", async () => {
    const { app, env } = createTestApp();
    const response = await app.request(
      "https://app.example.test/api/entries",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cf-Access-Authenticated-User-Email": "user@example.test",
          "Cf-Access-Jwt-Assertion": "jwt"
        },
        body: JSON.stringify({
          entryType: "expense",
          entryDate: "2026-02-31",
          amount: 1000,
          subjectUserId: "usr_user_example_test",
          categoryId: "cat_missing",
          tagIds: []
        })
      },
      env
    );
    expect(response.status).toBe(400);
  });
});
