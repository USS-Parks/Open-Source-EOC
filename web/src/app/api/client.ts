import type {
  FieldDef,
  ViewDef,
  ViewRecord,
  DashboardSnapshot,
  SitrepRow,
  IcsFormContent,
  IapDocument,
  IapWorkspaceQuery,
  IapWorkspaceResponse,
  Ics204Assignment,
  Ics204AssignedResource,
  OperationalRelationship,
  OperationalRelationshipCreate,
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
  CreateLifelineAssessment,
  LifelineAssessmentReport,
  AssessmentDecisionInput,
  LifelineCurrentState,
  IncidentImpactAnalysis,
  ImpactContributionPage,
  LIFELINE_DEFINITION,
  ESF_DEFINITIONS,
  ESF_CROSSWALK_V1,
  EsfCurrentState,
  CreateEsfAssessment,
  EsfAssessmentReport,
  DashboardTemplate,
  DashboardComposition,
  DashboardCompositionSnapshot,
  DashboardContributionPage,
  DashboardFilterMode,
  DashboardFilterSet,
  WidgetFilter,
  ViewportBbox,
  FormLayout,
  AarDocument,
  AarAnalytics,
  AarObservation as SharedAarObservation,
  AarCorrectiveAction,
  AarActionPriority,
  AarActionStatus,
  WorkflowAssignmentRequest,
  BoardTemplate,
  ResourceRequestAssignment as ResourceRequestAssignmentContract,
  ResourceRequestDetail as ResourceRequestDetailContract,
  ResourceRequestSummary as ResourceRequestSummaryContract,
  CapAlert,
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
  readonly isInstanceAdmin?: boolean;
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
export interface TemplateVersionSummary {
  readonly key: string;
  readonly version: number;
  readonly title: string;
}
export interface DashboardListItem {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
}
export interface DashboardConfigListItem {
  readonly key: string;
  readonly revision: number;
  readonly title: string | null;
  readonly valid: boolean;
  readonly reason: string | null;
  readonly updatedAt: string;
}
export interface DashboardDataOptions {
  readonly scope?: "saved" | "incident";
  readonly filterMode?: DashboardFilterMode;
  readonly runtimeFilter?: WidgetFilter;
  readonly filters?: DashboardFilterSet;
  readonly bbox?: ViewportBbox;
}
export interface DashboardConfigResponse {
  readonly state: SavedStateRecord;
  readonly composition: DashboardComposition;
}

function dashboardQuery(options: DashboardDataOptions): URLSearchParams {
  const query = new URLSearchParams();
  if (options.scope) query.set("scope", options.scope);
  if (options.filterMode) query.set("filterMode", options.filterMode);
  if (options.runtimeFilter) {
    query.set("field", options.runtimeFilter.field);
    query.set("equals", String(options.runtimeFilter.equals));
  }
  if (options.filters?.category) {
    query.set("categoryField", options.filters.category.field);
    query.set("category", String(options.filters.category.equals));
  }
  if (options.filters?.operationalPeriod) {
    query.set("periodField", options.filters.operationalPeriod.field);
    query.set("periodRevision", String(options.filters.operationalPeriod.areaRevision));
  }
  if (options.filters?.date?.from) query.set("from", options.filters.date.from);
  if (options.filters?.date?.to) query.set("to", options.filters.date.to);
  if (options.bbox) query.set("bbox", options.bbox.join(","));
  return query;
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
  readonly incidentId: string | null;
  readonly incidentName: string | null;
  readonly revision: number;
  readonly sourceTime: string;
}
export interface RawNotification {
  readonly id: string;
  readonly channel: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly person_id: string | null;
  readonly position_id: string | null;
  readonly destination: string;
  readonly incident_id: string | null;
  readonly incident_name: string | null;
  readonly created_at: string;
  readonly read_at: string | null;
  readonly acknowledged_at: string | null;
  readonly acknowledged_by: string | null;
  readonly acknowledged_by_name: string | null;
  readonly assigned_to_current_actor: boolean;
}

export type AlertReviewState = "draft" | "in_review" | "approved";
export interface AlertTransmission {
  readonly state: "not_attempted" | "accepted" | "rejected";
  readonly environment: string | null;
  readonly submittedAt: string | null;
  readonly submittedByName: string | null;
}
export type CapDraft = Omit<CapAlert, "identifier" | "sent"> & {
  readonly identifier?: string;
  readonly sent?: string;
};
export interface CapAlertSummary {
  readonly id: string;
  readonly identifier: string;
  readonly origin: "authored" | "ingested";
  readonly status: CapAlert["status"];
  readonly msgType: CapAlert["msgType"];
  readonly scope: CapAlert["scope"];
  readonly ipawsEligible: boolean;
  readonly incidentId: string | null;
  readonly headline: string | null;
  readonly event: string | null;
  readonly createdAt: string;
  readonly review: { readonly revision: number; readonly state: AlertReviewState; readonly actorName: string; readonly createdAt: string } | null;
  readonly transmission: AlertTransmission;
}
export interface CapAlertDetail {
  readonly alert: CapAlert;
  readonly xml: string;
  readonly ipawsEligible: boolean;
  readonly origin: "authored" | "ingested";
  readonly incidentId: string | null;
  readonly createdAt: string;
  readonly review: CapAlertSummary["review"];
  readonly transmission: AlertTransmission;
}
export interface EffectiveBoardResponse {
  readonly id: string;
  readonly title: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly role: "admin" | "member" | "viewer" | "guest";
  readonly canContribute: boolean;
  readonly fields: readonly FieldDef[];
  readonly views: readonly ViewDef[];
  readonly inputLayout?: FormLayout;
  readonly detailLayout?: FormLayout;
}
export interface RecordReferenceOption { readonly id: string; readonly label: string; readonly boardId: string }
export interface BoardRecordActor {
  readonly personId: string; readonly displayName: string;
  readonly positionId: string | null; readonly positionTitle: string | null;
}
export interface BoardRecordHistoryEntry {
  readonly id: string; readonly at: string; readonly category: string;
  readonly actor: BoardRecordActor; readonly payload: Record<string, unknown>;
  readonly corrects: string | null;
}
export interface BoardRecordDetailResponse {
  readonly id: string; readonly incidentId: string | null; readonly data: ViewRecord;
  readonly createdAt: string; readonly createdBy: BoardRecordActor;
  readonly updatedAt: string; readonly updatedBy: BoardRecordActor | null;
  readonly canEdit: boolean; readonly history: readonly BoardRecordHistoryEntry[];
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
export interface LifelineAssessmentOverviewResponse {
  readonly definition: typeof LIFELINE_DEFINITION;
  readonly doctrineGaps: readonly string[];
  readonly states: readonly LifelineCurrentState[];
}
export interface EsfAssessmentOverviewResponse {
  readonly definitions: typeof ESF_DEFINITIONS;
  readonly crosswalk: typeof ESF_CROSSWALK_V1;
  readonly doctrineGaps: readonly string[];
  readonly states: readonly EsfCurrentState[];
}
export interface FeedHealth {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly mode: "poll" | "push";
  readonly enabled: boolean;
  readonly stale: boolean;
  readonly ageSeconds: number | null;
  readonly staleAfterSeconds: number;
  readonly lastSuccessAt: string | null;
  readonly lastError: string | null;
  readonly consecutiveFailures: number;
  readonly ingestAuthorized: boolean;
  readonly currentItemCount: number | null;
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
export interface IncidentDetail {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly closedAt: string | null;
  readonly canManageParticipation: boolean;
  readonly canEditArea: boolean;
  readonly positions: ReadonlyArray<{ id: string; key: string; title: string }>;
  readonly boards: ReadonlyArray<{ id: string; title: string }>;
  readonly checklists: ReadonlyArray<{
    id: string; positionKey: string | null; item: string; category: string;
    status: string; dueAt: string | null; revision: number;
    assignedParticipantId: string | null; completedAt: string | null;
    completedByPosition: string | null;
  }>;
  readonly libraries: ReadonlyArray<{ id: string; title: string; kind: string }>;
}
export interface IncidentTemplateOption {
  readonly key: string;
  readonly title: string;
}
export type { ResourceRequestAssignment, ResourceRequestDetail, ResourceRequestSummary } from "@openeoc/shared";
export type AarObservation = SharedAarObservation;
export interface CorrectiveAction extends AarCorrectiveAction {
  readonly incidentId: string | null;
  readonly createdAt: string;
}
export interface AarAnalyticsResponse {
  readonly observations: readonly AarObservation[];
  readonly correctiveActions: readonly CorrectiveAction[];
  readonly analytics: AarAnalytics;
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
  } | null;
}
export interface IapResult {
  readonly id: string;
  readonly status: string;
  readonly operationalPeriod: string;
  readonly contentRevision: number;
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
  readonly periodRevision?: number;
  readonly objectives?: readonly string[];
  readonly preparedBy?: string;
  readonly safetyMessage?: string;
  readonly formIds?: readonly string[];
}
export interface Ics204AssignmentInput {
  readonly id?: string;
  readonly name: string;
  readonly supervisor: WorkflowAssignmentRequest;
  readonly tactics: readonly string[];
  readonly resources: readonly Ics204AssignedResource[];
}
export interface IapRevisionSummary {
  readonly id: string;
  readonly revisionNumber: number;
  readonly contentRevision: number;
  readonly status: string;
  readonly supersedesIapId: string | null;
  readonly createdAt: string;
  readonly preparedBy: string | null;
  readonly approvedBy: string | null;
  readonly approvedAt: string | null;
}
export interface SearchHit {
  readonly kind: "record" | "library" | "file" | "chronology";
  readonly id: string;
  readonly title: string;
  readonly boardId?: string;
  readonly incidentId?: string | null;
}
export type FileAttachmentKind = "none" | "board" | "record" | "incident" | "library";
export interface FileMetaRef {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly sha256?: string;
  readonly version: number;
  readonly supersedes?: string | null;
  readonly attachedKind?: FileAttachmentKind;
  readonly attachedId?: string | null;
  readonly attachedBoardId?: string | null;
  readonly attachedIncidentId?: string | null;
  readonly createdAt?: string;
  readonly uploadedBy?: {
    readonly personId: string;
    readonly displayName: string;
    readonly positionTitle: string | null;
  };
}
export interface FilePage {
  readonly files: readonly FileMetaRef[];
  readonly nextCursor: string | null;
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
export interface ThreadRecipient {
  readonly kind: "person" | "position";
  readonly id: string;
  readonly label: string;
  readonly currentHolders: readonly string[];
}
export interface Thread {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly incidentId: string | null;
  readonly recipients: readonly ThreadRecipient[];
}
export interface Message {
  readonly id: string;
  readonly seq: number;
  readonly sender: string | null;
  readonly senderPosition: string | null;
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
  /** Current bearer for the transient WebSocket sync handshake. Never persist this value. */
  fieldSyncToken(): string {
    if (!this.accessToken) throw new SessionExpiredError();
    return this.accessToken;
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
  async listTemplateVersions(key: string): Promise<TemplateVersionSummary[]> {
    const result = await this.request<{ versions: TemplateVersionSummary[] }>(
      "GET", `/api/v1/templates/${encodeURIComponent(key)}/versions`,
    );
    return result.versions;
  }
  getTemplateVersion(key: string, version: number): Promise<BoardTemplate> {
    return this.request(
      "GET", `/api/v1/templates/${encodeURIComponent(key)}/versions/${version}`,
    );
  }
  publishTemplate(template: BoardTemplate): Promise<{ key: string; version: number }> {
    return this.request("POST", "/api/v1/templates", template as unknown as Record<string, unknown>);
  }
  createBoard(jurisdictionId: string, input: {
    templateKey: string; version?: number; title?: string;
  }): Promise<{ id: string }> {
    return this.request(
      "POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/boards`,
      input as unknown as Record<string, unknown>,
    );
  }
  upgradeBoard(boardId: string, toVersion: number): Promise<{ dropped: string[] }> {
    return this.request(
      "POST", `/api/v1/boards/${encodeURIComponent(boardId)}/upgrade`, { toVersion },
    );
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
  getBoard(boardId: string, incidentId?: string | null): Promise<EffectiveBoardResponse> {
    return this.request<EffectiveBoardResponse>("GET", `/api/v1/boards/${boardId}${incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : ""}`);
  }
  boardView(boardId: string, viewKey: string, incidentId?: string): Promise<ViewRecordsResponse> {
    return this.request<ViewRecordsResponse>(
      "GET",
      `/api/v1/boards/${boardId}/views/${viewKey}${incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : ""}`,
    );
  }
  updateRecord(boardId: string, recordId: string, patch: Record<string, unknown>, incidentId?: string | null): Promise<{ ok: true }> {
    return this.request("PATCH", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}${incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : ""}`, patch);
  }
  async recordReferenceOptions(boardId: string, fieldKey: string, incidentId: string, options: { after?: string; limit?: number } = {}): Promise<readonly RecordReferenceOption[]> {
    const query = new URLSearchParams({ incidentId });
    if (options.after) query.set("after", options.after);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const result = await this.request<{ options: RecordReferenceOption[] }>("GET", `/api/v1/boards/${encodeURIComponent(boardId)}/record-references/${encodeURIComponent(fieldKey)}?${query}`);
    return result.options;
  }
  boardRecordDetail(boardId: string, recordId: string, incidentId?: string | null): Promise<BoardRecordDetailResponse> {
    return this.request("GET", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/detail${incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : ""}`);
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
  getDashboard(dashboardId: string, incidentId: string): Promise<{
    id: string; jurisdictionId: string; title: string; template: DashboardTemplate;
  }> {
    return this.request("GET", `/api/v1/dashboards/${encodeURIComponent(dashboardId)}?incidentId=${encodeURIComponent(incidentId)}`);
  }
  listDashboardConfigs(incidentId: string, options: { cursor?: string; limit?: number } = {}): Promise<{
    configs: DashboardConfigListItem[]; nextCursor: string | null;
  }> {
    const query = new URLSearchParams();
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/dashboard-configs?${query}`);
  }
  getDashboardConfig(incidentId: string, key: string): Promise<DashboardConfigResponse> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/dashboard-configs/${encodeURIComponent(key)}`);
  }
  putDashboardConfig(incidentId: string, key: string, expectedRevision: number, composition: DashboardComposition): Promise<DashboardConfigResponse> {
    return this.request("PUT", `/api/v1/incidents/${encodeURIComponent(incidentId)}/dashboard-configs/${encodeURIComponent(key)}`, { expectedRevision, composition });
  }
  async deleteDashboardConfig(incidentId: string, key: string, expectedRevision: number): Promise<void> {
    await this.request("DELETE", `/api/v1/incidents/${encodeURIComponent(incidentId)}/dashboard-configs/${encodeURIComponent(key)}?expectedRevision=${expectedRevision}`);
  }
  dashboardConfigData(incidentId: string, key: string, options: DashboardDataOptions = {}): Promise<DashboardCompositionSnapshot> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/dashboard-configs/${encodeURIComponent(key)}/data?${dashboardQuery(options)}`);
  }
  dashboardContributions(dashboardId: string, widgetKey: string, options: Omit<DashboardDataOptions, "scope" | "filterMode"> & {
    incidentId: string; group?: string; cursor?: string; limit?: number;
  }): Promise<DashboardContributionPage> {
    const query = dashboardQuery(options);
    query.set("incidentId", options.incidentId);
    if (options.group !== undefined) query.set("group", options.group);
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    return this.request("GET", `/api/v1/dashboards/${encodeURIComponent(dashboardId)}/widgets/${encodeURIComponent(widgetKey)}/records?${query}`);
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
  async listSitreps(jurisdictionId: string, incidentId?: string): Promise<SitrepListItem[]> {
    const r = await this.request<{ sitreps: SitrepListItem[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/sitreps${incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : ""}`,
    );
    return r.sitreps;
  }
  getSitrep(sitrepId: string): Promise<SitrepRow> {
    return this.request<SitrepRow>("GET", `/api/v1/sitreps/${sitrepId}`);
  }
  composeSitrep(jurisdictionId: string, input: { incidentId: string; period: string }): Promise<SitrepRow> {
    return this.request("POST", `/api/v1/jurisdictions/${jurisdictionId}/sitreps`, input);
  }
  draftJicRelease(jurisdictionId: string, input: { title: string; body: string; requiredAgencies: readonly string[]; incidentId?: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${jurisdictionId}/jic/releases`, input);
  }
  submitJicRelease(releaseId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/jic/releases/${releaseId}/submit`);
  }
  listIncidentLifelineAssessments(incidentId: string): Promise<LifelineAssessmentOverviewResponse> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/lifeline-assessments`);
  }
  createLifelineAssessment(incidentId: string, input: CreateLifelineAssessment): Promise<LifelineAssessmentReport> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/lifeline-assessments`, input);
  }
  lifelineAssessmentHistory(incidentId: string, lifeline: string): Promise<{ readonly reports: readonly LifelineAssessmentReport[] }> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/lifeline-assessments/${encodeURIComponent(lifeline)}/history`);
  }
  decideLifelineAssessment(incidentId: string, lifeline: string, input: AssessmentDecisionInput): Promise<{ readonly id: string }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/lifeline-assessments/${encodeURIComponent(lifeline)}/decisions`, input);
  }

  getIncidentImpact(incidentId: string, bbox?: readonly [number, number, number, number]): Promise<IncidentImpactAnalysis> {
    const params = new URLSearchParams();
    if (bbox) params.set("bbox", bbox.join(","));
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/impact${params.size ? `?${params}` : ""}`);
  }

  getImpactContributions(incidentId: string, datasetId: string, options: {
    readonly revision: number;
    readonly bbox?: readonly [number, number, number, number];
    readonly cursor?: string;
    readonly limit?: number;
  }): Promise<ImpactContributionPage> {
    const params = new URLSearchParams({ revision: String(options.revision) });
    if (options.bbox) params.set("bbox", options.bbox.join(","));
    if (options.cursor) params.set("cursor", options.cursor);
    if (options.limit !== undefined) params.set("limit", String(options.limit));
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/impact/sources/${encodeURIComponent(datasetId)}/records?${params}`);
  }

  listIncidentEsfAssessments(incidentId: string): Promise<EsfAssessmentOverviewResponse> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/esf-assessments`);
  }
  createEsfAssessment(incidentId: string, body: CreateEsfAssessment): Promise<EsfAssessmentReport> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/esf-assessments`, body);
  }
  async listEsfAssessmentHistory(incidentId: string, framework: "federal" | "california", esf: string): Promise<readonly EsfAssessmentReport[]> {
    const result = await this.request<{ reports: EsfAssessmentReport[] }>("GET",
      `/api/v1/incidents/${encodeURIComponent(incidentId)}/esf-assessments/${framework}/${encodeURIComponent(esf)}/history`);
    return result.reports;
  }
  decideEsfAssessment(incidentId: string, framework: "federal" | "california", esf: string, body: AssessmentDecisionInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/esf-assessments/${framework}/${encodeURIComponent(esf)}/decisions`, body);
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
  acknowledgeNotification(id: string): Promise<{
    ok: true;
    acknowledged_at: string;
    acknowledged_by: string;
  }> {
    return this.request("POST", `/api/v1/notifications/${id}/acknowledge`);
  }
  async listCapAlerts(jurisdictionId: string): Promise<CapAlertSummary[]> {
    const response = await this.request<{ alerts: Array<{
      id: string; identifier: string; origin: "authored" | "ingested";
      status: CapAlert["status"]; msg_type: CapAlert["msgType"]; scope: CapAlert["scope"];
      ipaws_eligible: boolean; incident_id: string | null; headline: string | null;
      event: string | null; created_at: string; review_state: AlertReviewState | null;
      review_revision: number | null; reviewed_at: string | null; reviewer_name: string | null;
      transmission: AlertTransmission;
    }> }>("GET", `/api/v1/jurisdictions/${jurisdictionId}/cap/alerts`);
    return response.alerts.map((item) => ({
      id: item.id,
      identifier: item.identifier,
      origin: item.origin,
      status: item.status,
      msgType: item.msg_type,
      scope: item.scope,
      ipawsEligible: item.ipaws_eligible,
      incidentId: item.incident_id,
      headline: item.headline,
      event: item.event,
      createdAt: item.created_at,
      transmission: item.transmission,
      review: item.review_state && item.review_revision !== null && item.reviewed_at && item.reviewer_name
        ? { revision: item.review_revision, state: item.review_state, actorName: item.reviewer_name, createdAt: item.reviewed_at }
        : null,
    }));
  }
  getCapAlert(id: string): Promise<CapAlertDetail> {
    return this.request("GET", `/api/v1/cap/alerts/${id}`);
  }
  createCapDraft(jurisdictionId: string, alert: CapDraft, incidentId?: string): Promise<{
    id: string;
    identifier: string;
    ipawsEligible: boolean;
    xml: string;
    reviewState: "draft";
  }> {
    return this.request("POST", `/api/v1/jurisdictions/${jurisdictionId}/cap/drafts`, {
      alert,
      ...(incidentId ? { incidentId } : {}),
    });
  }
  reviewCapAlert(id: string, state: AlertReviewState): Promise<{
    revision: number;
    state: AlertReviewState;
    actorName: string;
    createdAt: string;
  }> {
    return this.request("POST", `/api/v1/cap/alerts/${id}/review`, { state });
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
  getIncident(incidentId: string): Promise<IncidentDetail> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}`);
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
  async listOperationalRelationships(incidentId: string): Promise<readonly OperationalRelationship[]> {
    const result = await this.request<{ relationships: readonly OperationalRelationship[] }>(
      "GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/operational-relationships`,
    );
    return result.relationships;
  }
  createOperationalRelationship(incidentId: string, input: OperationalRelationshipCreate): Promise<OperationalRelationship> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/operational-relationships`, input);
  }
  async listResourceRequests(
    jurisdictionId: string,
    incidentId?: string | null,
  ): Promise<ResourceRequestSummaryContract[]> {
    const query = incidentId ? `?incidentId=${encodeURIComponent(incidentId)}` : "";
    const r = await this.request<{ requests: ResourceRequestSummaryContract[] }>(
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
  getResourceRequest(id: string): Promise<ResourceRequestDetailContract> {
    return this.request("GET", `/api/v1/resource-requests/${encodeURIComponent(id)}`);
  }
  assignResourceRequest(id: string, assignment: ResourceRequestAssignmentContract): Promise<{ state: string }> {
    return this.request("POST", `/api/v1/resource-requests/${encodeURIComponent(id)}/assign`, assignment);
  }
  async listAarObservations(incidentId: string, periodRevision?: number): Promise<AarObservation[]> {
    const query = periodRevision === undefined ? "" : `?periodRevision=${periodRevision}`;
    const r = await this.request<{ observations: AarObservation[] }>(
      "GET",
      `/api/v1/incidents/${incidentId}/aar/observations${query}`,
    );
    return r.observations;
  }
  getAarAnalytics(incidentId: string, periodRevision?: number): Promise<AarAnalyticsResponse> {
    const query = periodRevision === undefined ? "" : `?periodRevision=${periodRevision}`;
    return this.request("GET", `/api/v1/incidents/${incidentId}/aar/analytics${query}`);
  }
  recordAarObservation(
    incidentId: string,
    body: {
      capability: string;
      capabilityElement?: string;
      kind: "strength" | "improvement";
      observation: string;
      recommendation?: string;
      periodRevision?: number;
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
    body: { overview: string; objectives?: readonly string[]; period?: string; periodRevision?: number },
  ): Promise<{ id: string; content: AarDocument }> {
    return this.request<{ id: string; content: AarDocument }>(
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
    filters: {
      includeComplete?: boolean;
      incidentId?: string;
      periodRevision?: number;
      priority?: AarActionPriority;
      status?: AarActionStatus;
      capability?: string;
    } = { includeComplete: true },
  ): Promise<CorrectiveAction[]> {
    const query = new URLSearchParams();
    query.set("includeComplete", String(filters.includeComplete ?? true));
    if (filters.incidentId) query.set("incidentId", filters.incidentId);
    if (filters.periodRevision !== undefined) query.set("periodRevision", String(filters.periodRevision));
    if (filters.priority) query.set("priority", filters.priority);
    if (filters.status) query.set("status", filters.status);
    if (filters.capability) query.set("capability", filters.capability);
    const r = await this.request<{ correctiveActions: CorrectiveAction[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions?${query.toString()}`,
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
      priority?: AarActionPriority;
      periodRevision?: number;
      assignment?: WorkflowAssignmentRequest;
      dueDate?: string;
    },
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/corrective-actions`,
      body as unknown as Record<string, unknown>,
    );
  }
  updateCorrectiveAction(
    id: string,
    body: {
      expectedRevision: number;
      priority?: AarActionPriority;
      assignment?: WorkflowAssignmentRequest | null;
      dueDate?: string | null;
      status?: AarActionStatus;
    },
  ): Promise<CorrectiveAction> {
    return this.request("PATCH", `/api/v1/corrective-actions/${id}`, body);
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
    body: { tag: string; custodyState: string; station?: string; agency?: string; location?: string; note?: string },
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
  queryIapWorkspace(incidentId: string, query: IapWorkspaceQuery): Promise<IapWorkspaceResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    return this.request<IapWorkspaceResponse>("GET", `/api/v1/incidents/${incidentId}/iaps?${params}`);
  }
  replaceIcs204Assignments(iapId: string, body: { expectedContentRevision: number; assignments: readonly Ics204AssignmentInput[] }): Promise<{ contentRevision: number; assignments: readonly Ics204Assignment[] }> {
    return this.request("PUT", `/api/v1/iap/${iapId}/ics-204`, body);
  }
  createIapRevision(iapId: string, body: { assignments: readonly Ics204AssignmentInput[] }): Promise<{ id: string; revisionNumber: number; contentRevision: number }> {
    return this.request("POST", `/api/v1/iap/${iapId}/revisions`, body);
  }
  async listIapRevisions(iapId: string): Promise<IapRevisionSummary[]> {
    const result = await this.request<{ revisions: IapRevisionSummary[] }>("GET", `/api/v1/iap/${iapId}/revisions`);
    return result.revisions;
  }
  downloadIapRevisionPdf(iapId: string, revisionNumber: number): Promise<Blob> {
    return this.requestBlob(`/api/v1/iap/${iapId}/revisions/${revisionNumber}/pdf`);
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
      attachedKind?: FileAttachmentKind;
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
  listFiles(
    jurisdictionId: string,
    options: { attachedKind?: FileAttachmentKind; attachedId?: string; cursor?: string; limit?: number } = {},
  ): Promise<FilePage> {
    const query = new URLSearchParams();
    if (options.attachedKind !== undefined) query.set("attachedKind", options.attachedKind);
    if (options.attachedId !== undefined) query.set("attachedId", options.attachedId);
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<FilePage>(
      "GET",
      `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/files${suffix}`,
    );
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
