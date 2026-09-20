import { randomBytes } from "node:crypto";
import * as client from "openid-client";
import type { Sql } from "../db/client.js";
import { AuthError, createSession, type LoginResult } from "./service.js";

export interface OidcSettings {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  /** Test-only: permit http issuers (the fake issuer in the test suite). */
  readonly allowHttp?: boolean;
}

export function oidcSettingsFromEnv(): OidcSettings | null {
  const issuer = process.env.OPENEOC_OIDC_ISSUER;
  if (!issuer) return null;
  return {
    issuer,
    clientId: process.env.OPENEOC_OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OPENEOC_OIDC_CLIENT_SECRET ?? "",
    redirectUri: process.env.OPENEOC_OIDC_REDIRECT_URI ?? "",
    allowHttp: process.env.OPENEOC_OIDC_ALLOW_HTTP === "1",
  };
}

interface PendingLogin {
  state: string;
  nonce: string;
  verifier: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

export class OidcClient {
  private config: client.Configuration | null = null;
  private pending = new Map<string, PendingLogin>();

  constructor(private readonly settings: OidcSettings) {}

  private async configuration(): Promise<client.Configuration> {
    if (this.config) return this.config;
    this.config = await client.discovery(
      new URL(this.settings.issuer),
      this.settings.clientId,
      this.settings.clientSecret,
      undefined,
      this.settings.allowHttp ? { execute: [client.allowInsecureRequests] } : undefined,
    );
    return this.config;
  }

  /** Begin the code flow: PKCE verifier, state, and nonce are server-held. */
  async start(): Promise<{ authorizationUrl: string }> {
    const config = await this.configuration();
    const verifier = client.randomPKCECodeVerifier();
    const challenge = await client.calculatePKCECodeChallenge(verifier);
    const state = randomBytes(16).toString("base64url");
    const nonce = randomBytes(16).toString("base64url");
    this.pending.set(state, { state, nonce, verifier, createdAt: Date.now() });
    this.prune();
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: this.settings.redirectUri,
      scope: "openid email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    return { authorizationUrl: url.href };
  }

  /**
   * Complete the flow. Only provisioned persons may enter: the ID token's
   * identity must already be linked, or its email must match an existing
   * person (first login links it). Unknown identities are refused; OIDC
   * never creates accounts (threat row B11).
   */
  async callback(sql: Sql, callbackUrl: string): Promise<LoginResult> {
    const config = await this.configuration();
    const url = new URL(callbackUrl);
    const state = url.searchParams.get("state") ?? "";
    const pendingEntry = this.pending.get(state);
    if (!pendingEntry) throw new AuthError(401, "unknown or expired login attempt");
    this.pending.delete(state);
    const tokens = await client.authorizationCodeGrant(config, url, {
      pkceCodeVerifier: pendingEntry.verifier,
      expectedState: state,
      expectedNonce: pendingEntry.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (!claims) throw new AuthError(401, "no identity claims");
    const issuer = String(claims.iss);
    const subject = String(claims.sub);
    const email = typeof claims.email === "string" ? claims.email : null;

    // OIDC login resolves the person before any context exists, so identity
    // lookup, the email fallback and the link insert all go through the
    // SECURITY DEFINER helpers (0034) rather than direct table access.
    const [linked] = await sql`select resolve_identity(${issuer}, ${subject}) as person_id`;
    let personId = linked?.person_id as string | undefined;
    if (!personId && email) {
      const [person] = await sql`select id, disabled from find_person_by_email(${email})`;
      if (person && !person.disabled) {
        personId = person.id as string;
        await sql`select link_identity(${personId}, ${issuer}, ${subject})`;
      }
    }
    if (!personId) throw new AuthError(403, "identity not provisioned for this instance");
    return createSession(sql, personId);
  }

  private prune(): void {
    const cutoff = Date.now() - PENDING_TTL_MS;
    for (const [k, v] of this.pending) if (v.createdAt < cutoff) this.pending.delete(k);
  }
}
