import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { vi } from "vitest";

export async function accessFixture() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const issuer = `https://test-${crypto.randomUUID()}.cloudflareaccess.com`;
  const audience = "test-application";
  const key = { ...await exportJWK(publicKey), kid: "access-test-key", alg: "RS256", use: "sig" };
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input) !== `${issuer}/cdn-cgi/access/certs`) throw new Error(`unexpected URL: ${input}`);
    return Response.json({ keys: [key] });
  });
  return {
    issuer,
    audience,
    fetchMock,
    env: { CF_ACCESS_TEAM_DOMAIN: issuer, CF_ACCESS_AUD: audience, ADMIN_EMAILS: "admin@example.test", HOUSEHOLD_EMAILS: "admin@example.test,member@example.test" },
    async headers(overrides: JWTPayload = {}) {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({
        sub: "test-user",
        email: "admin@example.test",
        iss: issuer,
        aud: audience,
        iat: now,
        exp: now + 300,
        ...overrides
      }).setProtectedHeader({ alg: "RS256", kid: key.kid }).sign(privateKey);
      return { "Cf-Access-Jwt-Assertion": token };
    }
  };
}
