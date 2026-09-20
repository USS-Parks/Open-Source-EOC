import type {
  FieldDef,
  ViewDef,
  ViewRecord,
  DashboardSnapshot,
  SitrepRow,
  IcsFormContent,
  IapDocument,
} from "@openeoc/shared";
import type { CopFeatureCollection } from "../../cop/layers.js";

/**
 * The app shell's one door to the server. It carries the bearer access
 * token, renews it once against the resume token when a call comes back
 * 401 (the 15-minute access TTL is invisible to callers), and normalizes
 * the server's `{error}` envelope into a typed ApiError. Every screen
 * calls the typed helpers below; none touches fetch directly.
 */

export interface Membership {
  readonly jurisdictionId: string;
  readonly role: "admin" | "member" | "viewer";
}
export interface Me {
  readonly person: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly position:
    | { readonly id: string; readonly key: string; readonly title: string; readonly jurisdictionId: string }
    | null;
  readonly memberships: readonly Membership[];
  readonly sessionId: string;
}
export interface LoginResult {
  readonly accessToken: string;
  readonly resumeToken: string;
  readonly sessionId: string;
}
export interface Tokens {
  readonly accessToken: string;
  readonly resumeToken: string;
}

export interface BoardListItem {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly hasGeometry: boolean;
}
export interface DashboardListItem {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
}
export interface CollectionRef {
  readonly id: string;
  readonly title: string;
}
export interface SitrepListItem {
  readonly id: string;
  readonly period: string;
  readonly composedAt: string;
  readonly composedBy: string;
}
export interface RawNotification {
  readonly id: string;
  readonly channel: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly created_at: string;
  readonly read_at: string | null;
}
export interface EffectiveBoardResponse {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly role: "admin" | "member" | "viewer" | "guest";
  readonly fields: readonly FieldDef[];
  readonly views: readonly ViewDef[];
}
export interface ViewRecordsResponse {
  readonly view: string;
  readonly columns: readonly string[];
  readonly records: readonly ViewRecord[];
}
export interface LifelineCurrent {
  readonly lifeline: string;
  readonly status: string;
  readonly note: string | null;
  readonly at: string | null;
}
export interface FeedHealth {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly mode: "poll" | "push";
  readonly enabled: boolean;
  readonly stale: boolean;
  readonly ageSeconds: number | null;
}
export type FeedItemsResponse = CopFeatureCollection & { readonly feed: FeedHealth };
export interface IncidentSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly closedAt: string | null;
}
export interface IapResult {
  readonly id: string;
  readonly status: string;
  readonly operationalPeriod: string;
  readonly content: IapDocument;
}
export interface CreateIapBody {
  readonly operationalPeriod: string;
  readonly objectives?: readonly string[];
  readonly preparedBy?: string;
  readonly safetyMessage?: string;
  readonly formIds?: readonly string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export class SessionExpiredError extends Error {
  constructor() {
    super("session expired");
    this.name = "SessionExpiredError";
  }
}

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Persistence hook: called whenever the token pair changes (or clears). */
  readonly onTokens?: (tokens: Tokens | null) => void;
}

type Body = Record<string, unknown> | undefined;

export class ApiClient {
  private accessToken: string | null = null;
  private resumeToken: string | null = null;
  private refreshing: Promise<void> | null = null;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onTokens: ((tokens: Tokens | null) => void) | undefined;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "";
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init));
    this.onTokens = opts.onTokens;
  }

  setTokens(tokens: Tokens): void {
    this.accessToken = tokens.accessToken;
    this.resumeToken = tokens.resumeToken;
    this.onTokens?.(tokens);
  }
  clearTokens(): void {
    this.accessToken = null;
    this.resumeToken = null;
    this.onTokens?.(null);
  }
  hasSession(): boolean {
    return this.resumeToken !== null;
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const result = await this.raw<LoginResult>("POST", "/api/v1/auth/login", { email, password }, false);
    this.setTokens({ accessToken: result.accessToken, resumeToken: result.resumeToken });
    return result;
  }

  async resume(): Promise<void> {
    const resumeToken = this.resumeToken;
    if (!resumeToken) throw new SessionExpiredError();
    // Single-flight: many concurrent 401s share one renewal.
    if (!this.refreshing) {
      this.refreshing = this.raw<LoginResult>("POST", "/api/v1/auth/resume", { resumeToken }, false)
        .then((r) => this.setTokens({ accessToken: r.accessToken, resumeToken: r.resumeToken }))
        .finally(() => {
          this.refreshing = null;
        });
    }
    await this.refreshing;
  }

  async logout(): Promise<void> {
    try {
      if (this.accessToken) await this.raw("POST", "/api/v1/auth/logout", undefined, true);
    } finally {
      this.clearTokens();
    }
  }

  private async request<T>(method: string, path: string, body?: Body): Promise<T> {
    try {
      return await this.raw<T>(method, path, body, true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && this.resumeToken) {
        try {
          await this.resume();
        } catch {
          this.clearTokens();
          throw new SessionExpiredError();
        }
        return await this.raw<T>(method, path, body, true);
      }
      throw err;
    }
  }

  private async raw<T>(method: string, path: string, body: Body, auth: boolean): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && this.accessToken) headers["authorization"] = `Bearer ${this.accessToken}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
    if (!res.ok) {
      let message = res.statusText || `HTTP ${res.status}`;
      try {
        const parsed = (await res.json()) as { error?: unknown };
        if (parsed && typeof parsed.error === "string") message = parsed.error;
      } catch {
        // A non-JSON error body leaves the status-text message in place.
      }
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ---- Typed read/write helpers the screens use ----

  me(): Promise<Me> {
    return this.request<Me>("GET", "/api/v1/me");
  }
  async listBoards(jurisdictionId: string): Promise<BoardListItem[]> {
    const r = await this.request<{ boards: BoardListItem[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/boards`,
    );
    return r.boards;
  }
  async listDashboards(jurisdictionId: string): Promise<DashboardListItem[]> {
    const r = await this.request<{ dashboards: DashboardListItem[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/dashboards`,
    );
    return r.dashboards;
  }
  async listCollections(): Promise<CollectionRef[]> {
    const r = await this.request<{ collections: { id: string; title: string }[] }>(
      "GET",
      "/api/v1/ogc/collections",
    );
    return r.collections.map((c) => ({ id: c.id, title: c.title }));
  }
  collectionItems(boardId: string): Promise<CopFeatureCollection> {
    return this.request<CopFeatureCollection>(
      "GET",
      `/api/v1/ogc/collections/${boardId}/items`,
    );
  }
  getBoard(boardId: string): Promise<EffectiveBoardResponse> {
    return this.request<EffectiveBoardResponse>("GET", `/api/v1/boards/${boardId}`);
  }
  boardView(boardId: string, viewKey: string): Promise<ViewRecordsResponse> {
    return this.request<ViewRecordsResponse>(
      "GET",
      `/api/v1/boards/${boardId}/views/${viewKey}`,
    );
  }
  createRecord(boardId: string, data: Record<string, unknown>): Promise<{ id: string }> {
    return this.request<{ id: string }>("POST", `/api/v1/boards/${boardId}/records`, data);
  }
  dashboardData(dashboardId: string): Promise<DashboardSnapshot> {
    return this.request<DashboardSnapshot>("GET", `/api/v1/dashboards/${dashboardId}/data`);
  }
  async listSitreps(jurisdictionId: string): Promise<SitrepListItem[]> {
    const r = await this.request<{ sitreps: SitrepListItem[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/sitreps`,
    );
    return r.sitreps;
  }
  getSitrep(sitrepId: string): Promise<SitrepRow> {
    return this.request<SitrepRow>("GET", `/api/v1/sitreps/${sitrepId}`);
  }
  async lifelines(jurisdictionId: string): Promise<LifelineCurrent[]> {
    const r = await this.request<{ lifelines: LifelineCurrent[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/lifelines`,
    );
    return r.lifelines;
  }
  async notifications(): Promise<RawNotification[]> {
    const r = await this.request<{ notifications: RawNotification[] }>(
      "GET",
      "/api/v1/notifications",
    );
    return r.notifications;
  }
  markNotificationRead(id: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", `/api/v1/notifications/${id}/read`);
  }
  async listFeeds(jurisdictionId: string): Promise<FeedHealth[]> {
    const r = await this.request<{ feeds: FeedHealth[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/feeds`,
    );
    return r.feeds;
  }
  feedItems(feedId: string): Promise<FeedItemsResponse> {
    return this.request<FeedItemsResponse>("GET", `/api/v1/feeds/${feedId}/items`);
  }
  async listIncidents(jurisdictionId: string): Promise<IncidentSummary[]> {
    const r = await this.request<{ incidents: IncidentSummary[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    );
    return r.incidents;
  }
  getIcsForm(
    incidentId: string,
    formId: string,
    period: string,
    preparedBy?: string,
  ): Promise<IcsFormContent> {
    const q = new URLSearchParams({ period });
    if (preparedBy) q.set("preparedBy", preparedBy);
    return this.request<IcsFormContent>(
      "GET",
      `/api/v1/incidents/${incidentId}/ics-forms/${formId}?${q.toString()}`,
    );
  }
  createIap(incidentId: string, body: CreateIapBody): Promise<{ id: string; content: IapDocument }> {
    return this.request<{ id: string; content: IapDocument }>(
      "POST",
      `/api/v1/incidents/${incidentId}/iap`,
      body as unknown as Record<string, unknown>,
    );
  }
  getIap(iapId: string): Promise<IapResult> {
    return this.request<IapResult>("GET", `/api/v1/iap/${iapId}`);
  }
  approveIap(iapId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", `/api/v1/iap/${iapId}/approve`);
  }
  async downloadIapPdf(iapId: string): Promise<Blob> {
    const once = (): Promise<Response> => {
      const headers: Record<string, string> = {};
      if (this.accessToken) headers["authorization"] = `Bearer ${this.accessToken}`;
      return this.fetchImpl(`${this.baseUrl}/api/v1/iap/${iapId}/pdf`, { method: "GET", headers });
    };
    let res = await once();
    if (res.status === 401 && this.resumeToken) {
      try {
        await this.resume();
      } catch {
        this.clearTokens();
        throw new SessionExpiredError();
      }
      res = await once();
    }
    if (!res.ok) throw new ApiError(res.status, res.statusText || `HTTP ${res.status}`);
    return res.blob();
  }
}
