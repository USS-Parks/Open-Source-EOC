import type {
  FieldDef,
  ViewDef,
  ViewRecord,
  DashboardSnapshot,
  SitrepRow,
  IcsFormContent,
  IapDocument,
  FormDefinition,
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
export interface IncidentTemplateOption {
  readonly key: string;
  readonly title: string;
}
export interface ResourceRequestSummary {
  readonly id: string;
  readonly item: string;
  readonly quantity: number;
  readonly priority: string;
  readonly state: string;
}
export interface AarObservation {
  readonly capability: string;
  readonly kind: "strength" | "improvement";
  readonly observation: string;
  readonly recommendation: string | null;
}
export interface CorrectiveAction {
  readonly id: string;
  readonly capability: string;
  readonly recommendation: string;
  readonly owner: string | null;
  readonly dueDate: string | null;
  readonly status: string;
  readonly incidentId: string | null;
}
export interface ReunificationAnswer {
  readonly tag: string;
  readonly kind: string;
  readonly label: string;
  readonly latest: {
    readonly custodyState: string;
    readonly station: string | null;
    readonly location: string | null;
    readonly occurredAt: string;
  };
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
export interface SearchHit {
  readonly kind: "record" | "library" | "file" | "chronology";
  readonly id: string;
  readonly title: string;
}
export interface FileMetaRef {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly version: number;
}
export interface UploadResult {
  readonly id: string;
  readonly sha256: string;
  readonly version: number;
}

export interface PositionRef {
  readonly id: string;
  readonly key: string;
  readonly title: string;
}
export interface Thread {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly incidentId: string | null;
}
export interface Message {
  readonly id: string;
  readonly seq: number;
  readonly sender: string | null;
  readonly body: string;
  readonly at: string;
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
  createFeed(
    jurisdictionId: string,
    spec: {
      name: string;
      kind: "cap" | "geojson" | "georss" | "cot";
      url?: string;
      pollIntervalSeconds?: number;
      staleAfterSeconds?: number;
      push?: boolean;
    },
  ): Promise<{ id: string; ingestToken?: string }> {
    return this.request<{ id: string; ingestToken?: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/feeds`,
      spec as unknown as Record<string, unknown>,
    );
  }
  pollFeed(feedId: string): Promise<{ ingested?: number } & Record<string, unknown>> {
    return this.request<{ ingested?: number } & Record<string, unknown>>(
      "POST",
      `/api/v1/feeds/${feedId}/poll`,
    );
  }
  async listIncidents(jurisdictionId: string): Promise<IncidentSummary[]> {
    const r = await this.request<{ incidents: IncidentSummary[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
    );
    return r.incidents;
  }
  async listIncidentTemplates(): Promise<IncidentTemplateOption[]> {
    const r = await this.request<{ templates: IncidentTemplateOption[] }>(
      "GET",
      "/api/v1/incident-templates",
    );
    return r.templates;
  }
  activateIncident(
    jurisdictionId: string,
    body: { templateKey: string; name: string; kind?: "incident" | "daily_ops" | "planned_event" },
  ): Promise<{ incidentId: string }> {
    return this.request<{ incidentId: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
      body as unknown as Record<string, unknown>,
    );
  }
  closeIncident(incidentId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", `/api/v1/incidents/${incidentId}/close`);
  }
  getLockdown(jurisdictionId: string): Promise<{ locked: boolean }> {
    return this.request<{ locked: boolean }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/lockdown`,
    );
  }
  setLockdown(jurisdictionId: string, locked: boolean): Promise<{ locked: boolean }> {
    return this.request<{ locked: boolean }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/lockdown`,
      { locked },
    );
  }
  async listResourceRequests(jurisdictionId: string): Promise<ResourceRequestSummary[]> {
    const r = await this.request<{ requests: ResourceRequestSummary[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`,
    );
    return r.requests;
  }
  submitResourceRequest(
    jurisdictionId: string,
    body: { origin: "field" | "eoc"; item: string; quantity?: number; priority?: string; notes?: string },
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/resource-requests`,
      body as unknown as Record<string, unknown>,
    );
  }
  transitionResourceRequest(id: string, toState: string, note?: string): Promise<{ state: string }> {
    return this.request<{ state: string }>("POST", `/api/v1/resource-requests/${id}/transition`, {
      toState,
      ...(note ? { note } : {}),
    });
  }
  async listAarObservations(incidentId: string): Promise<AarObservation[]> {
    const r = await this.request<{ observations: AarObservation[] }>(
      "GET",
      `/api/v1/incidents/${incidentId}/aar/observations`,
    );
    return r.observations;
  }
  recordAarObservation(
    incidentId: string,
    body: { capability: string; kind: "strength" | "improvement"; observation: string; recommendation?: string },
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/v1/incidents/${incidentId}/aar/observations`,
      body as unknown as Record<string, unknown>,
    );
  }
  composeAar(
    incidentId: string,
    body: { overview: string; objectives?: readonly string[]; period?: string },
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      "POST",
      `/api/v1/incidents/${incidentId}/aar`,
      body as unknown as Record<string, unknown>,
    );
  }
  downloadAarPdf(aarId: string): Promise<Blob> {
    return this.requestBlob(`/api/v1/aar/${aarId}/pdf`);
  }
  async listCorrectiveActions(
    jurisdictionId: string,
    includeComplete = true,
  ): Promise<CorrectiveAction[]> {
    const r = await this.request<{ correctiveActions: CorrectiveAction[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions?includeComplete=${includeComplete}`,
    );
    return r.correctiveActions;
  }
  createCorrectiveAction(
    jurisdictionId: string,
    body: { capability: string; recommendation: string; incidentId?: string; dueDate?: string },
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`,
      body as unknown as Record<string, unknown>,
    );
  }
  setCorrectiveActionStatus(
    id: string,
    status: "open" | "in_progress" | "complete",
  ): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", `/api/v1/corrective-actions/${id}/status`, { status });
  }
  async listPositions(jurisdictionId: string): Promise<PositionRef[]> {
    const r = await this.request<{ positions: PositionRef[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/positions`,
    );
    return r.positions;
  }
  async listThreads(jurisdictionId: string): Promise<Thread[]> {
    const r = await this.request<{ threads: Thread[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/threads`,
    );
    return r.threads;
  }
  createThread(
    jurisdictionId: string,
    body: {
      kind: "direct" | "group";
      title?: string;
      incidentId?: string;
      members: ReadonlyArray<{ kind: "person" | "position"; id: string }>;
    },
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/threads`,
      body as unknown as Record<string, unknown>,
    );
  }
  async listMessages(threadId: string, after = 0): Promise<Message[]> {
    const r = await this.request<{ messages: Message[] }>(
      "GET",
      `/api/v1/threads/${threadId}/messages?after=${after}`,
    );
    return r.messages;
  }
  postMessage(threadId: string, body: string): Promise<{ id: string; deduplicated: boolean }> {
    return this.request<{ id: string; deduplicated: boolean }>(
      "POST",
      `/api/v1/threads/${threadId}/messages`,
      { body },
    );
  }
  async listForms(jurisdictionId: string): Promise<Array<{ key: string; version: number; title: string }>> {
    const r = await this.request<{ forms: Array<{ key: string; version: number; title: string }> }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/forms`,
    );
    return r.forms;
  }
  getForm(jurisdictionId: string, key: string): Promise<FormDefinition> {
    return this.request<FormDefinition>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/forms/${key}`,
    );
  }
  submitForm(
    key: string,
    body: { jurisdictionId: string; boardId: string; answers: Record<string, unknown> },
  ): Promise<{ recordId: string }> {
    return this.request<{ recordId: string }>(
      "POST",
      `/api/v1/forms/${key}/submit`,
      body as unknown as Record<string, unknown>,
    );
  }
  registerTrackedObject(
    jurisdictionId: string,
    body: { kind: string; label: string; tag?: string; station?: string; agency?: string; location?: string },
  ): Promise<{ id: string; tag: string }> {
    return this.request<{ id: string; tag: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/tracked-objects`,
      body as unknown as Record<string, unknown>,
    );
  }
  scanTrackedObject(
    jurisdictionId: string,
    body: { tag: string; custodyState: string; station?: string; location?: string; note?: string },
  ): Promise<{ eventId: string }> {
    return this.request<{ eventId: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/tracked-objects/scan`,
      body as unknown as Record<string, unknown>,
    );
  }
  async reunify(
    jurisdictionId: string,
    query: { tag?: string; label?: string },
  ): Promise<ReunificationAnswer[]> {
    const q = new URLSearchParams();
    if (query.tag) q.set("tag", query.tag);
    if (query.label) q.set("label", query.label);
    const r = await this.request<{ answers: ReunificationAnswer[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/reunification?${q.toString()}`,
    );
    return r.answers;
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
  downloadIapPdf(iapId: string): Promise<Blob> {
    return this.requestBlob(`/api/v1/iap/${iapId}/pdf`);
  }
  async searchJurisdiction(jurisdictionId: string, q: string): Promise<SearchHit[]> {
    const r = await this.request<{ hits: SearchHit[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/search?q=${encodeURIComponent(q)}`,
    );
    return r.hits;
  }
  uploadFile(
    jurisdictionId: string,
    body: {
      name: string;
      contentType: string;
      dataBase64: string;
      attachedKind?: "none" | "board" | "incident" | "library";
      attachedId?: string;
    },
  ): Promise<UploadResult> {
    return this.request<UploadResult>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/files`,
      body as unknown as Record<string, unknown>,
    );
  }
  fileMeta(fileId: string): Promise<FileMetaRef> {
    return this.request<FileMetaRef>("GET", `/api/v1/files/${fileId}`);
  }
  downloadFile(fileId: string): Promise<Blob> {
    return this.requestBlob(`/api/v1/files/${fileId}/content`);
  }
  private async requestBlob(path: string): Promise<Blob> {
    const once = (): Promise<Response> => {
      const headers: Record<string, string> = {};
      if (this.accessToken) headers["authorization"] = `Bearer ${this.accessToken}`;
      return this.fetchImpl(`${this.baseUrl}${path}`, { method: "GET", headers });
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
