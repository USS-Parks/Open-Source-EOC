import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createPerson } from "../auth/service.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import { auth, freshDb, seedIdentity, tokenFor, type Sql } from "./helpers.js";

/**
 * A live board socket is admitted once, when it joins. A guest whose grant is
 * revoked, or whose board belongs to an incident that is then locked, stops
 * hearing the board at once: the socket is told why and closed. A member on
 * the same board is not touched.
 */

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let host: string;
let jurisdictionId: string;
let guestId: string;
let fireId: string;
let boardId: string;
const tokens = {} as Record<"admin" | "member" | "guest", string>;

interface LiveSocket {
  readonly updates: () => number;
  readonly errors: string[];
  readonly closed: Promise<void>;
  readonly close: () => void;
}

/** Join the board as `token` and resolve once the full state has arrived. */
function join(token: string): Promise<LiveSocket> {
  const socket = new WebSocket(`ws://${host}/api/v1/sync/boards/${boardId}`);
  let updates = 0;
  const errors: string[] = [];
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  return new Promise((resolve, reject) => {
    socket.on("open", () => socket.send(JSON.stringify({ type: "auth", token })));
    socket.on("error", reject);
    socket.on("message", (raw: Buffer) => {
      const message = JSON.parse(raw.toString()) as { type: string; code?: string };
      if (message.type === "update") updates += 1;
      if (message.type === "error") errors.push(message.code ?? "");
      if (message.type === "state") resolve({ updates: () => updates, errors, closed, close: () => socket.close() });
      // Refused at join; once joined, this settles nothing.
      if (message.type === "error") reject(new Error(`refused: ${message.code}`));
    });
  });
}

async function write(entry: string): Promise<void> {
  const res = await app.inject({
    method: "POST", url: `/api/v1/boards/${boardId}/records?incidentId=${fireId}`,
    headers: auth(tokens.admin), payload: { entry },
  });
  expect(res.statusCode, res.body).toBe(201);
}

async function grant(): Promise<string> {
  const res = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/guests`, headers: auth(tokens.admin),
    payload: { personId: guestId, scopes: [`board:${boardId}:read`], expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().id as string;
}

const within = (closed: Promise<void>, ms = 3000) =>
  Promise.race([closed.then(() => "closed"), new Promise((resolve) => setTimeout(() => resolve("still open"), ms))]);

beforeAll(async () => {
  ({ admin, runtime } = await freshDb());
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  host = `127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  tokens.admin = await tokenFor(app, "admin@example.org", "correct-horse-battery");
  tokens.member = await tokenFor(app, "member@example.org", "another-good-password");
  guestId = await createPerson(admin, { email: "guest@example.org", displayName: "Guest", password: "guest-password-1" });
  tokens.guest = await tokenFor(app, "guest@example.org", "guest-password-1");
  const activated = await app.inject({
    method: "POST", url: `/api/v1/jurisdictions/${jurisdictionId}/incidents`, headers: auth(tokens.admin),
    payload: { templateKey: "wildfire", name: "Guest Fire" },
  });
  expect(activated.statusCode, activated.body).toBe(201);
  fireId = activated.json().incidentId as string;
  const detail = await app.inject({ method: "GET", url: `/api/v1/incidents/${fireId}`, headers: auth(tokens.admin) });
  boardId = (detail.json().boards as Array<{ id: string; title: string }>).find((b) => b.title === "Guest Fire: activity_log")!.id;
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtime?.end();
  await admin?.end();
});

describe("guest board sockets after access is withdrawn", () => {
  it("closes a guest's socket when the grant is revoked", async () => {
    const grantId = await grant();
    const guest = await join(tokens.guest);
    await write("Before revocation");
    await expect.poll(() => guest.updates()).toBe(1);

    const revoked = await app.inject({ method: "DELETE", url: `/api/v1/guests/${grantId}`, headers: auth(tokens.admin) });
    expect(revoked.statusCode).toBe(200);
    expect(await within(guest.closed)).toBe("closed");
    expect(guest.errors).toEqual(["auth_required"]);
    await write("After revocation");
    expect(guest.updates()).toBe(1);
  });

  it("closes a guest's socket when the board's incident is locked, and leaves a member's open", async () => {
    await grant();
    const guest = await join(tokens.guest);
    const member = await join(tokens.member);
    await write("Before lockdown");
    await expect.poll(() => guest.updates()).toBe(1);
    await expect.poll(() => member.updates()).toBe(1);

    const locked = await app.inject({ method: "POST", url: `/api/v1/incidents/${fireId}/lockdown`, headers: auth(tokens.admin) });
    expect(locked.statusCode, locked.body).toBe(200);
    expect(await within(guest.closed)).toBe("closed");
    expect(guest.errors).toEqual(["auth_required"]);
    await write("After lockdown");
    await expect.poll(() => member.updates()).toBe(2);
    expect(guest.updates()).toBe(1);
    expect(await within(member.closed, 200)).toBe("still open");
    member.close();
  });
});
