import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { principalForPerson, reassignPosition, type Principal } from "../auth/service.js";
import { withPerson } from "../db/context.js";
import { ensureStandardTemplates } from "../boards/service.js";
import { ensureStandardIncidentTemplates } from "../incidents/service.js";
import {
  archiveForIncident,
  configureBackend,
  postAnnouncement,
  provisionForIncident,
  syncIncidentMembership,
} from "../collab/service.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../collab/adapters.js";
import { freshDb, seedIdentity, type Sql } from "./helpers.js";

/**
 * Collaboration adapters and incident spaces (F15/R6). Activation
 * against a fake Mattermost and a fake Matrix backend yields the channel
 * structure with membership drawn from position holders; reassignment moves
 * membership; announcements post; deactivation archives; and with no backend
 * the platform degrades to in-app notifications only.
 */

// ---- Fake Mattermost (v4) backend as an in-memory transport ---------------
class FakeMattermost {
  teamsByName = new Map<string, string>();
  channels = new Map<string, { teamId: string; name: string; members: Set<string> }>();
  channelByKey = new Map<string, string>();
  usersByEmail = new Map<string, string>();
  posts: Array<{ channelId: string; message: string }> = [];
  archivedTeams = new Set<string>();
  private seq = 0;

  user(email: string): string {
    const id = `u-${this.usersByEmail.size + 1}`;
    this.usersByEmail.set(email, id);
    return id;
  }
  private id(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }
  transport: HttpTransport = async (req: HttpRequest): Promise<HttpResponse> => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const body = req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};
    const seg = path.split("/").filter(Boolean); // ["api","v4",...]
    const ok = (obj: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(obj) });
    const notFound = (): HttpResponse => ({ status: 404, body: "{}" });

    if (req.method === "POST" && path === "/api/v4/teams") {
      const name = body.name as string;
      if (this.teamsByName.has(name)) return { status: 400, body: "{}" };
      const id = this.id("team");
      this.teamsByName.set(name, id);
      return ok({ id });
    }
    if (req.method === "GET" && seg[2] === "teams" && seg[3] === "name") {
      const id = this.teamsByName.get(seg[4]!);
      return id ? ok({ id }) : notFound();
    }
    if (req.method === "POST" && path === "/api/v4/channels") {
      const key = `${body.team_id as string}:${body.name as string}`;
      if (this.channelByKey.has(key)) return { status: 400, body: "{}" };
      const id = this.id("chan");
      this.channelByKey.set(key, id);
      this.channels.set(id, { teamId: body.team_id as string, name: body.name as string, members: new Set() });
      return ok({ id });
    }
    if (req.method === "GET" && seg[2] === "teams" && seg[4] === "channels" && seg[5] === "name") {
      const id = this.channelByKey.get(`${seg[3]}:${seg[6]}`);
      return id ? ok({ id }) : notFound();
    }
    if (req.method === "GET" && seg[2] === "users" && seg[3] === "email") {
      const id = this.usersByEmail.get(seg[4]!);
      return id ? ok({ id }) : notFound();
    }
    if (req.method === "GET" && seg[2] === "channels" && seg[4] === "members") {
      const ch = this.channels.get(seg[3]!);
      return ok([...(ch?.members ?? [])].map((user_id) => ({ user_id })));
    }
    if (req.method === "POST" && seg[2] === "channels" && seg[4] === "members") {
      this.channels.get(seg[3]!)?.members.add(body.user_id as string);
      return ok({});
    }
    if (req.method === "DELETE" && seg[2] === "channels" && seg[4] === "members") {
      this.channels.get(seg[3]!)?.members.delete(seg[5]!);
      return ok({});
    }
    if (req.method === "POST" && path === "/api/v4/posts") {
      this.posts.push({ channelId: body.channel_id as string, message: body.message as string });
      return ok({ id: this.id("post") });
    }
    if (req.method === "DELETE" && seg[2] === "teams") {
      this.archivedTeams.add(seg[3]!);
      return ok({});
    }
    return notFound();
  };

  channelByName(name: string): { members: Set<string> } | undefined {
    for (const ch of this.channels.values()) if (ch.name === name) return ch;
    return undefined;
  }
}

// ---- Fake Matrix (client-server v3) backend -------------------------------
class FakeMatrix {
  rooms = new Map<string, { name: string; members: Map<string, string>; archived: boolean }>();
  aliasToRoom = new Map<string, string>();
  spaceChildren: Array<{ spaceId: string; childId: string }> = [];
  messages: Array<{ roomId: string; body: string }> = [];
  private seq = 0;
  private id(): string {
    this.seq += 1;
    return `!room${this.seq}:example.org`;
  }
  transport: HttpTransport = async (req: HttpRequest): Promise<HttpResponse> => {
    const path = decodeURIComponent(new URL(req.url).pathname);
    const body = req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};
    const seg = path.split("/").filter(Boolean);
    const ok = (obj: unknown): HttpResponse => ({ status: 200, body: JSON.stringify(obj) });

    if (req.method === "POST" && path.endsWith("/createRoom")) {
      const alias = body.room_alias_name as string;
      if (alias && this.aliasToRoom.has(alias)) return ok({ room_id: this.aliasToRoom.get(alias) });
      const roomId = this.id();
      this.rooms.set(roomId, { name: (body.name as string) ?? "", members: new Map(), archived: false });
      if (alias) this.aliasToRoom.set(alias, roomId);
      return ok({ room_id: roomId });
    }
    // /_matrix/client/v3/rooms/{roomId}/...
    const roomsIdx = seg.indexOf("rooms");
    const roomId = roomsIdx >= 0 ? seg[roomsIdx + 1]! : "";
    const tail = seg.slice(roomsIdx + 2);
    if (req.method === "GET" && tail[0] === "members") {
      const room = this.rooms.get(roomId);
      const chunk = [...(room?.members ?? new Map()).entries()].map(([state_key, membership]) => ({
        type: "m.room.member",
        state_key,
        content: { membership },
      }));
      return ok({ chunk });
    }
    if (req.method === "POST" && tail[0] === "invite") {
      this.rooms.get(roomId)?.members.set(body.user_id as string, "invite");
      return ok({});
    }
    if (req.method === "POST" && tail[0] === "kick") {
      this.rooms.get(roomId)?.members.delete(body.user_id as string);
      return ok({});
    }
    if (req.method === "PUT" && tail[0] === "send") {
      this.messages.push({ roomId, body: body.body as string });
      return ok({ event_id: `$e${this.seq++}` });
    }
    if (req.method === "PUT" && tail[0] === "state" && tail[1] === "m.space.child") {
      this.spaceChildren.push({ spaceId: roomId, childId: tail[2]! });
      return ok({});
    }
    if (req.method === "PUT" && tail[0] === "state" && tail[1] === "m.room.tombstone") {
      const room = this.rooms.get(roomId);
      if (room) room.archived = true;
      return ok({});
    }
    return { status: 404, body: "{}" };
  };
  roomByAlias(alias: string): { members: Map<string, string>; archived: boolean } | undefined {
    const id = this.aliasToRoom.get(alias);
    return id ? this.rooms.get(id) : undefined;
  }
}

let admin: Sql;
let runtime: Sql;
let app: FastifyInstance;
let jurisdictionId: string;
let adminId: string;
let adminToken: string;
let adminPrincipal: Principal;
let incidentId: string;
let priorKey: string | undefined;
const persons = new Map<string, string>(); // email -> id
const positionIdByKey = new Map<string, string>();

async function post(url: string, payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url,
    headers: { authorization: `Bearer ${adminToken}` },
    payload,
  });
}

async function createPersonViaApi(email: string): Promise<string> {
  const res = await post("/api/v1/persons", {
    email,
    displayName: email.split("@")[0],
    password: "correct-horse-battery",
    jurisdictionId,
    role: "member",
  });
  if (res.statusCode !== 201) throw new Error(`create person failed: ${res.statusCode} ${res.body}`);
  const id = res.json().id as string;
  persons.set(email, id);
  return id;
}

beforeAll(async () => {
  priorKey = process.env.OPENEOC_SECRET_KEY;
  process.env.OPENEOC_SECRET_KEY = "test-only-collab-key";
  const db = await freshDb();
  admin = db.admin;
  runtime = db.runtime;
  const seed = await seedIdentity(admin);
  jurisdictionId = seed.jurisdictionId;
  adminId = seed.adminId;
  await ensureStandardTemplates(admin);
  await ensureStandardIncidentTemplates(admin);
  app = buildApp(runtime, { oidc: null });
  await app.ready();
  adminToken = (
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "admin@example.org", password: "correct-horse-battery" },
    })
  ).json().accessToken as string;
  adminPrincipal = await principalForPerson(runtime, adminId);

  for (const email of ["ic@example.org", "ops1@example.org", "ops2@example.org", "plan@example.org"])
    await createPersonViaApi(email);

  // Activate an incident (no backend yet -> activation does not provision).
  const act = await post(`/api/v1/jurisdictions/${jurisdictionId}/incidents`, {
    templateKey: "wildfire",
    name: "Klamath Flood",
  });
  if (act.statusCode !== 201) throw new Error(`activate failed: ${act.statusCode} ${act.body}`);
  incidentId = act.json().incidentId as string;
  const detail = (
    await app.inject({
      method: "GET",
      url: `/api/v1/incidents/${incidentId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    })
  ).json();
  for (const p of detail.positions) positionIdByKey.set(p.key, p.id);

  // Assign holders (still no backend -> no external calls).
  await post(`/api/v1/positions/${positionIdByKey.get("incident_commander")}/assignments`, {
    personId: persons.get("ic@example.org"),
  });
  await post(`/api/v1/positions/${positionIdByKey.get("operations_section_chief")}/assignments`, {
    personId: persons.get("ops1@example.org"),
  });
  await post(`/api/v1/positions/${positionIdByKey.get("planning_section_chief")}/assignments`, {
    personId: persons.get("plan@example.org"),
  });
}, 60000);

afterAll(async () => {
  if (app) await app.close();
  if (runtime) await runtime.end();
  if (admin) await admin.end();
  if (priorKey === undefined) delete process.env.OPENEOC_SECRET_KEY;
  else process.env.OPENEOC_SECRET_KEY = priorKey;
});

async function configure(kind: "mattermost" | "matrix", baseUrl: string, homeserver?: string): Promise<void> {
  await withPerson(runtime, adminId, (tx) =>
    configureBackend(tx, adminPrincipal, jurisdictionId, {
      kind,
      baseUrl,
      token: "bot-token",
      enabled: true,
      ...(homeserver ? { homeserver } : {}),
    }),
  );
}

describe("no backend configured", () => {
  it("degrades provisioning to in-app notifications for the holders", async () => {
    const result = await withPerson(runtime, adminId, (tx) =>
      provisionForIncident(tx, adminPrincipal, incidentId, async () => ({ status: 500, body: "{}" })),
    );
    expect(result.degraded).toBe(true);
    const rows = await admin`
      select count(*)::int as n from notifications
      where channel = 'collab' and jurisdiction_id = ${jurisdictionId}`;
    // Three holders are notified; no channels created anywhere.
    expect(rows[0]!.n).toBe(3);
    const spaces = await admin`select count(*)::int as n from collab_spaces`;
    expect(spaces[0]!.n).toBe(0);
  });
});

describe("Mattermost adapter", () => {
  const mm = new FakeMattermost();

  it("provisions the incident space with per-section channels and membership", async () => {
    for (const e of ["ic@example.org", "ops1@example.org", "ops2@example.org", "plan@example.org"])
      mm.user(e);
    await configure("mattermost", "https://mm.example.org");
    const result = await withPerson(runtime, adminId, (tx) =>
      provisionForIncident(tx, adminPrincipal, incidentId, mm.transport),
    );
    expect(result.degraded).toBe(false);
    expect(result.backend).toBe("mattermost");
    // all + command + operations + planning + logistics + finance_admin.
    expect(result.channels).toBe(6);

    const all = mm.channelByName("klamath-flood-all")!;
    expect(all.members).toEqual(
      new Set([mm.usersByEmail.get("ic@example.org"), mm.usersByEmail.get("ops1@example.org"), mm.usersByEmail.get("plan@example.org")]),
    );
    const ops = mm.channelByName("klamath-flood-operations")!;
    expect(ops.members).toEqual(new Set([mm.usersByEmail.get("ops1@example.org")]));
    const logistics = mm.channelByName("klamath-flood-logistics")!;
    expect(logistics.members.size).toBe(0);

    // The desired membership is mirrored locally for audit and diffing:
    // all(ic,ops1,plan)=3 + command(ic)=1 + operations(ops1)=1 + planning(plan)=1.
    const mirror = await admin`select count(*)::int as n from collab_channel_members`;
    expect(mirror[0]!.n).toBe(6);
  });

  it("tracks reassignment: the new holder replaces the old in the channels", async () => {
    await withPerson(runtime, adminId, (tx) =>
      reassignPosition(tx, adminPrincipal, positionIdByKey.get("operations_section_chief")!, persons.get("ops2@example.org")!),
    );
    const sync = await withPerson(runtime, adminId, (tx) =>
      syncIncidentMembership(tx, adminPrincipal, incidentId, mm.transport),
    );
    expect(sync.added).toBeGreaterThanOrEqual(1);
    expect(sync.removed).toBeGreaterThanOrEqual(1);
    const ops = mm.channelByName("klamath-flood-operations")!;
    expect(ops.members).toEqual(new Set([mm.usersByEmail.get("ops2@example.org")]));
    const all = mm.channelByName("klamath-flood-all")!;
    expect(all.members.has(mm.usersByEmail.get("ops1@example.org")!)).toBe(false);
    expect(all.members.has(mm.usersByEmail.get("ops2@example.org")!)).toBe(true);
  });

  it("posts a platform announcement into a section channel", async () => {
    const res = await withPerson(runtime, adminId, (tx) =>
      postAnnouncement(tx, adminPrincipal, incidentId, "operations", "Levee overtopping reported", mm.transport),
    );
    expect(res.degraded).toBe(false);
    const ops = mm.channelByName("klamath-flood-operations")!;
    const opsChannelId = [...mm.channels.entries()].find(([, c]) => c === ops)![0];
    expect(mm.posts.some((p) => p.channelId === opsChannelId && p.message.includes("Levee"))).toBe(true);
  });
});

describe("Matrix adapter", () => {
  const mx = new FakeMatrix();

  it("provisions rooms under a space with invited members", async () => {
    await configure("matrix", "https://matrix.example.org", "example.org");
    const result = await withPerson(runtime, adminId, (tx) =>
      provisionForIncident(tx, adminPrincipal, incidentId, mx.transport),
    );
    expect(result.backend).toBe("matrix");
    const all = mx.roomByAlias("klamath-flood-all")!;
    expect(new Set(all.members.keys())).toEqual(
      new Set(["@ic:example.org", "@ops2:example.org", "@plan:example.org"]),
    );
    // Each channel room was linked under the incident space.
    expect(mx.spaceChildren.length).toBe(6);
  });

  it("archives the space on deactivation", async () => {
    await withPerson(runtime, adminId, (tx) => archiveForIncident(tx, adminPrincipal, incidentId, mx.transport));
    const [space] = await admin`select status from collab_spaces where incident_id = ${incidentId}`;
    expect(space!.status).toBe("archived");
  });
});
