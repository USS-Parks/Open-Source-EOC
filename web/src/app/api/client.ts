import type {
  FieldDef,
  ViewCondition,
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
  GrantPreview,
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
  TaskCreate,
  TaskCompletionReceipt,
  IncidentOverviewSummary,
  IncidentActivityEntry,
  ShiftHandoff,
  IncidentCloseout,
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
  ResourceKind,
  ResourceTypeLevel,
  PoolResource,
  CapAlert,
  IncidentImpactComparison,
  ComponentValues,
  IcsComponentFormId,
  IncidentPlan,
  EquipmentHoursInput,
  EquipmentRateImport,
  EquipmentRateView,
  ForceAccountSummary,
  LaborRateInput,
  LaborRateView,
  PlanActivation,
  PlanDetail,
  PlanSave,
  PlanSummary,
  PlanVersion,
  VolunteerDeploymentInput,
  VolunteerDeploymentUpdate,
  VolunteerInput,
  VolunteerRoster,
} from "@openeoc/shared";
import type { CopFeatureCollection } from "../../cop/layers.js";
import type {
  IpawsConfigInput,
  IpawsSendKind,
  IpawsSendRequest,
  IpawsSendResult,
  IpawsStatus,
  IpawsTrailEntry,
} from "../../ipaws/model.js";
import type { ChronologyFilters, ChronologyPage } from "../../audit/chronology.js";
import type { BatchExport, BatchImport, FederationStatus, ReceiptImport } from "../../federation/model.js";
import type {
  RecordWorkflow,
  WorkflowApprovalCommand,
  WorkflowCommandResult,
  WorkflowEscalationCommand,
  WorkflowTransitionCommand,
  WorkflowWithdrawalCommand,
} from "../../boards/workflow.js";
import type { DamageSummary, DeclarationThresholds } from "@openeoc/shared";
import type {
  DamageBaselineRow, DamageReportPage, DamageReportStatus, FieldAssessmentInput, PaItemInput, PaItemPage,
} from "../../damage/model.js";
import type { FacilityBoardRow, FacilityInput, FacilityStatusInput } from "../../facilities/model.js";
import { clockOffsetMs } from "../layout/clock.js";
import type {
  Contact,
  ContactGroup,
  ContactGroupsPage,
  ContactImportResult,
  ContactInput,
  ContactsPage,
  ActivationNotice,
  ImportMapping,
  MassNotificationDetail,
  MassNotificationsPage,
  MassSendInput,
  SheetEntry,
} from "../../contacts/model.js";

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
/** A password login that must finish with a second factor; no session exists yet. */
export interface MfaChallenge {
  readonly mfaToken: string;
  readonly mfaRequired?: true;
  readonly mfaEnrollmentRequired?: true;
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
  /** The incidents the board serves; empty for a jurisdiction board. */
  readonly incidentIds?: readonly string[];
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
  /** The board's template, joined from the board list by the console. */
  readonly templateKey?: string | undefined;
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
  /** A partner author's organization, from the incident grant the record was written under. */
  readonly organizationName?: string | null;
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
  readonly archivedAt?: string | null;
  /** Fields the record's workflow state keeps from changing, and that state. */
  readonly readOnly?: { readonly state: string; readonly fields: readonly string[] } | null;
}
export interface ViewRecordsResponse {
  readonly view: string;
  readonly columns: readonly string[];
  readonly records: readonly ViewRecord[];
  readonly nextCursor: string | null;
  /** Record count per group value; first page of a grouped view only. */
  readonly groups?: ReadonlyArray<{ readonly value: unknown; readonly count: number }>;
}
/** Keyset paging for list endpoints: pass a page's `nextCursor` to read the next. */
export interface PageOptions {
  readonly cursor?: string;
  readonly limit?: number;
}
function pageParams(page: PageOptions, params = new URLSearchParams()): URLSearchParams {
  if (page.cursor) params.set("cursor", page.cursor);
  if (page.limit !== undefined) params.set("limit", String(page.limit));
  return params;
}
/**
 * Read a keyset-paged list to its end, for pickers and lookups that must see
 * every row. Operational lists show a page and load more instead.
 */
export async function readAllPages<T>(
  read: (page: PageOptions) => Promise<{ readonly items: readonly T[]; readonly nextCursor: string | null | undefined }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await read(cursor ? { cursor, limit: 500 } : { limit: 500 });
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return items;
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
export type FeedItemsResponse = CopFeatureCollection & { readonly feed: FeedHealth; readonly nextCursor?: string | null };
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
  readonly archivedAt?: string | null;
  readonly lockedAt?: string | null;
  readonly canManageParticipation: boolean;
  readonly canEditArea: boolean;
}
export type IncidentArchiveFilter = "exclude" | "include" | "only";
export interface IncidentOverviewRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly activatedAt: string;
  readonly closedAt: string | null;
  readonly archivedAt: string | null;
  readonly lockedAt: string | null;
  readonly operationalPeriod: { label: string; startsAt: string; endsAt: string } | null;
  readonly openResourceRequests: number;
  readonly openTasks: number;
  readonly boardRecords: number;
  readonly participatingOrganizations: number;
}
export interface IncidentOverviewPage {
  readonly incidents: IncidentOverviewRow[];
  readonly nextCursor: string | null;
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
  /** The template and version the incident opened from, where it recorded them. */
  readonly templateKey?: string | null;
  readonly templateVersion?: number | null;
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
  readonly version: number;
  readonly updatedAt: string;
  readonly positions: number;
  readonly boards: number;
  readonly checklistItems: number;
}
/** A checklist item: plain text, or text with a category, a key other items depend on, or a due rule. */
export type IncidentTemplateItem = string | {
  readonly item: string;
  readonly category?: string;
  readonly key?: string;
  readonly dependsOn?: readonly string[];
  readonly due?: unknown;
};
export interface IncidentTemplateDefinition {
  readonly key: string;
  readonly title: string;
  readonly positions: readonly string[];
  readonly positionTitles?: Readonly<Record<string, string>>;
  readonly boards: readonly string[];
  readonly checklists: ReadonlyArray<{ readonly position: string; readonly items: readonly IncidentTemplateItem[] }>;
  /** What activation also opens (VA12): contact groups of the template's positions, and reports and rules by template key. */
  readonly contactGroups?: ReadonlyArray<{ readonly name: string; readonly positions: readonly string[] }>;
  readonly reports?: readonly string[];
  readonly rules?: readonly string[];
  /** The incident room (VC-12): dashboards by template key, threads incident-wide or of positions, and file folders. */
  readonly dashboards?: readonly string[];
  readonly threads?: ReadonlyArray<{ readonly title: string; readonly positions: readonly string[] }>;
  readonly fileFolders?: readonly string[];
}
export interface IncidentTemplateVersionEntry {
  readonly version: number;
  readonly title: string;
  readonly template: IncidentTemplateDefinition;
  readonly savedAt: string;
  /** Who saved it; null for a version the standard or scenario seeding put in. */
  readonly savedBy: string | null;
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
  readonly id: string;
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
  /** The ICS form components a plan assembled from them holds; empty for a plan built from live records. */
  readonly components?: readonly IapPlanComponent[];
}
/** A form a plan holds, at the version it took, beside the form's own latest version (VA37). */
export interface IapPlanComponent {
  readonly componentId: string;
  readonly formId: IcsComponentFormId;
  readonly label: string;
  readonly version: number;
  readonly currentVersion: number;
  readonly currentStatus: "draft" | "ready";
}
/** A plan that took changed forms: in place for a draft, or as the next revision after approval. */
export interface IapPlanChange {
  readonly id: string;
  readonly revisionNumber: number;
  readonly contentRevision: number;
  readonly changed: readonly { readonly formId: IcsComponentFormId; readonly label: string; readonly version: number }[];
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
/** An ICS form kept as a component of an operational period (VA37). */
export interface IcsComponentSummary {
  readonly id: string;
  readonly incidentId: string;
  readonly formId: IcsComponentFormId;
  readonly title: string;
  readonly label: string;
  readonly periodRevision: number;
  readonly operationalPeriod: string;
  readonly status: "draft" | "ready";
  readonly version: number;
  readonly preparedBy: string;
  readonly preparedRole: string;
  readonly updatedAt: string;
  /** The resource request a 213RR was started from (VA38); null for every other form. */
  readonly resourceRequestId: string | null;
}
export interface IcsComponentDetail extends IcsComponentSummary {
  readonly edition: string;
  readonly incidentName: string;
  readonly values: ComponentValues;
}
export interface IcsComponentVersion {
  readonly version: number;
  readonly status: "draft" | "ready";
  readonly label: string;
  readonly values: ComponentValues;
  readonly savedBy: string;
  readonly savedRole: string;
  readonly savedAt: string;
}
export interface CreateIapBody {
  readonly operationalPeriod: string;
  readonly periodRevision?: number;
  readonly objectives?: readonly string[];
  readonly preparedBy?: string;
  readonly safetyMessage?: string;
  readonly formIds?: readonly string[];
  /** Assemble from these ICS form components of the period instead (VA37). */
  readonly componentIds?: readonly string[];
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
export interface PlaceResult {
  readonly kind: "address" | "street" | "place" | "poi";
  readonly label: string;
  readonly detail: string;
  readonly lon: number;
  readonly lat: number;
  readonly zoom: number;
}
export interface PlaceSearch {
  readonly available: boolean;
  readonly results: readonly PlaceResult[];
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
  /** The incident folder it is filed in (VC-12). */
  readonly folderId?: string | null;
  readonly folderName?: string | null;
  readonly createdAt?: string;
  readonly uploadedBy?: {
    readonly personId: string;
    readonly displayName: string;
    readonly positionTitle: string | null;
  };
}
export interface FileFolder {
  readonly id: string;
  readonly name: string;
  readonly files: number;
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
  /** Its members only, or everyone who can read its incident. */
  readonly audience?: "members" | "incident";
  readonly recipients: readonly ThreadRecipient[];
}
export interface Message {
  readonly id: string;
  readonly seq: number;
  readonly sender: string | null;
  readonly senderPosition: string | null;
  readonly senderOrganization?: string;
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
/** What a screen shows when a request got no answer at all. */
export const NO_CONNECTION = "No connection to the server. Check the network connection and try again.";

export interface ApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  /** Persistence hook: called whenever the token pair changes (or clears). */
  readonly onTokens?: (tokens: Tokens | null) => void;
}

type Body = Record<string, unknown> | FormData | undefined;

export class ApiClient {
  private accessToken: string | null = null;
  private resumeToken: string | null = null;
  private refreshing: Promise<void> | null = null;
  /** The server's clock less this device's, from the latest answer that could say. */
  private clockOffset: number | null = null;
  private readonly clockListeners = new Set<(offsetMs: number) => void>();
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
  /** Current bearer for the transient WebSocket sync handshake. Never persist this value. */
  fieldSyncToken(): string {
    if (!this.accessToken) throw new SessionExpiredError();
    return this.accessToken;
  }

  async login(email: string, password: string): Promise<LoginResult | MfaChallenge> {
    const result = await this.raw<LoginResult | MfaChallenge>("POST", "/api/v1/auth/login", { email, password }, false);
    if ("accessToken" in result) this.setTokens({ accessToken: result.accessToken, resumeToken: result.resumeToken });
    return result;
  }

  /** Finish an MFA sign-in with a TOTP or recovery code. */
  async mfaVerify(mfaToken: string, code: string): Promise<void> {
    const result = await this.raw<LoginResult>("POST", "/api/v1/auth/mfa/verify", { mfaToken, code }, false);
    this.setTokens({ accessToken: result.accessToken, resumeToken: result.resumeToken });
  }

  mfaEnroll(mfaToken: string): Promise<{ secret: string; otpauthUri: string }> {
    return this.raw("POST", "/api/v1/auth/mfa/enroll", { mfaToken }, false);
  }

  /** Activate enrollment with a first code; returns the one-time recovery codes. */
  async mfaActivate(mfaToken: string, code: string): Promise<string[]> {
    const result = await this.raw<LoginResult & { recoveryCodes: string[] }>(
      "POST", "/api/v1/auth/mfa/activate", { mfaToken, code }, false);
    this.setTokens({ accessToken: result.accessToken, resumeToken: result.resumeToken });
    return result.recoveryCodes;
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

  /** Change the signed-in person's own password; their other sessions end. */
  changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true; otherSessionsEnded: number }> {
    return this.request("POST", "/api/v1/auth/password", { currentPassword, newPassword });
  }

  /** The server's liveness answer, which names its version. */
  serverHealth(): Promise<{ status: string; version: string }> {
    return this.raw("GET", "/api/v1/health", undefined, false);
  }

  /** The server's clock less this device's, in milliseconds, from the latest answer; null before one. */
  serverClockOffset(): number | null {
    return this.clockOffset;
  }

  /**
   * Hear each new measure of the server's clock against this device's: when
   * it first arrives, and after that when it moves by a second or more.
   * Returns the call that stops listening.
   */
  onServerClock(listener: (offsetMs: number) => void): () => void {
    this.clockListeners.add(listener);
    return () => this.clockListeners.delete(listener);
  }

  private noteServerClock(res: Response, sentAt: number, receivedAt: number): void {
    const date = typeof res.headers?.get === "function" ? res.headers.get("date") : null;
    const offset = clockOffsetMs(date, sentAt, receivedAt);
    if (offset === null) return;
    const moved = this.clockOffset === null || Math.abs(offset - this.clockOffset) >= 1000;
    this.clockOffset = offset;
    if (moved) for (const listener of this.clockListeners) listener(offset);
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
    // FormData sets its own multipart content type, boundary included.
    const form = body instanceof FormData;
    if (body !== undefined && !form) headers["content-type"] = "application/json";
    if (auth && this.accessToken) headers["authorization"] = `Bearer ${this.accessToken}`;
    const init: RequestInit = { method, headers };
    if (body !== undefined) init.body = form ? body : JSON.stringify(body);
    let res: Response;
    const sentAt = Date.now();
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, init);
      this.noteServerClock(res, sentAt, Date.now());
    } catch (err) {
      // fetch rejects with a TypeError when no response arrives at all; the
      // browser's wording ("Failed to fetch") means nothing to an operator.
      if (err instanceof TypeError) throw new Error(NO_CONNECTION, { cause: err });
      throw err;
    }
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
  /** Every published board template at its latest version. */
  async listTemplates(): Promise<TemplateVersionSummary[]> {
    const result = await this.request<{ templates: TemplateVersionSummary[] }>("GET", "/api/v1/templates");
    return result.templates;
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
  boardView(boardId: string, viewKey: string, incidentId?: string, page: PageOptions = {}): Promise<ViewRecordsResponse> {
    const params = pageParams(page, new URLSearchParams(incidentId ? { incidentId } : {}));
    return this.request<ViewRecordsResponse>(
      "GET",
      `/api/v1/boards/${boardId}/views/${viewKey}${params.size ? `?${params}` : ""}`,
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

  /** The newest page of the inbox. */
  async notifications(): Promise<RawNotification[]> {
    return (await this.notificationPage()).notifications;
  }
  notificationPage(page: PageOptions = {}): Promise<{ notifications: RawNotification[]; nextCursor: string | null }> {
    const params = pageParams(page);
    return this.request("GET", `/api/v1/notifications${params.size ? `?${params}` : ""}`);
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
  /** A page of feed items, most recently fetched first; the default page holds up to 1,000. */
  feedItems(feedId: string, page: PageOptions = {}): Promise<FeedItemsResponse> {
    const params = pageParams(page);
    return this.request<FeedItemsResponse>("GET", `/api/v1/feeds/${feedId}/items${params.size ? `?${params}` : ""}`);
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
  getIncidentTemplate(key: string): Promise<{ template: IncidentTemplateDefinition; version: number; updatedAt: string }> {
    return this.request("GET", `/api/v1/incident-templates/${encodeURIComponent(key)}`);
  }
  async listIncidentTemplateVersions(key: string): Promise<IncidentTemplateVersionEntry[]> {
    const r = await this.request<{ versions: IncidentTemplateVersionEntry[] }>(
      "GET", `/api/v1/incident-templates/${encodeURIComponent(key)}/versions`,
    );
    return r.versions;
  }
  /** Save a template over the version the editor opened (0 for a new one); answers the version it became. */
  saveIncidentTemplate(key: string, template: Omit<IncidentTemplateDefinition, "key">, expectedVersion: number): Promise<{ key: string; version: number }> {
    return this.request("PUT", `/api/v1/incident-templates/${encodeURIComponent(key)}`, {
      template: template as unknown as Record<string, unknown>, expectedVersion,
    });
  }
  activateIncident(
    jurisdictionId: string,
    body: {
      templateKey: string;
      name: string;
      kind?: "incident" | "daily_ops" | "planned_event" | "exercise";
      /** Whom the activation notifies, and how; the incident and its notice commit together. */
      notify?: ActivationNotice;
    },
  ): Promise<{ incidentId: string; notice?: { massNotificationId: string; recipients: number } }> {
    return this.request<{ incidentId: string; notice?: { massNotificationId: string; recipients: number } }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/incidents`,
      body as unknown as Record<string, unknown>,
    );
  }
  // ---- Executable plans (VC-09) ----
  async listPlans(jurisdictionId: string): Promise<PlanSummary[]> {
    return (await this.request<{ plans: PlanSummary[] }>("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/plans`)).plans;
  }
  getPlan(planId: string): Promise<PlanDetail> {
    return this.request("GET", `/api/v1/plans/${encodeURIComponent(planId)}`);
  }
  async listPlanVersions(planId: string): Promise<PlanVersion[]> {
    return (await this.request<{ versions: PlanVersion[] }>("GET", `/api/v1/plans/${encodeURIComponent(planId)}/versions`)).versions;
  }
  /** A new plan (expectedVersion 0), or the next version of the one opened. */
  savePlan(jurisdictionId: string, planId: string | null, plan: PlanSave): Promise<PlanDetail> {
    return planId
      ? this.request("PUT", `/api/v1/plans/${encodeURIComponent(planId)}`, plan as unknown as Record<string, unknown>)
      : this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/plans`, plan as unknown as Record<string, unknown>);
  }
  markPlanReviewed(planId: string): Promise<PlanDetail> {
    return this.request("POST", `/api/v1/plans/${encodeURIComponent(planId)}/review`, {});
  }
  activatePlan(planId: string, body: { name: string; eventAt?: string }): Promise<PlanActivation> {
    return this.request("POST", `/api/v1/plans/${encodeURIComponent(planId)}/activate`, body);
  }
  async incidentPlan(incidentId: string): Promise<IncidentPlan | null> {
    return (await this.request<{ plan: IncidentPlan | null }>("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/plan`)).plan;
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
  /** What a participant's grant lets them read on the incident, read as that person. */
  previewIncidentParticipant(incidentId: string, participantId: string): Promise<GrantPreview> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/participants/${encodeURIComponent(participantId)}/preview`);
  }
  async listIncidentDatasets(incidentId: string): Promise<DatasetStatus[]> {
    const result = await this.request<{ datasets: DatasetStatus[] }>(
      "GET", `/api/v1/incidents/${incidentId}/datasets`);
    return result.datasets;
  }
  private datasetItemsPage(
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
  /** What closing the incident leaves running: open requests and tasks, grants in force, datasets. */
  incidentCloseout(incidentId: string): Promise<IncidentCloseout> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/closeout`);
  }
  reopenIncident(incidentId: string, reason: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/reopen`, { reason });
  }
  /** One page of the jurisdiction's master view, newest incident first. */
  incidentOverview(jurisdictionId: string, archived: IncidentArchiveFilter, page: PageOptions = {}): Promise<IncidentOverviewPage> {
    const query = pageParams(page, new URLSearchParams({ archived }));
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/incidents/overview?${query}`);
  }
  archiveIncident(incidentId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/archive`);
  }
  unarchiveIncident(incidentId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/unarchive`);
  }
  lockIncident(incidentId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/lockdown`);
  }
  unlockIncident(incidentId: string): Promise<{ ok: true }> {
    return this.request("DELETE", `/api/v1/incidents/${encodeURIComponent(incidentId)}/lockdown`);
  }
  /** One page of the filtered tasks; the analytics count every match. */
  listIncidentTasks(incidentId: string, filters: TaskListQuery = {}, page: PageOptions = {}): Promise<TaskListResponse> {
    const query = pageParams(page);
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined) query.set(key, value);
    }
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks?${query}`);
  }
  createIncidentTask(incidentId: string, input: TaskCreate): Promise<IncidentTask> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks`, { ...input });
  }
  /** The overview's counts for one operational period; without a revision, the current one. */
  getIncidentSummary(incidentId: string, periodRevision: number | null): Promise<IncidentOverviewSummary> {
    const query = periodRevision === null ? "" : `?periodRevision=${periodRevision}`;
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/summary${query}`);
  }
  /** The incident's recent operational activity, newest first. */
  async listIncidentActivity(incidentId: string, limit = 10): Promise<readonly IncidentActivityEntry[]> {
    const result = await this.request<{ entries: readonly IncidentActivityEntry[] }>(
      "GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/activity?limit=${limit}`);
    return result.entries;
  }
  /** What changed on the incident since the reader's last shift ended, newest first. */
  shiftHandoff(incidentId: string): Promise<ShiftHandoff> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/handoff`);
  }
  updateIncidentTask(incidentId: string, taskId: string, input: TaskMetadataPatch): Promise<IncidentTask> {
    return this.request("PATCH", `/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${encodeURIComponent(taskId)}`, { ...input });
  }
  completeIncidentTask(incidentId: string, taskId: string, operationId: string): Promise<TaskCompletionReceipt> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/tasks/${encodeURIComponent(taskId)}/complete`, { operationId });
  }
  /** Every relationship of the incident, read page by page: its callers look links up by target. */
  listOperationalRelationships(incidentId: string): Promise<readonly OperationalRelationship[]> {
    return readAllPages(async (page) => {
      const result = await this.request<{ relationships: readonly OperationalRelationship[]; nextCursor: string | null }>(
        "GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/operational-relationships?${pageParams(page)}`,
      );
      return { items: result.relationships, nextCursor: result.nextCursor };
    });
  }
  createOperationalRelationship(incidentId: string, input: OperationalRelationshipCreate): Promise<OperationalRelationship> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/operational-relationships`, input);
  }
  /**
   * Every request in scope, read page by page: the request pickers and the
   * 213RR board need all of them. With an incident, every organization's
   * requests on that incident; without one, the jurisdiction's own.
   */
  listResourceRequests(
    jurisdictionId: string,
    incidentId?: string | null,
    filters: { readonly q?: string; readonly status?: "open" | "ended" | "all"; readonly mine?: boolean } = {},
  ): Promise<ResourceRequestSummaryContract[]> {
    return readAllPages(async (page) => {
      const query = pageParams(page, new URLSearchParams({
        ...(filters.q?.trim() ? { q: filters.q.trim() } : {}),
        ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
        ...(filters.mine ? { mine: "true" } : {}),
      }));
      const path = incidentId
        ? `/api/v1/incidents/${encodeURIComponent(incidentId)}/resource-requests?${query}`
        : `/api/v1/jurisdictions/${jurisdictionId}/resource-requests?${query}`;
      const r = await this.request<{ requests: ResourceRequestSummaryContract[]; nextCursor: string | null }>("GET", path);
      return { items: r.requests, nextCursor: r.nextCursor };
    });
  }
  submitResourceRequest(
    jurisdictionId: string,
    body: {
      origin: "field" | "eoc";
      item: string;
      quantity?: number;
      priority?: string;
      neededBy?: string;
      notes?: string;
      incidentId?: string;
      resourceKind?: string;
      resourceType?: number;
    },
  ): Promise<ResourceRequestSummaryContract> {
    return this.request<ResourceRequestSummaryContract>(
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
      planId?: string;
    } = { includeComplete: true },
  ): Promise<CorrectiveAction[]> {
    const query = new URLSearchParams();
    query.set("includeComplete", String(filters.includeComplete ?? true));
    if (filters.incidentId) query.set("incidentId", filters.incidentId);
    if (filters.periodRevision !== undefined) query.set("periodRevision", String(filters.periodRevision));
    if (filters.priority) query.set("priority", filters.priority);
    if (filters.status) query.set("status", filters.status);
    if (filters.capability) query.set("capability", filters.capability);
    if (filters.planId) query.set("planId", filters.planId);
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
      plan?: { id: string; section?: string | null };
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
      plan?: { id: string; section?: string | null } | null;
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
  /** An incident's threads: its incident-wide ones and the member threads the reader is in. */
  async listIncidentThreads(incidentId: string): Promise<Thread[]> {
    const r = await this.request<{ threads: Thread[] }>(
      "GET",
      `/api/v1/incidents/${incidentId}/threads`,
    );
    return r.threads;
  }
  createThread(
    jurisdictionId: string,
    body: {
      kind: "direct" | "group";
      title?: string;
      incidentId?: string;
      audience?: "members" | "incident";
      members: ReadonlyArray<{ kind: "person" | "position"; id: string }>;
    },
  ): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      "POST",
      `/api/v1/jurisdictions/${jurisdictionId}/threads`,
      body as unknown as Record<string, unknown>,
    );
  }
  /** Every message after `after`, read page by page: a conversation shows the whole thread. */
  listMessages(threadId: string, after = 0): Promise<Message[]> {
    return readAllPages(async (page) => {
      const r = await this.request<{ messages: Message[]; nextCursor: string | null }>(
        "GET",
        `/api/v1/threads/${threadId}/messages?${pageParams(page, new URLSearchParams({ after: String(after) }))}`,
      );
      return { items: r.messages, nextCursor: r.nextCursor };
    });
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
  /** Every IAP of the incident, read page by page, for the planning objective picker. */
  listIaps(incidentId: string): Promise<IapListItem[]> {
    return readAllPages(async (page) => {
      const r = await this.request<{ iaps: IapListItem[]; nextCursor: string | null }>(
        "GET",
        `/api/v1/incidents/${incidentId}/iaps?${pageParams(page)}`,
      );
      return { items: r.iaps, nextCursor: r.nextCursor };
    });
  }
  getIap(iapId: string): Promise<IapResult> {
    return this.request<IapResult>("GET", `/api/v1/iap/${iapId}`);
  }
  /** One page of the workspace, newest first; the summary and facets count every match. */
  queryIapWorkspace(incidentId: string, query: IapWorkspaceQuery, page: PageOptions = {}): Promise<IapWorkspaceResponse> {
    const params = pageParams(page);
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
  /** Bring a plan assembled from ICS forms up to their latest ready versions. */
  refreshIapForms(iapId: string): Promise<IapPlanChange> {
    return this.request<IapPlanChange>("POST", `/api/v1/iap/${iapId}/forms/refresh`);
  }
  downloadIapPdf(iapId: string): Promise<Blob> {
    return this.requestBlob(`/api/v1/iap/${iapId}/pdf`);
  }
  async listIcsComponents(incidentId: string, periodRevision?: number): Promise<IcsComponentSummary[]> {
    const q = periodRevision === undefined ? "" : `?periodRevision=${periodRevision}`;
    const r = await this.request<{ components: IcsComponentSummary[] }>("GET", `/api/v1/incidents/${incidentId}/ics-components${q}`);
    return r.components;
  }
  /** Start a form for a period, prefilled from the incident's records. */
  createIcsComponent(incidentId: string, body: { formId: string; periodRevision: number; label?: string; requestId?: string }): Promise<IcsComponentDetail> {
    return this.request<IcsComponentDetail>("POST", `/api/v1/incidents/${incidentId}/ics-components`, body);
  }
  getIcsComponent(componentId: string): Promise<IcsComponentDetail> {
    return this.request<IcsComponentDetail>("GET", `/api/v1/ics-components/${componentId}`);
  }
  /** Save a form as its next version over the version the editor opened. */
  saveIcsComponent(
    componentId: string,
    body: { values: ComponentValues; status: "draft" | "ready"; expectedVersion: number; label?: string },
  ): Promise<IcsComponentDetail & { readonly plans: readonly IapPlanChange[] }> {
    return this.request("PUT", `/api/v1/ics-components/${componentId}`, body as unknown as Record<string, unknown>);
  }
  async listIcsComponentVersions(componentId: string): Promise<IcsComponentVersion[]> {
    const r = await this.request<{ versions: IcsComponentVersion[] }>("GET", `/api/v1/ics-components/${componentId}/versions`);
    return r.versions;
  }
  downloadIcsComponentPdf(componentId: string, version?: number): Promise<Blob> {
    return this.requestBlob(`/api/v1/ics-components/${componentId}/pdf${version === undefined ? "" : `?version=${version}`}`);
  }
  async searchJurisdiction(jurisdictionId: string, q: string): Promise<SearchHit[]> {
    const r = await this.request<{ hits: SearchHit[] }>(
      "GET",
      `/api/v1/jurisdictions/${jurisdictionId}/search?q=${encodeURIComponent(q)}`,
    );
    return r.hits;
  }
  /** Offline address and place search; available is false when the deployment has no gazetteer. */
  searchPlaces(q: string, near?: readonly [number, number]): Promise<PlaceSearch> {
    const query = new URLSearchParams({ q, ...(near ? { near: near.join(",") } : {}) });
    return this.request("GET", `/api/v1/geocode/search?${query}`);
  }
  /** What the offline gazetteer has nearest a point, each result with its distance. */
  reverseGeocode(at: readonly [number, number]): Promise<{
    readonly available: boolean; readonly results: ReadonlyArray<PlaceResult & { readonly distanceMeters: number }>;
  }> {
    return this.request("GET", `/api/v1/geocode/reverse?${new URLSearchParams({ at: at.join(",") })}`);
  }
  /** Streams the file as multipart/form-data; the text fields go first, as the server requires. */
  uploadFile(
    jurisdictionId: string,
    body: {
      name: string;
      contentType: string;
      file: Blob;
      attachedKind?: FileAttachmentKind;
      attachedId?: string;
      folderId?: string;
    },
  ): Promise<UploadResult> {
    const form = new FormData();
    form.append("name", body.name);
    if (body.attachedKind !== undefined) form.append("attachedKind", body.attachedKind);
    if (body.attachedId !== undefined) form.append("attachedId", body.attachedId);
    if (body.folderId !== undefined) form.append("folderId", body.folderId);
    form.append("file", new Blob([body.file], { type: body.contentType }), body.name);
    return this.request<UploadResult>("POST", `/api/v1/jurisdictions/${jurisdictionId}/files`, form);
  }
  async listFileFolders(incidentId: string): Promise<readonly FileFolder[]> {
    const r = await this.request<{ folders: FileFolder[] }>("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/file-folders`);
    return r.folders;
  }
  fileMeta(fileId: string): Promise<FileMetaRef> {
    return this.request<FileMetaRef>("GET", `/api/v1/files/${fileId}`);
  }
  listFiles(
    jurisdictionId: string,
    options: { attachedKind?: FileAttachmentKind; attachedId?: string; folderId?: string; cursor?: string; limit?: number } = {},
  ): Promise<FilePage> {
    const query = new URLSearchParams();
    if (options.attachedKind !== undefined) query.set("attachedKind", options.attachedKind);
    if (options.attachedId !== undefined) query.set("attachedId", options.attachedId);
    if (options.folderId !== undefined) query.set("folderId", options.folderId);
    if (options.cursor !== undefined) query.set("cursor", options.cursor);
    if (options.limit !== undefined) query.set("limit", String(options.limit));
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return this.request<FilePage>(
      "GET",
      `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/files${suffix}`,
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
  // ---- IPAWS-OPEN enablement and the two-person send ----
  getIpawsStatus(jurisdictionId: string): Promise<IpawsStatus> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/ipaws`);
  }
  configureIpaws(jurisdictionId: string, input: IpawsConfigInput): Promise<IpawsStatus> {
    return this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/ipaws/config`, { ...input });
  }
  acknowledgeIpawsMoa(jurisdictionId: string, reference: string): Promise<IpawsStatus> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/ipaws/moa`, { reference });
  }
  setIpawsEnabled(jurisdictionId: string, enabled: boolean): Promise<IpawsStatus> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/ipaws/enable`, { enabled });
  }
  /** Ask for a send; the server answers with a pending request a different admin must confirm. */
  requestIpawsSend(jurisdictionId: string, alertId: string, kind: IpawsSendKind): Promise<IpawsSendRequest> {
    const jurisdiction = encodeURIComponent(jurisdictionId);
    return kind === "handshake"
      ? this.request("POST", `/api/v1/jurisdictions/${jurisdiction}/ipaws/test`, { alertId })
      : this.request("POST", `/api/v1/jurisdictions/${jurisdiction}/cap/alerts/${encodeURIComponent(alertId)}/ipaws`, {});
  }
  async listIpawsSends(jurisdictionId: string): Promise<IpawsSendRequest[]> {
    const result = await this.request<{ sends: IpawsSendRequest[] }>(
      "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/ipaws/sends`,
    );
    return result.sends;
  }
  confirmIpawsSend(jurisdictionId: string, sendId: string): Promise<IpawsSendResult> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/ipaws/sends/${encodeURIComponent(sendId)}/confirm`, {});
  }
  cancelIpawsSend(jurisdictionId: string, sendId: string): Promise<IpawsSendRequest> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/ipaws/sends/${encodeURIComponent(sendId)}/cancel`, {});
  }
  /** IPAWS events from the jurisdiction chronology since `from`: one page, oldest first. */
  async ipawsAuditTrail(jurisdictionId: string, from: string): Promise<IpawsTrailEntry[]> {
    const query = new URLSearchParams({ from, limit: "500" });
    const page = await this.request<{ entries: IpawsTrailEntry[] }>(
      "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/chronology?${query}`,
    );
    return page.entries.filter((entry) => entry.category.startsWith("ipaws."));
  }
  // ---- Board record workflow runtime ----
  recordWorkflow(boardId: string, recordId: string): Promise<RecordWorkflow> {
    return this.request("GET", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/workflow`);
  }
  requestWorkflowTransition(boardId: string, recordId: string, command: WorkflowTransitionCommand): Promise<WorkflowCommandResult> {
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/workflow/transitions`, { ...command });
  }
  approveWorkflowTransition(boardId: string, recordId: string, command: WorkflowApprovalCommand): Promise<WorkflowCommandResult> {
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/workflow/approvals`, { ...command });
  }
  withdrawWorkflowTransition(boardId: string, recordId: string, command: WorkflowWithdrawalCommand): Promise<WorkflowCommandResult> {
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/workflow/withdrawals`, { ...command });
  }
  escalateWorkflow(boardId: string, recordId: string, command: WorkflowEscalationCommand): Promise<WorkflowCommandResult> {
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/workflow/escalations`, { ...command });
  }
  downloadFile(fileId: string): Promise<Blob> {
    return this.requestBlob(`/api/v1/files/${fileId}/content`);
  }
  // ---- Audit chronology ----
  listChronology(jurisdictionId: string, filters: ChronologyFilters = {}, page: PageOptions = {}): Promise<ChronologyPage> {
    const query = pageParams(page);
    if (filters.incidentId) query.set("incidentId", filters.incidentId);
    if (filters.categories?.length) query.set("category", filters.categories.join(","));
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    const suffix = query.size > 0 ? `?${query}` : "";
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/chronology${suffix}`);
  }
  /** Record a correction: a new attributed event pointing at the original, which stays as it was. */
  async correctAuditEvent(eventId: string, note: string): Promise<string> {
    const result = await this.request<{ id: string }>(
      "POST", `/api/v1/audit/${encodeURIComponent(eventId)}/corrections`, { note },
    );
    return result.id;
  }
  /**
   * The jurisdiction's whole audit trail as one file, read export page by
   * export page: CSV with a single header row, or a JSON array of the signed
   * pages in order, each verifiable on its own.
   */
  async exportAuditTrail(jurisdictionId: string, format: "csv" | "json"): Promise<Blob> {
    // Holds the whole trail in memory; stream to a file if trails outgrow a browser tab.
    const path = (cursor: string | null) =>
      `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/audit/export?format=${format}&limit=500${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const parts: string[] = [];
    let cursor: string | null = null;
    do {
      if (format === "json") {
        const signed: { page: { nextCursor: string | null } } = await this.request("GET", path(cursor));
        parts.push(JSON.stringify(signed));
        cursor = signed.page.nextCursor;
      } else {
        const res = await this.requestResponse(path(cursor));
        const text = await res.text();
        // Every page repeats the header row; the file keeps the first.
        parts.push(parts.length ? text.slice(text.indexOf("\r\n") + 2) : text);
        cursor = res.headers.get("x-next-cursor");
      }
    } while (cursor);
    return format === "json"
      ? new Blob([`[${parts.join(",")}]`], { type: "application/json" })
      : new Blob(parts, { type: "text/csv" });
  }
  private async requestBlob(path: string): Promise<Blob> {
    return (await this.requestResponse(path)).blob();
  }
  /** An authorized GET that renews the session once on 401; a failed response throws ApiError. */
  private async requestResponse(path: string): Promise<Response> {
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
    return res;
  }

  // ---- Administration ----

  listMembers(jurisdictionId: string, page: PageOptions = {}): Promise<MembersPage> {
    const query = pageParams(page).toString();
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/members${query ? `?${query}` : ""}`);
  }
  async findPersonByEmail(email: string): Promise<PersonRef> {
    const result = await this.request<{ person: PersonRef }>("GET", `/api/v1/persons?${new URLSearchParams({ email })}`);
    return result.person;
  }
  createPerson(input: { email: string; displayName: string; password: string; jurisdictionId: string; role: MemberRole }): Promise<{ id: string }> {
    return this.request("POST", "/api/v1/persons", input);
  }
  async setMemberRole(jurisdictionId: string, personId: string, role: MemberRole): Promise<void> {
    await this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/members/${encodeURIComponent(personId)}`, { role });
  }
  async removeMember(jurisdictionId: string, personId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/members/${encodeURIComponent(personId)}`);
  }
  async setMemberDisabled(jurisdictionId: string, personId: string, disabled: boolean): Promise<void> {
    await this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/members/${encodeURIComponent(personId)}/disabled`, { disabled });
  }
  async resetMemberMfa(jurisdictionId: string, personId: string, reason: string): Promise<void> {
    await this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/members/${encodeURIComponent(personId)}/mfa-reset`, { reason });
  }
  listGuestGrants(jurisdictionId: string, page: PageOptions = {}): Promise<GuestGrantPage> {
    const query = pageParams(page).toString();
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/guests${query ? `?${query}` : ""}`);
  }
  createGuestGrant(jurisdictionId: string, input: { personId: string; scopes: readonly string[]; expiresAt: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/guests`, input);
  }
  async revokeGuestGrant(grantId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/guests/${encodeURIComponent(grantId)}`);
  }
  createPosition(jurisdictionId: string, input: { key: string; title: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/positions`, input);
  }
  async listPositionHolders(jurisdictionId: string): Promise<PositionHolder[]> {
    const result = await this.request<{ assignments: PositionHolder[] }>(
      "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/position-assignments`,
    );
    return result.assignments;
  }
  async assignPosition(positionId: string, personId: string): Promise<void> {
    await this.request("POST", `/api/v1/positions/${encodeURIComponent(positionId)}/assignments`, { personId });
  }
  async reassignPosition(positionId: string, personId: string): Promise<void> {
    await this.request("POST", `/api/v1/positions/${encodeURIComponent(positionId)}/reassignments`, { personId });
  }
  async revokePositionAssignment(positionId: string, personId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/positions/${encodeURIComponent(positionId)}/assignments/${encodeURIComponent(personId)}`);
  }
  provisionJurisdiction(input: { slug: string; name: string; adminPersonId: string }): Promise<{ jurisdictionId: string; positions: number }> {
    return this.request("POST", "/api/v1/provision/jurisdictions", input);
  }
  listIntegrations(): Promise<IntegrationState> {
    return this.request("GET", "/api/v1/integrations");
  }
  async getRetention(jurisdictionId: string): Promise<RetentionPolicy[]> {
    const result = await this.request<{ policies: RetentionPolicy[] }>("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/retention`);
    return result.policies;
  }
  async setRetention(jurisdictionId: string, policies: ReadonlyArray<{ dataClass: string; retentionDays: number | null }>): Promise<RetentionPolicy[]> {
    const result = await this.request<{ policies: RetentionPolicy[] }>(
      "PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/retention`, { policies },
    );
    return result.policies;
  }
  /** One signed JSON page of the audit export; requires the server's secret key. */
  auditExportSignedPage(jurisdictionId: string, cursor?: string): Promise<SignedAuditPage> {
    const query = new URLSearchParams({ format: "json", limit: "500" });
    if (cursor) query.set("cursor", cursor);
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/audit/export?${query}`);
  }
  /** One CSV page of the audit export; the next page's cursor arrives in a response header. */
  async auditExportCsvPage(jurisdictionId: string, cursor?: string): Promise<{ csv: string; nextCursor: string | null }> {
    const query = new URLSearchParams({ format: "csv", limit: "500" });
    if (cursor) query.set("cursor", cursor);
    const url = `${this.baseUrl}/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/audit/export?${query}`;
    const once = (): Promise<Response> =>
      this.fetchImpl(url, { method: "GET", headers: this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {} });
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
    return { csv: await res.text(), nextCursor: res.headers.get("x-next-cursor") };
  }

  // ---- Damage assessment ----
  listDamageReports(jurisdictionId: string, options: PageOptions & { status?: DamageReportStatus } = {}): Promise<DamageReportPage> {
    const query = pageParams(options);
    if (options.status) query.set("status", options.status);
    const text = query.toString();
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/damage/assessments${text ? `?${text}` : ""}`);
  }
  async moderateDamageReport(assessmentId: string, decision: "approved" | "rejected"): Promise<void> {
    await this.request("POST", `/api/v1/damage/assessments/${encodeURIComponent(assessmentId)}/moderate`, { decision });
  }
  recordDamageAssessment(jurisdictionId: string, input: FieldAssessmentInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/damage/assessments`, { ...input });
  }
  damageSummary(jurisdictionId: string, thresholds: DeclarationThresholds): Promise<DamageSummary> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/damage/summary`, { ...thresholds });
  }
  /** The declaration support document, rendered by the server from the counted assessments. */
  damageDeclaration(jurisdictionId: string, input: DeclarationThresholds & { incident: string }): Promise<{ summary: DamageSummary; document: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/damage/declaration`, { ...input });
  }
  /** Issue the public intake token; a new token replaces the previous one. */
  enableDamageIntake(jurisdictionId: string): Promise<{ token: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/damage/intake/enable`);
  }

  // ---- Staffing ----

  /** Who is on duty (one page), vacant positions and upcoming shifts. */
  staffingSummary(jurisdictionId: string, page: PageOptions = {}): Promise<import("../../staffing/model.js").StaffingSummary> {
    const query = pageParams(page).toString();
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/staffing${query ? `?${query}` : ""}`);
  }
  checkIn(jurisdictionId: string, input: { personId: string; positionId: string; incidentId?: string }): Promise<{ id: string; deduplicated: boolean }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/checkins`, input);
  }
  /** Check in the holder of a badge code. */
  scanCheckIn(jurisdictionId: string, input: { badgeToken: string; positionId: string; incidentId?: string }): Promise<{ id: string; deduplicated: boolean; personId: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/checkins/scan`, input);
  }
  async checkOut(checkinId: string): Promise<void> {
    await this.request("POST", `/api/v1/checkins/${encodeURIComponent(checkinId)}/checkout`);
  }
  /** Issue a badge; the returned code is shown only this once. */
  issueBadge(jurisdictionId: string, input: { personId: string; label?: string }): Promise<{ id: string; token: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/badges`, input);
  }
  async listBadges(jurisdictionId: string): Promise<readonly import("../../staffing/model.js").BadgeEntry[]> {
    const result = await this.request<{ badges: import("../../staffing/model.js").BadgeEntry[] }>(
      "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/badges`);
    return result.badges;
  }
  async revokeBadge(badgeId: string): Promise<void> {
    await this.request("POST", `/api/v1/badges/${encodeURIComponent(badgeId)}/revoke`);
  }
  /** Every check-in, open and closed, earliest first; with an incident, its own and the jurisdiction's. */
  checkinHistory(jurisdictionId: string, incidentId: string | null, page: PageOptions = {}): Promise<{
    checkins: import("../../staffing/model.js").CheckinHistoryEntry[]; nextCursor: string | null;
  }> {
    const query = pageParams(page);
    if (incidentId) query.set("incidentId", incidentId);
    const text = query.toString();
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/checkins${text ? `?${text}` : ""}`);
  }
  createShift(jurisdictionId: string, input: { positionId: string; personId?: string; startsAt: string; endsAt: string; note?: string; incidentId?: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/shifts`, input);
  }

  // ---- Federation ----

  /** Peers with their link state and shared boards, and the latest received batches. Administrators only. */
  federationStatus(jurisdictionId: string): Promise<FederationStatus> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/federation`);
  }
  /** Register a peer; the returned token is the only time it is ever shown. */
  registerPeer(jurisdictionId: string, name: string): Promise<{ id: string; token: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/peers`, { name });
  }
  async setPeerLink(peerId: string, endpointUrl: string, token: string): Promise<void> {
    await this.request("PUT", `/api/v1/peers/${encodeURIComponent(peerId)}/link`, { endpointUrl, token });
  }
  createSharingAgreement(peerId: string, input: { boardId: string; canRead: boolean; canWrite: boolean; remoteBoardId?: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/peers/${encodeURIComponent(peerId)}/agreements`, input);
  }
  /** Record the partner's public key; its batches are applied only when they verify under it. */
  setPeerKey(peerId: string, publicKey: string): Promise<{ fingerprint: string }> {
    return this.request("PUT", `/api/v1/peers/${encodeURIComponent(peerId)}/key`, { publicKey });
  }
  /** Revoke a sharing agreement: the board stops flowing to and from the partner, and what was waiting for it is dropped. */
  revokeSharingAgreement(peerId: string, agreementId: string): Promise<{ dropped: number }> {
    return this.request("DELETE", `/api/v1/peers/${encodeURIComponent(peerId)}/agreements/${encodeURIComponent(agreementId)}`);
  }
  /** Export what waits for the partner as a file of signed batches; the entries stay waiting until its receipt is imported. */
  exportBatchFile(peerId: string): Promise<BatchExport> {
    return this.request("POST", `/api/v1/peers/${encodeURIComponent(peerId)}/exchange/export`);
  }
  /** Import the partner's batch file through the receive lane; the result carries this instance's signed receipt. */
  importBatchFile(peerId: string, file: unknown): Promise<BatchImport> {
    return this.request("POST", `/api/v1/peers/${encodeURIComponent(peerId)}/exchange/import`, file as Body);
  }
  /** Import the partner's receipt, which marks the batches it names delivered. */
  importReceipt(peerId: string, receipt: unknown): Promise<ReceiptImport> {
    return this.request("POST", `/api/v1/peers/${encodeURIComponent(peerId)}/exchange/receipt`, receipt as Body);
  }

  // ---- JIC review, publication and media inquiries; resource costs and escalation ----

  decideJicRelease(releaseId: string, input: { agency: string; decision: "approve" | "reject"; note?: string }): Promise<{ status: string }> {
    return this.request("POST", `/api/v1/jic/releases/${encodeURIComponent(releaseId)}/decisions`, input);
  }
  publishJicRelease(releaseId: string, input: { toPublicFeed: boolean; toCollab: boolean }): Promise<{ status: string; channels: string[] }> {
    return this.request("POST", `/api/v1/jic/releases/${encodeURIComponent(releaseId)}/publish`, input);
  }
  async listJicPublicFeed(jurisdictionId: string): Promise<Array<{ id: string; title: string; body: string; publishedAt: string }>> {
    const result = await this.request<{ public: Array<{ id: string; title: string; body: string; publishedAt: string }> }>(
      "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/jic/public`,
    );
    return result.public;
  }
  logJicInquiry(jurisdictionId: string, input: { outlet: string; subject: string; question: string; incidentId?: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/jic/inquiries`, input);
  }
  assignJicInquiry(inquiryId: string, positionId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/jic/inquiries/${encodeURIComponent(inquiryId)}/assign`, { positionId });
  }
  answerJicInquiry(inquiryId: string, responseReleaseId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/jic/inquiries/${encodeURIComponent(inquiryId)}/answer`, { responseReleaseId });
  }
  addResourceRequestCost(id: string, input: { category: string; amountCents: number; incurredAt: string; description?: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/resource-requests/${encodeURIComponent(id)}/costs`, input);
  }
  /** The request's recorded costs as the reimbursement CSV, with its total row. */
  exportResourceRequestCosts(id: string): Promise<Blob> {
    return this.requestBlob(`/api/v1/resource-requests/${encodeURIComponent(id)}/costs/export`);
  }
  /** The request's ICS 213RR as it stands now (VA38). */
  getIcs213rr(id: string): Promise<{ requestId: string; number: number; incidentId: string | null; incidentName: string | null; values: ComponentValues; form: IcsFormContent }> {
    return this.request("GET", `/api/v1/resource-requests/${encodeURIComponent(id)}/ics-213rr`);
  }
  downloadIcs213rrPdf(id: string): Promise<Blob> {
    return this.requestBlob(`/api/v1/resource-requests/${encodeURIComponent(id)}/ics-213rr/pdf`);
  }
  /** The server delivers the request to the peer tier; a failed delivery answers 502 and nothing is recorded. */
  escalateResourceRequest(id: string, input: { peerName: string; peerBaseUrl: string; peerToken: string }): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/resource-requests/${encodeURIComponent(id)}/escalate`, input);
  }

  // ---- Resource typing catalog and resource pool ----
  listResourceKinds(jurisdictionId: string): Promise<{ kinds: ResourceKind[]; canManage: boolean }> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/resources/kinds`);
  }
  addResourceKind(jurisdictionId: string, input: { name: string; discipline: string; levels: ResourceTypeLevel[]; notes: string }): Promise<{ key: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/resources/kinds`, input);
  }
  /** Replaces the previous import; every row imports or none does. */
  importResourceKinds(jurisdictionId: string, input: { csv: string; sourceNote: string }): Promise<{ imported: number }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/resources/kinds/import`, input);
  }
  /** The whole pool, read page by page: the assignment pickers need every resource. */
  listResources(jurisdictionId: string): Promise<PoolResource[]> {
    return readAllPages(async (page) => {
      const r = await this.request<{ resources: PoolResource[]; nextCursor: string | null }>(
        "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/resources?${pageParams(page)}`,
      );
      return { items: r.resources, nextCursor: r.nextCursor };
    });
  }
  addResource(jurisdictionId: string, input: { name: string; kind: string; type: number | null }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/resources`, input);
  }
  transitionResource(resourceId: string, input: { to: string; requestId?: string; returnCondition?: string; checks?: string[] }): Promise<{ status: string }> {
    return this.request("POST", `/api/v1/resources/${encodeURIComponent(resourceId)}/transition`, input);
  }
  /** Corrects a pool resource's name, or its kind and type while it is not assigned. */
  async updateResource(resourceId: string, input: { name: string; kind: string; type: number | null }): Promise<void> {
    await this.request("PATCH", `/api/v1/resources/${encodeURIComponent(resourceId)}`, input);
  }
  async resourceHistory(resourceId: string): Promise<ResourceHistoryEntry[]> {
    return (await this.request<{ history: ResourceHistoryEntry[] }>("GET", `/api/v1/resources/${encodeURIComponent(resourceId)}/history`)).history;
  }
  async updateResourceKind(jurisdictionId: string, key: string, input: { name: string; discipline: string; levels: ResourceTypeLevel[]; notes: string }): Promise<void> {
    await this.request("PATCH", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/resources/kinds/${encodeURIComponent(key)}`, input);
  }
  async deleteResourceKind(jurisdictionId: string, key: string): Promise<void> {
    await this.request("DELETE", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/resources/kinds/${encodeURIComponent(key)}`);
  }

  // ---- Facilities and shelters (optional integration) ----
  /** The status board: every facility's registry fields, latest report and staleness. */
  async facilityBoard(jurisdictionId: string): Promise<FacilityBoardRow[]> {
    const result = await this.request<{ facilities: FacilityBoardRow[] }>(
      "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/facilities/board`,
    );
    return result.facilities;
  }
  /** Whether this server runs the facilities integration. */
  async facilitiesEnabled(): Promise<boolean> {
    const state = await this.listIntegrations();
    return state.integrations.some((i) => i.key === "facilities" && i.enabled);
  }
  registerFacility(jurisdictionId: string, input: FacilityInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/facilities`, { ...input });
  }
  /** Replaces a facility's registry fields; a null contact or location clears it. */
  async updateFacility(facilityId: string, input: {
    name: string; kind: string; contact: string | null; staleAfterSeconds: number; location: { lon: number; lat: number } | null;
  }): Promise<void> {
    await this.request("PATCH", `/api/v1/facilities/${encodeURIComponent(facilityId)}`, { ...input });
  }
  /** Removes a facility from the registry; its reports stay in its history. */
  async retireFacility(facilityId: string): Promise<void> {
    await this.request("POST", `/api/v1/facilities/${encodeURIComponent(facilityId)}/retire`);
  }
  reportFacilityStatus(facilityId: string, input: FacilityStatusInput): Promise<{ reportId: string }> {
    return this.request("POST", `/api/v1/facilities/${encodeURIComponent(facilityId)}/status`, { ...input });
  }
  /** The EDXL-HAVE document for the jurisdiction's facilities of one kind. */
  async facilityHave(jurisdictionId: string, kind: string): Promise<string> {
    const query = new URLSearchParams({ kind });
    return (await this.requestResponse(`/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/facilities/have?${query}`)).text();
  }

  /** One page of releases, newest first, each with its approval chain so far. */
  listJicReleases(jurisdictionId: string, filter: JicListFilter = {}, page: PageOptions = {}): Promise<{ releases: JicReleaseListItem[]; nextCursor: string | null }> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/jic/releases${jicListQuery(filter, page)}`);
  }
  /** One page of media inquiries, newest first. */
  listJicInquiries(jurisdictionId: string, filter: JicListFilter = {}, page: PageOptions = {}): Promise<{ inquiries: JicInquiryListItem[]; nextCursor: string | null }> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/jic/inquiries${jicListQuery(filter, page)}`);
  }

  // ---- Jurisdiction export and definition import ----

  /** The jurisdiction's operational record and file bytes as one `.tar.gz` archive. */
  exportJurisdiction(jurisdictionId: string): Promise<Blob> {
    return this.requestBlob(`/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/export`);
  }
  /** A signed board template package; resolves with how many template versions were new. */
  async importTemplatePackage(pkg: Record<string, unknown>): Promise<number> {
    return (await this.request<{ imported: number }>("POST", "/api/v1/templates/import", pkg)).imported;
  }
  importForm(jurisdictionId: string, form: FormDefinition): Promise<{ key: string; version: number }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/forms`,
      form as unknown as Record<string, unknown>);
  }
  importXlsForm(jurisdictionId: string, input: { key: string; xlsxBase64: string }): Promise<{ key: string; version: number }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/forms/import`, input);
  }
  importDashboardTemplate(template: DashboardTemplate): Promise<{ key: string; version: number }> {
    return this.request("POST", "/api/v1/dashboard-templates", template as unknown as Record<string, unknown>);
  }
  /** A signed solution package (VA11); its forms join this jurisdiction, the rest the instance. */
  importSolutionPackage(jurisdictionId: string, pkg: Record<string, unknown>): Promise<SolutionImportSummary> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/solution-packages`, pkg);
  }
  /** Every signed solution package imported on this instance, newest first; instance administrators only. */
  async listSolutionPackages(): Promise<readonly ImportedSolutionPackage[]> {
    return (await this.request<{ packages: ImportedSolutionPackage[] }>("GET", "/api/v1/solution-packages")).packages;
  }

  // ---- Notification channels (Administration) ----
  getNotificationChannel(jurisdictionId: string, kind: NotificationChannelKind): Promise<NotificationChannelView> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/notification-channels/${kind}`);
  }
  /** Omit `secret` to keep the stored password or token. */
  saveNotificationChannel(jurisdictionId: string, kind: NotificationChannelKind, input: { settings: Record<string, unknown>; secret?: string }): Promise<NotificationChannelView> {
    return this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/notification-channels/${kind}`, input);
  }
  /** Sends one message now; answers with the relay's or provider's receipt, or fails with its error. */
  testNotificationChannel(jurisdictionId: string, kind: NotificationChannelKind, to: string): Promise<{ receipt: Readonly<Record<string, unknown>> }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/notification-channels/${kind}/test`, { to });
  }
  /** Reads the SMS gateway's replies now, as the scheduler does every half minute. */
  readSmsReplies(jurisdictionId: string): Promise<SmsRepliesRead> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/sms-replies/read`);
  }
  /** How long each kind of outbound delivery waits for a route before it expires. */
  getDeliveryHolds(jurisdictionId: string): Promise<{ holds: readonly DeliveryHold[] }> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/delivery-holds`);
  }
  setDeliveryHold(jurisdictionId: string, kind: DeliveryHoldKind, hours: number): Promise<DeliveryHold> {
    return this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/delivery-holds/${kind}`, { hours });
  }
  /** Queue a failed or expired delivery again, with a fresh hold. Administrators only. */
  resendNotification(id: string): Promise<{ ok: true; deliveryId: string }> {
    return this.request("POST", `/api/v1/notifications/${encodeURIComponent(id)}/resend`, {});
  }

  // ---- Board engine: refined views, archive, delete, history, import and export ----

  /** One page of a view refined for this read: extra conditions, sort keys, a group field, archived records. */
  boardViewPage(boardId: string, viewKey: string, query: BoardViewQuery = {}, page: PageOptions = {}): Promise<ViewRecordsResponse> {
    const params = pageParams(page, boardViewParams(query));
    return this.request("GET", `/api/v1/boards/${encodeURIComponent(boardId)}/views/${encodeURIComponent(viewKey)}${params.size ? `?${params}` : ""}`);
  }
  /** Every page of a view as one CSV or .xlsx file, under the same refinements. */
  exportBoardView(boardId: string, viewKey: string, format: "csv" | "xlsx", query: BoardViewQuery = {}): Promise<Blob> {
    const params = boardViewParams(query);
    params.set("format", format);
    return this.requestBlob(`/api/v1/boards/${encodeURIComponent(boardId)}/views/${encodeURIComponent(viewKey)}/export?${params}`);
  }
  /** Validate (dryRun) or commit a CSV or .xlsx file of records; a commit writes every row or none. */
  importBoardRecords(
    boardId: string,
    file: Blob,
    options: { dryRun?: boolean; incidentId?: string; mapping?: Readonly<Record<string, string | null>> } = {},
  ): Promise<BoardImportResult> {
    const form = new FormData();
    if (options.mapping) form.append("mapping", JSON.stringify(options.mapping));
    form.append("file", file, "import");
    const params = new URLSearchParams({ dryRun: String(options.dryRun ?? false) });
    if (options.incidentId) params.set("incidentId", options.incidentId);
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/import?${params}`, form);
  }
  /** The board's saved WebEOC column mapping and source time zone; writers only. */
  webeocMapping(boardId: string): Promise<WebeocSavedMapping> {
    return this.request("GET", `/api/v1/boards/${encodeURIComponent(boardId)}/webeoc-mapping`);
  }
  saveWebeocMapping(boardId: string, input: { mapping: Readonly<Record<string, string>>; timeZone: string | null }): Promise<WebeocSavedMapping> {
    return this.request("PUT", `/api/v1/boards/${encodeURIComponent(boardId)}/webeoc-mapping`, { ...input });
  }
  /** Dry-run or commit a WebEOC board CSV export; a commit writes the valid rows and reports the rest. */
  importWebeocRecords(
    boardId: string,
    file: Blob,
    options: { dryRun: boolean; mapping?: Readonly<Record<string, string>>; timeZone?: string },
  ): Promise<WebeocImportReport> {
    const form = new FormData();
    if (options.mapping) form.append("mapping", JSON.stringify(options.mapping));
    if (options.timeZone) form.append("timeZone", options.timeZone);
    form.append("file", file, file instanceof File ? file.name : "webeoc.csv");
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/webeoc-import?dryRun=${String(options.dryRun)}`, form);
  }
  /** One page of a record's change history, oldest first. */
  boardRecordHistory(boardId: string, recordId: string, incidentId?: string | null, page: PageOptions = {}): Promise<{ entries: BoardRecordChange[]; nextCursor: string | null }> {
    const params = pageParams(page, new URLSearchParams(incidentId ? { incidentId } : {}));
    return this.request("GET", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/history${params.size ? `?${params}` : ""}`);
  }
  archiveRecord(boardId: string, recordId: string): Promise<{ archivedAt: string | null }> {
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/archive`);
  }
  restoreRecord(boardId: string, recordId: string): Promise<{ archivedAt: string | null }> {
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}/restore`);
  }
  /** Jurisdiction admins only; the record stays in history. */
  deleteRecord(boardId: string, recordId: string): Promise<{ ok: true }> {
    return this.request("DELETE", `/api/v1/boards/${encodeURIComponent(boardId)}/records/${encodeURIComponent(recordId)}`);
  }

  // ---- Collaboration channels (optional integration) ----
  collabStatus(jurisdictionId: string): Promise<CollabStatus> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/collab`);
  }
  /** The token is stored encrypted on the server and never returned; omit it to keep the stored one. */
  configureCollab(jurisdictionId: string, input: CollabBackendInput): Promise<CollabStatus> {
    return this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/collab/backend`, { ...input });
  }
  /** `error` names the chat server's failure when one is in use and did not answer. */
  provisionCollab(incidentId: string): Promise<{ degraded: boolean; backend: string | null; channels: number; error?: string }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/collab/provision`);
  }
  syncCollab(incidentId: string): Promise<{ degraded: boolean; added: number; removed: number; error?: string }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/collab/sync`);
  }
  announceCollab(incidentId: string, input: { section?: string; text: string }): Promise<{ degraded: boolean; error?: string }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/collab/announce`, { ...input });
  }
  archiveCollab(incidentId: string): Promise<{ archived: boolean }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/collab/archive`);
  }

  // ---- Meetings and briefings (optional integration) ----
  meetingConfig(jurisdictionId: string): Promise<MeetingConfig> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/meetings/config`);
  }
  /** The secret is stored encrypted on the server and never returned; omit it to keep the stored one. */
  configureMeetings(jurisdictionId: string, input: MeetingConfigInput): Promise<MeetingConfig> {
    return this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/meetings/config`, { ...input });
  }
  async listMeetingBridges(incidentId: string): Promise<MeetingBridge[]> {
    return (await this.request<{ meetings: MeetingBridge[] }>("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/meetings`)).meetings;
  }
  /** Opens the incident's bridge, or a section's; later calls answer with the same room. */
  openMeetingBridge(incidentId: string, section?: string): Promise<MeetingBridge> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/meetings`, section ? { section } : {});
  }
  async listBriefings(incidentId: string): Promise<Briefing[]> {
    return (await this.request<{ briefings: Briefing[] }>("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/briefings`)).briefings;
  }
  scheduleBriefing(incidentId: string, input: { title: string; scheduledAt: string; section?: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/briefings`, { ...input });
  }

  // ---- Facility status requests and tracked object detail (optional integrations) ----
  /** Asks every facility, or every facility of one kind, to report now; its next status report answers. */
  launchStatusQuery(jurisdictionId: string, input: { prompt: string; kind?: string; dueInSeconds?: number }): Promise<{ id: string; targets: number }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/status-queries`, { ...input });
  }
  /** The jurisdiction's status requests, newest first, each with its answers so far. */
  listStatusQueries(jurisdictionId: string, page: PageOptions = {}): Promise<{
    queries: Array<StatusQuery & { readonly createdAt: string }>; nextCursor: string | null;
  }> {
    const params = pageParams(page);
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/status-queries${params.size ? `?${params}` : ""}`);
  }
  statusQuery(id: string): Promise<StatusQuery> {
    return this.request("GET", `/api/v1/status-queries/${encodeURIComponent(id)}`);
  }
  /** The object with one page of its custody chain, oldest first. */
  trackedObject(id: string, page: PageOptions = {}): Promise<TrackedObject> {
    const params = pageParams(page);
    return this.request("GET", `/api/v1/tracked-objects/${encodeURIComponent(id)}${params.size ? `?${params}` : ""}`);
  }

  // ---- Notification rules, settings and single-record screens ----

  /** A new rule; a rule with a webhook channel carries its signing secret, returned only here. */
  createNotificationRule(jurisdictionId: string, rule: NotificationRuleInput): Promise<{ id: string; webhookSecret: string | null }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/notification-rules`,
      rule as unknown as Record<string, unknown>);
  }
  /** Every live rule of the jurisdiction, oldest first, read page by page. */
  listNotificationRules(jurisdictionId: string): Promise<NotificationRule[]> {
    return readAllPages(async (page) => {
      const result = await this.request<{ rules: NotificationRule[]; nextCursor: string | null }>(
        "GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/notification-rules?${pageParams(page)}`);
      return { items: result.rules, nextCursor: result.nextCursor };
    });
  }
  /** Pause, resume or change a rule; a rule's first webhook brings a signing secret, returned only here. */
  updateNotificationRule(ruleId: string, change: NotificationRuleChange): Promise<{ id: string; webhookSecret: string | null }> {
    return this.request("PATCH", `/api/v1/notification-rules/${encodeURIComponent(ruleId)}`,
      change as unknown as Record<string, unknown>);
  }
  async removeNotificationRule(ruleId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/notification-rules/${encodeURIComponent(ruleId)}`);
  }
  getNotificationAllowlist(jurisdictionId: string): Promise<{ entries: string[]; updatedAt: string | null }> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/notification-allowlist`);
  }
  /** Replace the allowlist; resolves with the entries as the server normalized them. */
  setNotificationAllowlist(jurisdictionId: string, entries: readonly string[]): Promise<{ entries: string[] }> {
    return this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/notification-allowlist`, { entries });
  }
  /** Standing lifeline status for the jurisdiction, outside any incident. */
  async jurisdictionLifelines(jurisdictionId: string): Promise<LifelineCurrent[]> {
    return (await this.request<{ lifelines: LifelineCurrent[] }>("GET",
      `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/lifelines`)).lifelines;
  }
  async setJurisdictionLifeline(jurisdictionId: string, input: { lifeline: string; status: string; note?: string }): Promise<LifelineCurrent[]> {
    return (await this.request<{ lifelines: LifelineCurrent[] }>("PUT",
      `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/lifelines`, input)).lifelines;
  }
  /** Both settings are written together; a null retention keeps messages. */
  setMessagingSettings(jurisdictionId: string, input: { retentionDays: number | null; inIncidentRecord: boolean }): Promise<{ ok: true }> {
    return this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/messaging-settings`, input);
  }
  /** Every message in a thread as one line each: time, sender and text. */
  async exportThread(threadId: string): Promise<string[]> {
    return (await this.request<{ lines: string[] }>("GET", `/api/v1/threads/${encodeURIComponent(threadId)}/export`)).lines;
  }
  createLibrary(jurisdictionId: string, input: { title: string; kind: LibraryKind; body: string; forTemplate?: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/libraries`, input);
  }
  completeChecklistItem(itemId: string): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/checklist-items/${encodeURIComponent(itemId)}/complete`);
  }
  /** Replace a dataset's items with these raw source records, mapped by the dataset's field mapping. */
  async loadDataset(datasetId: string, records: readonly unknown[]): Promise<DatasetLoadResult> {
    return (await this.request<{ result: DatasetLoadResult }>("POST",
      `/api/v1/data-packs/datasets/${encodeURIComponent(datasetId)}/load`, { records })).result;
  }
  createDashboard(jurisdictionId: string, input: { templateKey: string; version?: number; title?: string }): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/dashboards`, input);
  }
  exportDashboardTemplate(key: string, version: number): Promise<DashboardTemplate> {
    return this.request("GET", `/api/v1/dashboard-templates/${encodeURIComponent(key)}/${version}/export`);
  }
  getCorrectiveAction(id: string): Promise<CorrectiveAction> {
    return this.request("GET", `/api/v1/corrective-actions/${encodeURIComponent(id)}`);
  }
  compareIncidentImpact(incidentId: string, fromRevision: number, toRevision: number, bbox?: ViewportBbox): Promise<IncidentImpactComparison> {
    const params = new URLSearchParams({ fromRevision: String(fromRevision), toRevision: String(toRevision) });
    if (bbox) params.set("bbox", bbox.join(","));
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/impact/compare?${params}`);
  }
  importDamageBaseline(jurisdictionId: string, rows: readonly DamageBaselineRow[]): Promise<{ imported: number }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/damage/baseline`, { rows });
  }

  // ---- Contacts and mass notification ----
  listContacts(jurisdictionId: string, search = "", page: PageOptions = {}): Promise<ContactsPage> {
    const params = pageParams(page, new URLSearchParams(search ? { q: search } : {}));
    const query = params.size ? `?${params}` : "";
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/contacts${query}`);
  }
  createContact(jurisdictionId: string, input: ContactInput): Promise<Contact> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/contacts`,
      input as unknown as Record<string, unknown>);
  }
  updateContact(contactId: string, input: ContactInput): Promise<Contact> {
    return this.request("PUT", `/api/v1/contacts/${encodeURIComponent(contactId)}`, input as unknown as Record<string, unknown>);
  }
  deleteContact(contactId: string): Promise<void> {
    return this.request("DELETE", `/api/v1/contacts/${encodeURIComponent(contactId)}`);
  }
  /** A dry run reports each row and writes nothing; a commit imports every row or none. */
  importContacts(jurisdictionId: string, input: { csv: string; dryRun: boolean; mapping?: ImportMapping }): Promise<ContactImportResult> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/contacts/import`,
      input as unknown as Record<string, unknown>);
  }
  listContactGroups(jurisdictionId: string, page: PageOptions = {}): Promise<ContactGroupsPage> {
    const params = pageParams(page);
    const query = params.size ? `?${params}` : "";
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/contact-groups${query}`);
  }
  createContactGroup(jurisdictionId: string, input: { name: string; contactIds: readonly string[] }): Promise<ContactGroup> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/contact-groups`,
      input as unknown as Record<string, unknown>);
  }
  updateContactGroup(groupId: string, input: { name: string; contactIds: readonly string[] }): Promise<ContactGroup> {
    return this.request("PUT", `/api/v1/contact-groups/${encodeURIComponent(groupId)}`, input as unknown as Record<string, unknown>);
  }
  deleteContactGroup(groupId: string): Promise<void> {
    return this.request("DELETE", `/api/v1/contact-groups/${encodeURIComponent(groupId)}`);
  }
  listMassNotifications(jurisdictionId: string, page: PageOptions = {}): Promise<MassNotificationsPage> {
    const params = pageParams(page);
    const query = params.size ? `?${params}` : "";
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/mass-notifications${query}`);
  }
  sendMassNotification(jurisdictionId: string, input: MassSendInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/mass-notifications`,
      input as unknown as Record<string, unknown>);
  }
  getMassNotification(massNotificationId: string): Promise<MassNotificationDetail> {
    return this.request("GET", `/api/v1/mass-notifications/${encodeURIComponent(massNotificationId)}`);
  }
  /** Records who was reached from a printed call-down sheet, when, and their answer; all or none. */
  recordMassAcknowledgements(massNotificationId: string, entries: readonly SheetEntry[]): Promise<{ recorded: number }> {
    return this.request("POST", `/api/v1/mass-notifications/${encodeURIComponent(massNotificationId)}/acknowledgements`, { entries });
  }

  // ---- Board local fields ----
  /** Adds an `x_` field to one board at once, outside any template version; jurisdiction admins only. */
  addLocalField(boardId: string, field: FieldDef): Promise<{ ok: true }> {
    return this.request("POST", `/api/v1/boards/${encodeURIComponent(boardId)}/local-fields`, field as unknown as Record<string, unknown>);
  }

  /** Public Assistance line items, newest first, with the counted totals by category. */
  listPaItems(jurisdictionId: string, options: PageOptions = {}): Promise<PaItemPage> {
    const text = pageParams(options).toString();
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/damage/pa-items${text ? `?${text}` : ""}`);
  }
  createPaItem(jurisdictionId: string, input: PaItemInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/damage/pa-items`, { ...input });
  }
  async updatePaItem(itemId: string, input: PaItemInput): Promise<void> {
    await this.request("PUT", `/api/v1/damage/pa-items/${encodeURIComponent(itemId)}`, { ...input });
  }
  // ---- Public Assistance force account (VC-10) ----
  paRates(jurisdictionId: string): Promise<{ labor: LaborRateView[]; equipment: EquipmentRateView[] }> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/pa-rates`);
  }
  setLaborRate(jurisdictionId: string, personId: string, rate: LaborRateInput): Promise<LaborRateView> {
    return this.request("PUT", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/pa-labor-rates/${encodeURIComponent(personId)}`, { ...rate });
  }
  importEquipmentRates(jurisdictionId: string, body: EquipmentRateImport): Promise<{ inserted: number; updated: number }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/pa-equipment-rates`, { ...body });
  }
  forceAccount(incidentId: string, timeZone: string): Promise<ForceAccountSummary> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/force-account?timeZone=${encodeURIComponent(timeZone)}`);
  }
  rollUpForceAccount(incidentId: string, paItemId: string, timeZone: string): Promise<{ paItemId: string; summary: ForceAccountSummary }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/force-account/roll-up`, { paItemId, timeZone });
  }
  recordEquipmentHours(incidentId: string, input: EquipmentHoursInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/equipment-hours`, { ...input });
  }
  async removeEquipmentHours(hoursId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/equipment-hours/${encodeURIComponent(hoursId)}`);
  }

  // ---- Volunteer and CERT roster (VC-20) ----
  /** The jurisdiction's roster, with every deployment and the hours across incidents. */
  volunteerRoster(jurisdictionId: string, timeZone: string): Promise<VolunteerRoster> {
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/volunteers?timeZone=${encodeURIComponent(timeZone)}`);
  }
  /** The roster as read for an incident: its deployments and hours, and a partner's own volunteers only. */
  incidentVolunteerRoster(incidentId: string, timeZone: string): Promise<VolunteerRoster> {
    return this.request("GET", `/api/v1/incidents/${encodeURIComponent(incidentId)}/volunteers?timeZone=${encodeURIComponent(timeZone)}`);
  }
  createVolunteer(jurisdictionId: string, input: VolunteerInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/volunteers`, { ...input });
  }
  /** A partner organization's own volunteer, entered for the incident it takes part in. */
  createIncidentVolunteer(incidentId: string, input: VolunteerInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/incidents/${encodeURIComponent(incidentId)}/volunteers`, { ...input });
  }
  updateVolunteer(volunteerId: string, input: VolunteerInput): Promise<{ id: string }> {
    return this.request("PUT", `/api/v1/volunteers/${encodeURIComponent(volunteerId)}`, { ...input });
  }
  deployVolunteer(volunteerId: string, input: VolunteerDeploymentInput): Promise<{ id: string }> {
    return this.request("POST", `/api/v1/volunteers/${encodeURIComponent(volunteerId)}/deployments`, { ...input });
  }
  updateVolunteerDeployment(deploymentId: string, input: VolunteerDeploymentUpdate): Promise<{ id: string }> {
    return this.request("PUT", `/api/v1/volunteer-deployments/${encodeURIComponent(deploymentId)}`, { ...input });
  }
  async removeVolunteerDeployment(deploymentId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/volunteer-deployments/${encodeURIComponent(deploymentId)}`);
  }

  // ---- Reports ----
  listReports(jurisdictionId: string, page: PageOptions = {}): Promise<ReportsPage> {
    const params = pageParams(page);
    const query = params.size ? `?${params}` : "";
    return this.request("GET", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/reports${query}`);
  }
  createReport(jurisdictionId: string, input: ReportInput): Promise<SavedReport> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/reports`,
      input as unknown as Record<string, unknown>);
  }
  /** Run an unsaved definition: its first rows, with groups and totals over every record. */
  previewReport(jurisdictionId: string, input: Pick<ReportInput, "boardId" | "incidentId" | "definition">): Promise<ReportResult> {
    return this.request("POST", `/api/v1/jurisdictions/${encodeURIComponent(jurisdictionId)}/reports/preview`,
      input as unknown as Record<string, unknown>);
  }
  getReport(reportId: string): Promise<SavedReportDetail> {
    return this.request("GET", `/api/v1/reports/${encodeURIComponent(reportId)}`);
  }
  updateReport(reportId: string, input: ReportInput): Promise<SavedReport> {
    return this.request("PUT", `/api/v1/reports/${encodeURIComponent(reportId)}`, input as unknown as Record<string, unknown>);
  }
  async deleteReport(reportId: string): Promise<void> {
    await this.request("DELETE", `/api/v1/reports/${encodeURIComponent(reportId)}`);
  }
  runReport(reportId: string): Promise<ReportResult & { readonly name: string }> {
    return this.request("GET", `/api/v1/reports/${encodeURIComponent(reportId)}/output?format=json`);
  }
  downloadReport(reportId: string, format: ReportFormat): Promise<Blob> {
    return this.requestBlob(`/api/v1/reports/${encodeURIComponent(reportId)}/output?format=${format}`);
  }
}

// ---- Notification channel types ----

/** The kinds of content a signed solution package carries, in the order a summary lists them. */
export const SOLUTION_PARTS = [
  ["boardTemplates", "board templates"],
  ["incidentTemplates", "incident templates"],
  ["forms", "forms"],
  ["dashboardTemplates", "dashboard templates"],
  ["reportTemplates", "report templates"],
  ["ruleTemplates", "rule templates"],
] as const;
export type SolutionPart = (typeof SOLUTION_PARTS)[number][0];

/** What a solution package import did with each part: created, already held, or kept as the instance had it. */
export interface SolutionImportSummary {
  readonly id: string;
  readonly publisher: string;
  readonly name: string;
  readonly version: string;
  readonly publishedAt: string;
  readonly keyFingerprint: string;
  readonly parts: Readonly<Record<SolutionPart, { readonly created: readonly string[]; readonly held: readonly string[]; readonly kept: readonly string[] }>>;
}

/** A solution package import as the instance recorded it: the summary, when and by whom. */
export interface ImportedSolutionPackage extends SolutionImportSummary {
  readonly importedAt: string;
  readonly importedBy: string;
}

export type NotificationChannelKind = "email" | "sms";
export type DeliveryHoldKind = "email" | "sms" | "webhook" | "ntfy";
/** How long one kind of delivery waits for a route; isDefault when the jurisdiction set none (72 hours). */
export interface DeliveryHold {
  readonly kind: DeliveryHoldKind;
  readonly hours: number;
  readonly isDefault: boolean;
  readonly updatedAt?: string | null;
}
export interface NotificationChannelView {
  readonly kind: NotificationChannelKind;
  readonly settings: Readonly<Record<string, unknown>> | null;
  readonly credentialFingerprint: string | null;
  readonly updatedAt: string | null;
  readonly secretStorageAvailable: boolean;
  /** SMS only: what the fixture provider recorded instead of sending, newest first. */
  readonly fixtureMessages?: ReadonlyArray<{ readonly messageId: string; readonly to: string; readonly body: string; readonly at: string }>;
  /** SMS only: the last texts read from an SMS gateway, newest first, with what each recorded. */
  readonly replies?: readonly SmsReply[];
}
export interface SmsReply {
  readonly id: string;
  readonly sender: string;
  readonly body: string;
  readonly receivedAt: string;
  readonly readAt: string;
  readonly outcome: "acknowledged" | "answered" | "not_an_answer" | "unmatched";
  /** Whom it answered, and the send; null when it matched no one. */
  readonly recipient: string | null;
  readonly subject: string | null;
}
export interface SmsRepliesRead {
  readonly read: number;
  readonly acknowledged: number;
  readonly answered: number;
  readonly notAnAnswer: number;
  readonly unmatched: number;
}


// ---- Board engine types ----

/** Request-time refinements of a board view. */
export interface BoardViewQuery {
  readonly incidentId?: string;
  readonly archived?: "exclude" | "include" | "only";
  readonly where?: readonly ViewCondition[];
  readonly sorts?: ReadonlyArray<{ readonly field: string; readonly dir: "asc" | "desc" }>;
  readonly groupBy?: string;
}
function boardViewParams(query: BoardViewQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (query.incidentId) params.set("incidentId", query.incidentId);
  if (query.archived) params.set("archived", query.archived);
  if (query.where?.length) params.set("where", JSON.stringify(query.where));
  if (query.sorts?.length) params.set("sort", query.sorts.map((s) => `${s.field}:${s.dir}`).join(","));
  if (query.groupBy) params.set("groupBy", query.groupBy);
  return params;
}
export interface BoardRecordChange {
  readonly seq: number; readonly id: string; readonly at: string; readonly category: string;
  readonly corrects: string | null; readonly actor: BoardRecordActor;
  readonly changes: ReadonlyArray<{ readonly field: string; readonly before: unknown; readonly after: unknown }>;
}
export interface BoardImportResult {
  readonly dryRun: boolean;
  readonly rows: number;
  readonly created: number;
  readonly mapping: Readonly<Record<string, string>>;
  readonly ignored: readonly string[];
  readonly errorCount: number;
  readonly errors: ReadonlyArray<{ readonly row: number; readonly field?: string; readonly message: string }>;
}
export interface WebeocSavedMapping {
  readonly mapping: Readonly<Record<string, string>> | null;
  readonly timeZone: string | null;
  readonly updatedAt: string | null;
}
export interface WebeocRowOutcome {
  readonly row: number;
  readonly dataid: string | null;
  readonly outcome: "create" | "skip" | "reject";
  readonly reasons: readonly string[];
  readonly recordId?: string;
}
export interface WebeocImportReport {
  readonly dryRun: boolean;
  readonly columns: readonly string[];
  readonly mapping: Readonly<Record<string, string>>;
  readonly provenance: readonly string[];
  readonly dropped: readonly string[];
  readonly rows: number;
  readonly valid: number;
  readonly created: number;
  readonly skipped: number;
  readonly rejected: number;
  readonly outcomes: readonly WebeocRowOutcome[];
  readonly rejectionCsv: string;
}


// ---- Notification rule, library and load types ----

/** A rule channel, shaped as the server's channel schema accepts it. */
export type NotificationChannel =
  | { readonly kind: "inapp"; readonly target: "requesting_position" }
  | { readonly kind: "webhook"; readonly url: string }
  | { readonly kind: "ntfy"; readonly url: string; readonly topic: string }
  | { readonly kind: "email"; readonly to: readonly string[] }
  | { readonly kind: "sms"; readonly to: readonly string[] }
  | { readonly kind: "group"; readonly groupId: string; readonly via: readonly ReachVia[] }
  | { readonly kind: "position"; readonly positionId: string; readonly reach: "holders" | "on_call"; readonly via: readonly ReachVia[] };
/** How a group or position channel reaches each person. */
export type ReachVia = "inapp" | "email" | "sms";
export interface NotificationRuleInput {
  readonly boardId: string | null;
  readonly event: "record.created" | "record.updated" | "scheduled";
  readonly condition: { readonly op: "any" | "eq" | "changed_to"; readonly field?: string; readonly value?: string };
  readonly channels: readonly NotificationChannel[];
  readonly scheduleIntervalMinutes?: number;
  readonly rateLimit: { readonly max: number; readonly windowMinutes: number };
}
export interface NotificationRule extends Omit<NotificationRuleInput, "scheduleIntervalMinutes"> {
  readonly id: string;
  readonly boardTitle: string | null;
  readonly scheduleIntervalMinutes: number | null;
  readonly enabled: boolean;
  readonly createdAt: string;
}
export type NotificationRuleChange = Partial<Omit<NotificationRuleInput, "scheduleIntervalMinutes">> & {
  readonly enabled?: boolean;
  readonly scheduleIntervalMinutes?: number | null;
};
export type LibraryKind = "scenario" | "plan" | "reference";
export interface DatasetLoadResult {
  readonly key: string;
  readonly availability: DatasetStatus["availability"];
  readonly itemCount: number | null;
  readonly received: number;
  readonly accepted: number;
  readonly rejected: number;
}

// ---- JIC list types ----

export interface JicListFilter {
  /** Any of these statuses; omitted, every status. */
  readonly statuses?: readonly string[];
  readonly incidentId?: string;
}
export interface JicReleaseListItem {
  readonly id: string;
  readonly incidentId: string | null;
  readonly title: string;
  readonly body: string;
  readonly status: string;
  readonly requiredAgencies: readonly string[];
  readonly decisions: ReadonlyArray<{
    readonly agency: string;
    readonly decision: "approve" | "reject";
    readonly note: string | null;
    readonly decidedAt: string;
  }>;
  /** Whether the signed-in person already decided; each person decides once per release. */
  readonly decidedByMe: boolean;
  readonly createdAt: string;
  readonly submittedAt: string | null;
}
export interface JicInquiryListItem {
  readonly id: string;
  readonly incidentId: string | null;
  readonly outlet: string;
  readonly subject: string;
  readonly question: string;
  readonly status: "open" | "assigned" | "answered";
  readonly assignedPositionId: string | null;
  readonly responseReleaseId: string | null;
  readonly createdAt: string;
  readonly answeredAt: string | null;
}
function jicListQuery(filter: JicListFilter, page: PageOptions): string {
  const params = pageParams(page);
  if (filter.statuses?.length) params.set("status", filter.statuses.join(","));
  if (filter.incidentId) params.set("incidentId", filter.incidentId);
  return params.size ? `?${params}` : "";
}

// ---- Administration types ----

export type MemberRole = "admin" | "member" | "viewer";
export interface AdminMember {
  readonly personId: string;
  readonly displayName: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly disabled: boolean;
  readonly mfaEnrolled: boolean;
  readonly instanceAdmin: boolean;
}
export interface MembersPage {
  readonly jurisdiction: { readonly id: string; readonly slug: string; readonly name: string };
  readonly members: readonly AdminMember[];
  readonly nextCursor: string | null;
}
export interface PersonRef {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}
export interface AdminGuestGrant {
  readonly id: string;
  readonly person: PersonRef;
  readonly scopes: readonly string[];
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly revokedAt: string | null;
}
export interface GuestGrantPage {
  readonly grants: readonly AdminGuestGrant[];
  readonly nextCursor: string | null;
}
export interface PositionHolder {
  readonly positionId: string;
  readonly personId: string;
  readonly displayName: string;
  readonly assignedAt: string;
}
export interface IntegrationState {
  readonly variable: string;
  readonly integrations: ReadonlyArray<{ readonly key: string; readonly enabled: boolean }>;
}
export interface RetentionPolicy {
  readonly dataClass: string;
  readonly retentionDays: number | null;
  readonly updatedAt: string | null;
  readonly updatedBy: string | null;
}
export interface SignedAuditPage {
  readonly page: { readonly nextCursor: string | null } & Readonly<Record<string, unknown>>;
  readonly signature: Readonly<Record<string, unknown>>;
}

// ---- Optional integration types ----

export interface CollabStatus {
  /** A token is stored; the token itself is never returned. */
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly kind: string | null;
  readonly baseUrl: string | null;
}
export interface CollabBackendInput {
  readonly kind: "mattermost" | "matrix";
  readonly baseUrl: string;
  readonly token?: string;
  readonly homeserver?: string;
  readonly enabled: boolean;
}
export interface MeetingConfig {
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly baseUrl: string | null;
  readonly appId: string | null;
  /** A token secret is stored; the secret itself is never returned. */
  readonly authenticated: boolean;
}
export interface MeetingConfigInput {
  readonly baseUrl: string;
  readonly appId?: string;
  readonly secret?: string;
  readonly enabled: boolean;
}
export interface MeetingBridge {
  readonly room: string;
  readonly section: string;
  readonly url: string;
}
export interface Briefing {
  readonly id: string;
  readonly title: string;
  readonly section: string | null;
  readonly scheduledAt: string;
  readonly notifiedAt: string | null;
}
/** One entry of a pool resource's history, from the audit trail. */
export interface ResourceHistoryEntry {
  readonly at: string;
  readonly actorName: string;
  readonly category: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface StatusQuery {
  readonly id: string;
  readonly prompt: string;
  readonly total: number;
  readonly responded: number;
  readonly complete: boolean;
  readonly outstanding: ReadonlyArray<{ readonly facilityId: string; readonly name: string }>;
}
export interface TrackedObject {
  readonly id: string;
  readonly tag: string;
  readonly kind: string;
  readonly label: string;
  readonly restrictedRedacted: boolean;
  readonly chain: ReadonlyArray<{
    readonly custodyState: string;
    readonly station: string | null;
    readonly agency: string | null;
    readonly location: string | null;
    readonly note: string | null;
    readonly occurredAt: string;
  }>;
  readonly nextCursor: string | null;
}

// ---- Report types ----

export type ReportFormat = "pdf" | "xlsx" | "csv";
export type ReportTotalFunction = "sum" | "avg" | "min" | "max";
export interface ReportDefinition {
  readonly columns: readonly string[];
  readonly where: readonly ViewCondition[];
  /** Up to two fields, outermost first. */
  readonly groupBy: readonly string[];
  readonly totals: ReadonlyArray<{ readonly field: string; readonly fn: ReportTotalFunction }>;
  readonly sorts: ReadonlyArray<{ readonly field: string; readonly dir: "asc" | "desc" }>;
  readonly archived: "exclude" | "include" | "only";
}
export type ReportCadence =
  | { readonly kind: "interval"; readonly minutes: number }
  | { readonly kind: "daily"; readonly time: string; readonly timeZone: string };
export interface ReportSchedule {
  readonly cadence: ReportCadence;
  readonly format: ReportFormat;
  readonly emails: readonly string[];
  readonly contactIds: readonly string[];
  readonly storeFile: boolean;
}
export interface ReportInput {
  readonly name: string;
  readonly boardId: string;
  readonly incidentId: string | null;
  readonly definition: ReportDefinition;
  readonly schedule: ReportSchedule | null;
}
export interface SavedReport extends ReportInput {
  readonly id: string;
  readonly jurisdictionId: string;
  readonly boardTitle: string | null;
  readonly nextRunAt: string | null;
  readonly owner: { readonly personId: string; readonly displayName: string };
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The owner while a writer, or an administrator. */
  readonly canEdit: boolean;
}
export interface ReportRun {
  readonly id: string;
  readonly ranAt: string;
  readonly ranAs: string;
  readonly rows: number | null;
  /** Queued: the report was built and its emails wait in the delivery queue. */
  readonly outcome: "delivered" | "queued" | "partial" | "failed";
  readonly detail: Readonly<Record<string, unknown>>;
}
export interface SavedReportDetail extends SavedReport {
  readonly runs: readonly ReportRun[];
}
export interface ReportsPage {
  readonly reports: readonly SavedReport[];
  readonly nextCursor: string | null;
}
export interface ReportResult {
  readonly board: { readonly id: string; readonly title: string };
  readonly incidentId: string | null;
  readonly generatedAt: string;
  readonly columns: ReadonlyArray<{ readonly key: string; readonly label: string; readonly type: string }>;
  readonly groupBy: ReadonlyArray<{ readonly key: string; readonly label: string; readonly type: string }>;
  readonly totals: ReadonlyArray<{ readonly key: string; readonly field: string; readonly fn: ReportTotalFunction; readonly label: string }>;
  /** Fields the definition names that the person running it cannot read. */
  readonly omitted: readonly string[];
  readonly rows: ReadonlyArray<Readonly<Record<string, unknown>>>;
  /** Each group before its subgroups; its rows are `count` rows from `first`. */
  readonly groups: ReadonlyArray<{
    readonly level: number;
    readonly values: readonly unknown[];
    readonly first: number;
    readonly count: number;
    readonly totals: Readonly<Record<string, number | null>>;
  }>;
  readonly total: { readonly count: number; readonly totals: Readonly<Record<string, number | null>> };
}
