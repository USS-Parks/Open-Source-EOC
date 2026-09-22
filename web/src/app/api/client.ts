import type {
  FieldDef,
  ViewDef,
  ViewRecord,
  DashboardSnapshot,
  SitrepRow,
  IcsFormContent,
  IapDocument,
  FormDefinition,
  IncidentAreaRevision,
  IncidentAreaUpdate,
  IncidentParticipantGrant,
  IncidentParticipantGrantInput,
  DatasetStatus,
  DataPack,
  CatalogEntryStatus,
  SavedStateListPage,
  SavedStateRecord,
  SavedStateWrite,
  IncidentTask,
  TaskListQuery,
  TaskListResponse,
  TaskMetadataPatch,
  TaskCompletionReceipt,
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
export interface GuestGrant {
  readonly jurisdictionId: string;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
}
export interface Me {
  readonly person: { readonly id: string; readonly email: string; readonly displayName: string };
  readonly position:
    | { readonly id: string; readonly key: string; readonly title: string; readonly jurisdictionId: string }
    | null;
  readonly memberships: readonly Membership[];
  readonly guests: readonly GuestGrant[];
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
export type DatasetItemsPageResponse = CopFeatureCollection & {
  readonly page: { readonly limit: number; readonly offset: number; readonly returned: number; readonly hasMore: boolean };
};
export type DatasetItemsAggregate = CopFeatureCollection & {
  readonly incomplete: boolean;
  readonly pages: number;
};
export interface IncidentSummary {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly name: string;
  readonly kind: string;
  readonly closedAt: string | null;
  readonly canManageParticipation: boolean;
  readonly canEditArea: boolean;
}
export interface IncidentBoardRef {
  readonly id: string;
  readonly title: string;
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
  readonly capabilityElement: string;
  readonly kind: "strength" | "improvement";
  readonly observation: string;
  readonly recommendation: string | null;
}
export interface CorrectiveAction {
  readonly id: string;
  readonly capability: string;
  readonly capabilityElement: string;
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
export interface IapListItem {
  readonly id: string;
  readonly operationalPeriod: string;
  readonly status: string;
  readonly formCount: number;
  readonly targetForms: number;
  readonly preparedBy: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
  readonly createdAt: string;
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
  async listIncidentDashboards(
    jurisdictionId: string,
    incidentId: string,
  ): Promise<DashboardListItem[]> {
    const r = await this.request<{ dashboards: DashboardListItem[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/dashboards?incidentId=${encodeURIComponent(incidentId)}`,
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
  boardView(boardId: string, viewKey: string, incidentId?: string): Promise<ViewRecordsResponse> {
    return this.request<ViewRecordsResponse>(
      "GET",
      `/api/v1/boards/${boardId}/views/${viewKey}${incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : ""}`,
    );
  }
  createRecord(
    boardId: string,
    data: Record<string, unknown>,
    incidentId?: string,
  ): Promise<{ id: string }> {
    const query = incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : "";
    return this.request<{ id: string }>("POST", `/api/v1/boards/${boardId}/records${query}`, data);
  }
  async incidentBoardIds(incidentId: string): Promise<string[]> {
    const r = await this.request<{ boards: { id: string }[] }>(
      "GET",
      `/api/v1/incidents/${incidentId}`,
    );
    return r.boards.map((b) => b.id);
  }
  async incidentBoards(incidentId: string): Promise<IncidentBoardRef[]> {
    const r = await this.request<{ boards: IncidentBoardRef[] }>(
      "GET",
      `/api/v1/incidents/${incidentId}`,
    );
    return r.boards;
  }
  dashboardData(
    dashboardId: string,
    filter?: { field: string; equals: string } | null,
    incidentId?: string | null,
  ): Promise<DashboardSnapshot> {
    const params = new URLSearchParams();
    if (filter) {
      params.set("field", filter.field);
      params.set("equals", filter.equals);
    }
    if (incidentId) params.set("incidentId", incidentId);
    const query = params.toString() ? `?${params.toString()}` : "";
    return this.request<DashboardSnapshot>("GET", `/api/v1/dashboards/${dashboardId}/data${query}`);
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
  async listIncidentParticipants(incidentId: string): Promise<IncidentParticipantGrant[]> {
    const result = await this.request<{ participants: IncidentParticipantGrant[] }>(
      "GET", `/api/v1/incidents/${incidentId}/participants`);
    return result.participants;
  }
  addIncidentParticipant(incidentId: string, body: IncidentParticipantGrantInput): Promise<{ participant: IncidentParticipantGrant }> {
    return this.request("POST", `/api/v1/incidents/${incidentId}/participants`, body);
  }
  revokeIncidentParticipant(incidentId: string, participantId: string, reason: string): Promise<{ participant: IncidentParticipantGrant }> {
    return this.request("POST", `/api/v1/incidents/${incidentId}/participants/${participantId}/revoke`, { reason });
  }
  async listIncidentDatasets(incidentId: string): Promise<DatasetStatus[]> {
    const result = await this.request<{ datasets: DatasetStatus[] }>(
      "GET", `/api/v1/incidents/${incidentId}/datasets`);
    return result.datasets;
  }
  datasetItems(datasetId: string): Promise<CopFeatureCollection> {
    return this.request<CopFeatureCollection>("GET", `/api/v1/datasets/${datasetId}/items`);
  }
  datasetItemsPage(
    datasetId: string,
    options: { bbox?: readonly [number, number, number, number]; limit?: number; offset?: number } = {},
  ): Promise<DatasetItemsPageResponse> {
    const query = new URLSearchParams();
    if (options.bbox) query.set("bbox", options.bbox.join(","));
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    if (options.offset !== undefined) query.set("offset", String(options.offset));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request<DatasetItemsPageResponse>("GET", `/api/v1/datasets/${datasetId}/items${suffix}`);
  }
  async datasetItemsInArea(
    datasetId: string,
    bbox?: readonly [number, number, number, number],
    options: { pageSize?: number; maxPages?: number } = {},
  ): Promise<DatasetItemsAggregate> {
    const pageSize = options.pageSize ?? 1000;
    const maxPages = options.maxPages ?? 50;
    const features: CopFeatureCollection["features"][number][] = [];
    let offset = 0;
    let pages = 0;
    let hasMore: boolean;
    do {
      const page = await this.datasetItemsPage(datasetId, { ...(bbox ? { bbox } : {}), limit: pageSize, offset });
      features.push(...page.features);
      pages += 1;
      hasMore = page.page.hasMore;
      offset += page.page.returned;
      if (page.page.returned === 0) break;
    } while (hasMore && pages < maxPages);
    return { type: "FeatureCollection", features, pages, incomplete: hasMore };
  }
  async incidentCatalog(incidentId: string): Promise<CatalogEntryStatus[]> {
    const r = await this.request<{ sources: CatalogEntryStatus[] }>(
      "GET", `/api/v1/incidents/${incidentId}/catalog`);
    return r.sources;
  }
  onboardCatalogSource(incidentId: string, sourceId: string): Promise<{ pack: { id: string; datasetKeys: string[] } }> {
    return this.request("POST", `/api/v1/incidents/${incidentId}/catalog/${sourceId}/onboard`);
  }
  registerDataPack(incidentId: string, body: DataPack): Promise<{ pack: { id: string; datasetKeys: string[] } }> {
    return this.request("POST", `/api/v1/incidents/${incidentId}/data-packs`, body as unknown as Record<string, unknown>);
  }
  getIncidentArea(incidentId: string): Promise<IncidentAreaRevision> {
    return this.request("GET", `/api/v1/incidents/${incidentId}/operational-area`);
  }
  updateIncidentArea(incidentId: string, body: IncidentAreaUpdate): Promise<IncidentAreaRevision> {
    return this.request("PUT", `/api/v1/incidents/${incidentId}/operational-area`, body);
  }
  async incidentAreaHistory(incidentId: string, beforeRevision?: number): Promise<IncidentAreaRevision[]> {
    const query = beforeRevision === undefined ? "" : `?beforeRevision=${beforeRevision}`;
    const result = await this.request<{ revisions: IncidentAreaRevision[] }>(
      "GET", `/api/v1/incidents/${incidentId}/operational-area/history${query}`,
    );
    return result.revisions;
  }
  closeIncident(incidentId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", `/api/v1/incidents/${incidentId}/close`);
  }
  listIncidentTasks(incidentId: string, filters: TaskListQuery = {}): Promise<TaskListResponse> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) query.set(key, value);
    }
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks?${query}`);
  }
  updateIncidentTask(incidentId: string, taskId: string, input: TaskMetadataPatch): Promise<IncidentTask> {
    return this.request("PATCH", `/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${encodeURIComponent(taskId)}`, { ...input });
  }
  completeIncidentTask(incidentId: string, taskId: string, operationId: string): Promise<TaskCompletionReceipt> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${encodeURIComponent(taskId)}/complete`, { operationId });
  }
  async listResourceRequests(
    jurisdictionId: string,
    incidentId?: string | null,
  ): Promise<ResourceRequestSummary[]> {
    const query = incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : "";
    const r = await this.request<{ requests: ResourceRequestSummary[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/resource-requests${query}`,
    );
    return r.requests;
  }
  submitResourceRequest(
    jurisdictionId: string,
    body: {
      origin: "field" | "eoc";
      item: string;
      quantity?: number;
      priority?: string;
      notes?: string;
      incidentId?: string;
    },
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
    body: {
      capability: string;
      capabilityElement?: string;
      kind: "strength" | "improvement";
      observation: string;
      recommendation?: string;
    },
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
    body: {
      capability: string;
      capabilityElement?: string;
      recommendation: string;
      incidentId?: string;
      dueDate?: string;
    },
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
  async listAssignedPositions(jurisdictionId: string): Promise<PositionRef[]> {
    const result = await this.request<{ positions: PositionRef[] }>(
      "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/positions?assignedToMe=true`,
    );
    return result.positions;
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
  async listIaps(incidentId: string): Promise<IapListItem[]> {
    const r = await this.request<{ iaps: IapListItem[] }>(
      "GET",
      `/api/v1/incidents/${incidentId}/iaps`,
    );
    return r.iaps;
  }
  getIap(iapId: string): Promise<IapResult> {
    return this.request<IapResult>("GET", `/api/v1/iap/${iapId}`);
  }
  submitIap(iapId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", `/api/v1/iap/${iapId}/submit`);
  }
  approveIap(iapId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", `/api/v1/iap/${iapId}/approve`);
  }
  completeIap(iapId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>("POST", `/api/v1/iap/${iapId}/complete`);
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
  listWorkspaceStates(
    incidentId: string,
    kind: "workspace_preferences" | "workspace_layout",
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SavedStateListPage> {
    const query = new URLSearchParams({ kind });
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    return this.request<SavedStateListPage>(
      "GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/saved-state?${query}`,
    );
  }
  async getWorkspaceState(
    incidentId: string, kind: "workspace_preferences" | "workspace_layout", key: string,
  ): Promise<SavedStateRecord> {
    const result = await this.request<{ state: SavedStateRecord }>(
      "GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/saved-state/${kind}/${encodeURIComponent(key)}`,
    );
    return result.state;
  }
  async saveWorkspaceState(
    incidentId: string, kind: "workspace_preferences" | "workspace_layout", key: string,
    input: SavedStateWrite,
  ): Promise<SavedStateRecord> {
    const result = await this.request<{ state: SavedStateRecord }>(
      "PUT", `/api/v1/incidents/${encodeURIComponent(incidentId)}/saved-state/${kind}/${encodeURIComponent(key)}`,
      { ...input },
    );
    return result.state;
  }
  async deleteWorkspaceState(
    incidentId: string, kind: "workspace_preferences" | "workspace_layout", key: string,
    expectedRevision: number,
  ): Promise<void> {
    await this.request<{ ok: true }>(
      "DELETE", `/api/v1/incidents/${encodeURIComponent(incidentId)}/saved-state/${kind}/${encodeURIComponent(key)}?expectedRevision=${encodeURIComponent(String(expectedRevision))}`,
    );
  }
  async signInPosition(positionId: string): Promise<void> {
    await this.request<{ ok: true }>("POST", `/api/v1/positions/${encodeURIComponent(positionId)}/sign-in`, {});
  }
  async signOutPosition(): Promise<void> {
    await this.request<{ ok: true }>("POST", "/api/v1/positions/sign-out", {});
  }
  listTableViewStates(
    incidentId: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SavedStateListPage> {
    const query = new URLSearchParams({ kind: "table_view" });
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    return this.request<SavedStateListPage>(
      "GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/saved-state?${query}`,
    );
  }
  async getTableViewState(incidentId: string, key: string): Promise<SavedStateRecord> {
    const result = await this.request<{ state: SavedStateRecord }>(
      "GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/saved-state/table_view/${encodeURIComponent(key)}`,
    );
    return result.state;
  }
  async saveTableViewState(
    incidentId: string, key: string, input: SavedStateWrite,
  ): Promise<SavedStateRecord> {
    const result = await this.request<{ state: SavedStateRecord }>(
      "PUT", `/api/v1/incidents/${encodeURIComponent(incidentId)}/saved-state/table_view/${encodeURIComponent(key)}`,
      { ...input },
    );
    return result.state;
  }
  async deleteTableViewState(
    incidentId: string, key: string, expectedRevision: number,
  ): Promise<void> {
    await this.request<{ ok: true }>(
      "DELETE", `/api/v1/incidents/${encodeURIComponent(incidentId)}/saved-state/table_view/${encodeURIComponent(key)}?expectedRevision=${encodeURIComponent(String(expectedRevision))}`,
    );
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
