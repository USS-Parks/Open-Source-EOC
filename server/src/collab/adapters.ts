import { randomUUID } from "node:crypto";

/**
 * Collaboration backend adapters (F15, contract item 11). Each
 * adapter talks to its backend across a process boundary over the backend's
 * own HTTP API; no backend code is vendored, which keeps AGPL systems
 * (Mattermost) at arm's length. The transport is injected, so the same code
 * runs against a real server and against a fake backend in tests. Adapters
 * are idempotent: provisioning re-runs cleanly and membership is a diff.
 */

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}
export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}
export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

export interface AdapterConfig {
  readonly baseUrl: string;
  readonly token: string;
  /** Matrix homeserver domain (the part after the colon in a user id). */
  readonly homeserver?: string;
}

export interface MemberSyncResult {
  readonly added: readonly string[];
  readonly removed: readonly string[];
}

export interface CollabAdapter {
  readonly kind: string;
  /** Create (or find) the incident's space; return its backend id. */
  ensureSpace(name: string, displayName: string): Promise<string>;
  /** Create (or find) a channel within the space; return its backend id. */
  ensureChannel(spaceId: string, name: string, displayName: string): Promise<string>;
  /** Reconcile a channel's membership to exactly these emails. */
  setMembers(channelId: string, emails: readonly string[]): Promise<MemberSyncResult>;
  /** Post a platform announcement into a channel. */
  postAnnouncement(channelId: string, text: string): Promise<void>;
  /** Archive the incident's space on deactivation. */
  archiveSpace(spaceId: string): Promise<void>;
}

export class CollabBackendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function parse(body: string): Record<string, unknown> {
  try {
    return (JSON.parse(body || "{}") as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

/** Mattermost v4 adapter. */
export class MattermostAdapter implements CollabAdapter {
  readonly kind = "mattermost";
  constructor(
    private readonly cfg: AdapterConfig,
    private readonly transport: HttpTransport,
  ) {}

  private async call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<HttpResponse> {
    return this.transport({
      method,
      url: `${this.cfg.baseUrl}${path}`,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async ensureSpace(name: string, displayName: string): Promise<string> {
    const res = await this.call("POST", "/api/v4/teams", {
      name,
      display_name: displayName,
      type: "O",
    });
    if (res.status >= 200 && res.status < 300) return parse(res.body).id as string;
    const found = await this.call("GET", `/api/v4/teams/name/${name}`);
    if (found.status >= 200 && found.status < 300) return parse(found.body).id as string;
    throw new CollabBackendError(res.status, `mattermost team create failed: ${res.body}`);
  }

  async ensureChannel(spaceId: string, name: string, displayName: string): Promise<string> {
    const res = await this.call("POST", "/api/v4/channels", {
      team_id: spaceId,
      name,
      display_name: displayName,
      type: "P",
    });
    if (res.status >= 200 && res.status < 300) return parse(res.body).id as string;
    const found = await this.call("GET", `/api/v4/teams/${spaceId}/channels/name/${name}`);
    if (found.status >= 200 && found.status < 300) return parse(found.body).id as string;
    throw new CollabBackendError(res.status, `mattermost channel create failed: ${res.body}`);
  }

  private async userIdForEmail(email: string): Promise<string | null> {
    const res = await this.call("GET", `/api/v4/users/email/${encodeURIComponent(email)}`);
    if (res.status < 200 || res.status >= 300) return null;
    return (parse(res.body).id as string) ?? null;
  }

  async setMembers(channelId: string, emails: readonly string[]): Promise<MemberSyncResult> {
    const desired = new Map<string, string>(); // userId -> email
    for (const email of emails) {
      const uid = await this.userIdForEmail(email);
      if (uid) desired.set(uid, email);
    }
    const currentRes = await this.call("GET", `/api/v4/channels/${channelId}/members`);
    const current = new Set<string>();
    if (currentRes.status >= 200 && currentRes.status < 300) {
      const rows = JSON.parse(currentRes.body || "[]") as Array<{ user_id: string }>;
      for (const r of rows) current.add(r.user_id);
    }
    const added: string[] = [];
    const removed: string[] = [];
    for (const [uid, email] of desired) {
      if (!current.has(uid)) {
        await this.call("POST", `/api/v4/channels/${channelId}/members`, { user_id: uid });
        added.push(email);
      }
    }
    for (const uid of current) {
      if (!desired.has(uid)) {
        await this.call("DELETE", `/api/v4/channels/${channelId}/members/${uid}`);
        removed.push(uid);
      }
    }
    return { added, removed };
  }

  async postAnnouncement(channelId: string, text: string): Promise<void> {
    await this.call("POST", "/api/v4/posts", { channel_id: channelId, message: text });
  }

  async archiveSpace(spaceId: string): Promise<void> {
    await this.call("DELETE", `/api/v4/teams/${spaceId}`);
  }
}

/** Matrix client-server (v3) adapter. Rooms are channels; a space room groups them. */
export class MatrixAdapter implements CollabAdapter {
  readonly kind = "matrix";
  constructor(
    private readonly cfg: AdapterConfig,
    private readonly transport: HttpTransport,
  ) {}

  private homeserver(): string {
    return this.cfg.homeserver ?? new URL(this.cfg.baseUrl).hostname;
  }

  private userId(email: string): string {
    const localpart = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9._=-]/g, ".");
    return `@${localpart}:${this.homeserver()}`;
  }

  private async call(method: string, path: string, body?: unknown): Promise<HttpResponse> {
    return this.transport({
      method,
      url: `${this.cfg.baseUrl}${path}`,
      headers: {
        authorization: `Bearer ${this.cfg.token}`,
        "content-type": "application/json",
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  }

  async ensureSpace(name: string, displayName: string): Promise<string> {
    const res = await this.call("POST", "/_matrix/client/v3/createRoom", {
      name: displayName,
      room_alias_name: name,
      creation_content: { type: "m.space" },
    });
    if (res.status >= 200 && res.status < 300) return parse(res.body).room_id as string;
    throw new CollabBackendError(res.status, `matrix space create failed: ${res.body}`);
  }

  async ensureChannel(spaceId: string, name: string, displayName: string): Promise<string> {
    const res = await this.call("POST", "/_matrix/client/v3/createRoom", {
      name: displayName,
      room_alias_name: name,
    });
    if (res.status < 200 || res.status >= 300)
      throw new CollabBackendError(res.status, `matrix room create failed: ${res.body}`);
    const roomId = parse(res.body).room_id as string;
    // Link the room under the incident space.
    await this.call(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(spaceId)}/state/m.space.child/${encodeURIComponent(roomId)}`,
      { via: [this.homeserver()] },
    );
    return roomId;
  }

  async setMembers(channelId: string, emails: readonly string[]): Promise<MemberSyncResult> {
    const desired = new Map<string, string>(); // userId -> email
    for (const email of emails) desired.set(this.userId(email), email);
    const room = encodeURIComponent(channelId);
    const currentRes = await this.call("GET", `/_matrix/client/v3/rooms/${room}/members`);
    const current = new Set<string>();
    if (currentRes.status >= 200 && currentRes.status < 300) {
      const chunk = (parse(currentRes.body).chunk as Array<{
        state_key: string;
        content?: { membership?: string };
      }>) ?? [];
      for (const e of chunk)
        if (e.content?.membership === "join" || e.content?.membership === "invite")
          current.add(e.state_key);
    }
    const added: string[] = [];
    const removed: string[] = [];
    for (const [uid, email] of desired) {
      if (!current.has(uid)) {
        await this.call("POST", `/_matrix/client/v3/rooms/${room}/invite`, { user_id: uid });
        added.push(email);
      }
    }
    for (const uid of current) {
      if (!desired.has(uid)) {
        await this.call("POST", `/_matrix/client/v3/rooms/${room}/kick`, {
          user_id: uid,
          reason: "no longer holds an incident position",
        });
        removed.push(uid);
      }
    }
    return { added, removed };
  }

  async postAnnouncement(channelId: string, text: string): Promise<void> {
    const room = encodeURIComponent(channelId);
    await this.call(
      "PUT",
      `/_matrix/client/v3/rooms/${room}/send/m.room.message/${randomUUID()}`,
      { msgtype: "m.text", body: text },
    );
  }

  async archiveSpace(spaceId: string): Promise<void> {
    const room = encodeURIComponent(spaceId);
    await this.call("PUT", `/_matrix/client/v3/rooms/${room}/state/m.room.tombstone/`, {
      body: "incident closed",
      replacement_room: "",
    });
  }
}

export function adapterFor(
  kind: string,
  cfg: AdapterConfig,
  transport: HttpTransport,
): CollabAdapter {
  if (kind === "mattermost") return new MattermostAdapter(cfg, transport);
  if (kind === "matrix") return new MatrixAdapter(cfg, transport);
  throw new CollabBackendError(400, `unknown collaboration backend: ${kind}`);
}

/**
 * Default transport: a real HTTP call. The timeout covers the whole
 * exchange, body included, so an unresponsive backend fails the call
 * instead of holding it open.
 */
export const httpTransport = async (req: HttpRequest, timeoutMs = 15_000): Promise<HttpResponse> => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: { ...req.headers },
    ...(req.body !== undefined ? { body: req.body } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, body: await res.text() };
};
