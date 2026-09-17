import Fastify, { type FastifyInstance } from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

const CLIENT_ID = "openeoc-test";

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let issuer: FastifyInstance;
let issuerUrl: string;

/**
 * Minimal OIDC issuer for the test: discovery, JWKS, and a token endpoint.
 * The authorization code carries `nonce|email` so the token endpoint can
 * mint an ID token for the identity the test intends, the way a real IdP
 * would after its login UI.
 */
async function startFakeIssuer(): Promise<void> {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  issuer = Fastify({ logger: false });
  issuer.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  issuer.get("/.well-known/openid-configuration", (_req, reply) =>
    reply.send({
      issuer: issuerUrl,
      authorization_endpoint: `${issuerUrl}/auth`,
      token_endpoint: `${issuerUrl}/token`,
      jwks_uri: `${issuerUrl}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
    }),
  );
  issuer.get("/jwks", (_req, reply) => reply.send({ keys: [jwk] }));
  issuer.post("/token", async (req, reply) => {
    const body = req.body as Record<string, string>;
    const [nonce, email] = String(body.code ?? "").split("|");
    const idToken = await new SignJWT({ nonce, email })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(issuerUrl)
      .setAudience(CLIENT_ID)
      .setSubject(`sub-${email}`)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return reply.send({
      access_token: "test-access",
      token_type: "Bearer",
      expires_in: 300,
      id_token: idToken,
    });
  });
  await issuer.listen({ port: 0, host: "127.0.0.1" });
  const address = issuer.server.address();
  issuerUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  await seedIdentity(admin);
  issuerUrl = "http://127.0.0.1:0";
  await startFakeIssuer();
  app = buildApp(runtime, {
    oidc: {
      issuer: issuerUrl,
      clientId: CLIENT_ID,
      clientSecret: "test-secret",
      redirectUri: "http://client.local/api/v1/auth/oidc/callback",
      allowHttp: true,
    },
  });
});

afterAll(async () => {
  await app.close();
  await issuer.close();
  await runtime.end();
  await admin.end();
});

async function runFlow(email: string) {
  const start = await app.inject({ method: "GET", url: "/api/v1/auth/oidc/start" });
  expect(start.statusCode).toBe(200);
  const authUrl = new URL(start.json().authorizationUrl as string);
  expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
  const state = authUrl.searchParams.get("state")!;
  const nonce = authUrl.searchParams.get("nonce")!;
  const code = encodeURIComponent(`${nonce}|${email}`);
  return app.inject({
    method: "GET",
    url: `/api/v1/auth/oidc/callback?code=${code}&state=${encodeURIComponent(state)}`,
  });
}

describe("OIDC login", () => {
  it("a provisioned person logs in through the code flow and gets a session", async () => {
    const res = await runFlow("admin@example.org");
    expect(res.statusCode).toBe(200);
    const { accessToken } = res.json();
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().person.email).toBe("admin@example.org");
    const [identity] = await admin`
      select person_id from person_identities where subject = ${"sub-admin@example.org"}`;
    expect(identity).toBeTruthy();
  });

  it("an identity with no provisioned person is refused", async () => {
    const res = await runFlow("stranger@example.org");
    expect(res.statusCode).toBe(403);
  });

  it("a forged or replayed state is refused", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/oidc/callback?code=x%7Cadmin%40example.org&state=forged",
    });
    expect(res.statusCode).toBe(401);
  });
});
