import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Jitsi bridge helpers. A meeting is a room on a configured Jitsi
 * deployment; the platform mints the join URL and, when a JWT secret is
 * configured, a signed token that scopes the room to the incident audience
 * and marks moderators. The JWT is a standard HS256 token built here with
 * no external dependency, so nothing from Jitsi is vendored and the bridge
 * stays behind a process boundary.
 */

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export interface JitsiUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly moderator: boolean;
}

export interface JitsiTokenConfig {
  readonly appId: string;
  readonly secret: string;
  /** The Jitsi deployment host, used as the token's sub claim. */
  readonly domain: string;
}

/**
 * Mint a Jitsi JWT (HS256) for one join. Short-lived; scoped to a single
 * room; carries the joining user's identity and moderator flag.
 */
export function mintJitsiJwt(
  cfg: JitsiTokenConfig,
  room: string,
  user: JitsiUser,
  now: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    aud: "jitsi",
    iss: cfg.appId,
    sub: cfg.domain,
    room,
    iat: now,
    nbf: now - 5,
    exp: now + 4 * 60 * 60,
    context: {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        moderator: user.moderator,
      },
    },
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sig = base64url(createHmac("sha256", cfg.secret).update(signingInput).digest());
  return `${signingInput}.${sig}`;
}

/** Verify an HS256 Jitsi token and return its payload, or throw. */
export function verifyJitsiJwt(secret: string, token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, s] = parts as [string, string, string];
  const expected = base64url(createHmac("sha256", secret).update(`${h}.${p}`).digest());
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad signature");
  return JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Build the joinable meeting URL, embedding a JWT when one is supplied. */
export function buildMeetingUrl(baseUrl: string, room: string, jwt?: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const url = `${base}/${encodeURIComponent(room)}`;
  return jwt ? `${url}?jwt=${jwt}` : url;
}
