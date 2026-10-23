import { AuthorizationError, CimdFetchError, type ConsentDescription } from "@cloudflare/workers-oauth-provider";
import { AppError } from "../../application/errors";
import type { Env } from "../../worker/bindings";
import type { UnitOfWork } from "../../ports/repositories";
import { createUseCases } from "../../worker/bootstrap";
import { actorFromIdentity, verifiedAccessIdentity } from "./auth";
import { assertGrantScopes, scopeDescriptions, type KakeiboScope } from "./scopes";
import { sha256Hex } from "../../domain/crypto";

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function consentPage(details: ConsentDescription, handle: string, email: string): string {
  const scopes = details.scope.map((scope) => `<label><input type="checkbox" name="scope" value="${escape(scope)}" checked> ${escape(scopeDescriptions[scope as KakeiboScope] ?? scope)}</label>`).join("<br>");
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>家計簿への接続を許可</title>
<body><main><h1>家計簿への接続を許可</h1><p>ログイン中：${escape(email)}</p>
<p>アプリ：${escape(details.clientName)}</p>
<p>${details.clientDomain ? `提供元：${escape(details.clientDomain)}` : "提供元の名前は未確認です。"}</p>
<p>接続先：${escape(details.redirectHost)}</p>
${details.redirectIsLoopback ? "<p>この端末上のアプリへの接続です。自分で開始した操作か確認してください。</p>" : ""}
<form method="post" action="/authorize"><input type="hidden" name="handle" value="${escape(handle)}">${scopes}
<p><button name="decision" value="approve">許可する</button> <button name="decision" value="deny">拒否する</button></p></form>
<p>取り込んだ明細の確定は管理画面で行います。</p></main></body></html>`;
}

export async function handleConsent(request: Request, env: Env, repositories: UnitOfWork): Promise<Response> {
  try {
    const oauth = env.OAUTH_PROVIDER;
    const kv = env.OAUTH_KV;
    if (!oauth || !kv) return new Response("OAuth is not configured", { status: 503 });
    const identity = await verifiedAccessIdentity(request, env);
    const actor = actorFromIdentity(identity, env);
    if (request.method === "GET") {
      const authRequest = await oauth.parseAuthRequest(request);
      assertGrantScopes(authRequest.scope, actor);
      const details = await oauth.describeConsent(authRequest);
      const consent = await oauth.beginConsent(authRequest);
      await kv.put(`household-consent:${await sha256Hex(consent.handle)}`, identity.sub, { expirationTtl: 600 });
      consent.headers.set("Content-Type", "text/html; charset=utf-8");
      consent.headers.set("Cache-Control", "no-store");
      return new Response(consentPage(details, consent.handle, actor.displayName), { headers: consent.headers });
    }
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "GET, POST" } });
    const form = await request.formData();
    const handle = String(form.get("handle") ?? "");
    const identityKey = `household-consent:${await sha256Hex(handle)}`;
    if (await kv.get(identityKey) !== identity.sub) {
      throw new AppError("VALIDATION_ERROR", "接続要求が期限切れか、ログインしている利用者が変わりました。接続をやり直してください。");
    }
    if (form.get("decision") === "deny") {
      const denied = await oauth.denyConsent(request, handle);
      await kv.delete(identityKey);
      denied.headers.set("Cache-Control", "no-store");
      return new Response(null, { status: 302, headers: denied.headers });
    }
    if (form.get("decision") !== "approve") throw new AppError("VALIDATION_ERROR", "接続の許可または拒否を選んでください。");
    const scopes = form.getAll("scope").map(String);
    assertGrantScopes(scopes, actor);
    const approved = await oauth.approveConsent(request, handle, { scope: scopes });
    await kv.delete(identityKey);
    assertGrantScopes(approved.request.scope, actor);
    await createUseCases(repositories, env).currentUser(actor);
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: actor.id,
      metadata: {},
      scope: approved.request.scope,
      props: identity
    });
    approved.headers.set("Location", redirectTo);
    approved.headers.set("Cache-Control", "no-store");
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AppError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      return new Response("接続要求が無効か期限切れです。ChatGPTから接続をやり直してください。", { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    throw error;
  }
}
