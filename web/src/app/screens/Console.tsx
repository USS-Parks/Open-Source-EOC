import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { BoardList } from "../../design/layout.js";
import { Button } from "../../design/components.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, BoardListItem, DashboardListItem, CollectionRef, FeedHealth, Me, Membership } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { boardsInScope, IncidentSwitcher, useIncident } from "../incident/context.js";
import { useAsync, useNotifications } from "../data/hooks.js";
import {
  AppShell,
  type NavGroup,
  type ShellPage,
  type ShellSyncState,
  type WorkspaceArrangement,
} from "../layout/AppShell.js";
import { ClockNotice } from "../layout/ClockNotice.js";
import { OperationalPeriodControl, PositionControl, useWorkspaceContext, type OperationalPeriodChoice } from "../layout/context.js";
import { parseRouteHash, sectionOf, surfaceHash, useSurface, type RouteContext, type Surface } from "../router.js";
import { EmptyState, ErrorNote, LoadBoundary, Loading, NotFoundState } from "./parts.js";
import type { DashboardSurfaceProps, DashboardViewState } from "../surfaces/DashboardSurface.js";
import type { BoardRecordContext } from "../surfaces/BoardSurface.js";
import { BoardsIndex } from "../surfaces/lists.js";
import { NotificationTray } from "../../notifications/NotificationTray.js";
import { useArrivalAlerts } from "../../notifications/alerting.js";
import { consoleSettingsSections } from "../settings/SettingsSections.js";

/**
 * Every surface, the map with MapLibre and PMTiles, and the Yjs offline tree
 * load on first use, so first paint carries only the shell and the boards
 * list. Once the console is up it fetches the rest in the background, so a
 * screen not yet opened still opens after the network drops. A screen that
 * still fails to load shows an error and a reload instead of a blank console.
 */
const onDemandModules: Array<() => Promise<unknown>> = [];
function onDemand<P extends object>(load: () => Promise<ComponentType<P>>) {
  onDemandModules.push(load);
  return lazy(() => load().then((component) => ({ default: component })));
}

const MapSurface = onDemand(() => import("../surfaces/MapSurface.js").then((m) => m.MapSurface));
// The route carries the dashboard view state as text; its parser ships with the surface.
const DashboardSurface = onDemand(() => import("../surfaces/DashboardSurface.js").then((m) =>
  function RoutedDashboard(props: Omit<DashboardSurfaceProps, "viewState"> & { readonly routeFilter?: string | undefined }) {
    return <m.DashboardSurface {...props} viewState={m.parseDashboardViewState(props.routeFilter)} />;
  }));
const BoardSurface = onDemand(() => import("../surfaces/BoardSurface.js").then((m) => m.BoardSurface));
const BoardRecordDetailPane = onDemand(() => import("../surfaces/BoardSurface.js").then((m) => m.BoardRecordDetailPane));
const TemplatesSurface = onDemand(() => import("../surfaces/TemplatesSurface.js").then((m) => m.TemplatesSurface));
const AdminSurface = onDemand(() => import("../surfaces/AdminSurface.js").then((m) => m.AdminSurface));
const SitrepSurface = onDemand(() => import("../surfaces/SitrepSurface.js").then((m) => m.SitrepSurface));
const SitrepWorkspace = onDemand(() => import("../surfaces/SitrepSurface.js").then((m) => m.SitrepWorkspace));
const FormsSurface = onDemand(() => import("../surfaces/FormsSurface.js").then((m) => m.FormsSurface));
const IapSurface = onDemand(() => import("../surfaces/IapSurface.js").then((m) => m.IapSurface));
const FilesWorkspace = onDemand(() => import("../../coordination/FilesWorkspace.js").then((m) => m.FilesWorkspace));
const IncidentsSurface = onDemand(() => import("../surfaces/IncidentsSurface.js").then((m) => m.IncidentsSurface));
const IncidentAreaEditor = onDemand(() => import("../surfaces/IncidentAreaEditor.js").then((m) => m.IncidentAreaEditor));
const IncidentParticipants = onDemand(() => import("../surfaces/IncidentParticipants.js").then((m) => m.IncidentParticipants));
const TasksSurface = onDemand(() => import("../surfaces/TasksSurface.js").then((m) => m.TasksSurface));
const IncidentDatasets = onDemand(() => import("../surfaces/IncidentDatasets.js").then((m) => m.IncidentDatasets));
const ResourcesSurface = onDemand(() => import("../surfaces/ResourcesSurface.js").then((m) => m.ResourcesSurface));
const AarSurface = onDemand(() => import("../surfaces/AarSurface.js").then((m) => m.AarSurface));
const FeedsSurface = onDemand(() => import("../surfaces/FeedsSurface.js").then((m) => m.FeedsSurface));
const MessagesWorkspace = onDemand(() => import("../../coordination/MessagesWorkspace.js").then((m) => m.MessagesWorkspace));
const SmartFormsSurface = onDemand(() => import("../surfaces/SmartFormsSurface.js").then((m) => m.SmartFormsSurface));
const FieldReportsSurface = onDemand(() => import("../surfaces/FieldReportsSurface.js").then((m) => m.FieldReportsSurface));
const TrackingSurface = onDemand(() => import("../surfaces/TrackingSurface.js").then((m) => m.TrackingSurface));
const DamageSurface = onDemand(() => import("../../damage/DamageSurface.js").then((m) => m.DamageSurface));
const FacilitiesSurface = onDemand(() => import("../../facilities/FacilitiesSurface.js").then((m) => m.FacilitiesSurface));
const AlertsSurface = onDemand(() => import("../surfaces/AlertsSurface.js").then((m) => m.AlertsSurface));
const LifelinesSurface = onDemand(() => import("../surfaces/LifelinesSurface.js").then((m) => m.LifelinesSurface));
const EsfSurface = onDemand(() => import("../surfaces/EsfSurface.js").then((m) => m.EsfSurface));
const ContinuityPanel = onDemand(() => import("../../offline/ContinuityPanel.js").then((m) => m.ContinuityPanel));
const ChronologySurface = onDemand(() => import("../../audit/ChronologySurface.js").then((m) => m.ChronologySurface));
const StaffingSurface = onDemand(() => import("../../staffing/StaffingSurface.js").then((m) => m.StaffingSurface));
const VolunteersSurface = onDemand(() => import("../../volunteers/VolunteersSurface.js").then((m) => m.VolunteersSurface));
const FederationSurface = onDemand(() => import("../../federation/FederationSurface.js").then((m) => m.FederationSurface));
const ContactsSurface = onDemand(() => import("../../contacts/ContactsSurface.js").then((m) => m.ContactsSurface));
const MassNotificationSurface = onDemand(() => import("../../contacts/MassNotificationSurface.js").then((m) => m.MassNotificationSurface));
const ReportsSurface = onDemand(() => import("../../reports/ReportsSurface.js").then((m) => m.ReportsSurface));
const IncidentOverview = onDemand(() => import("../surfaces/IncidentOverview.js").then((m) => m.IncidentOverview));

const NAV: readonly NavGroup[] = [
  { key: "situation", label: "Situation", items: [
    { key: "overview", label: "Overview", icon: "overview" },
    { key: "map", label: "Map", icon: "map" },
    { key: "lifelines", label: "ESFs & Lifelines", icon: "lifelines" },
    { key: "sitreps", label: "SITREP", icon: "sitrep" },
    { key: "chronology", label: "Chronology", icon: "fieldReports" },
    { key: "dashboards", label: "Dashboards", icon: "dashboards" },
  ] },
  { key: "operations", label: "Operations", items: [
    { key: "boards", label: "Boards", icon: "boards" },
    { key: "resources", label: "Resources", icon: "resources" },
    { key: "tasks", label: "Tasks", icon: "tasks" },
    { key: "fieldReports", label: "Field Reports", icon: "fieldReports" },
    { key: "smartForms", label: "Smart Forms", icon: "smartForms" },
    { key: "tracking", label: "Tracking", icon: "tracking" },
    { key: "damage", label: "Damage Assessment", icon: "fieldReports" },
    { key: "staffing", label: "Staffing", icon: "participants" },
    { key: "volunteers", label: "Volunteers", icon: "participants" },
    { key: "facilities", label: "Facilities", icon: "lifelines" },
  ] },
  { key: "planning", label: "Planning", items: [
    { key: "operationalPeriods", label: "Operational Periods", icon: "operationalPeriods" },
    { key: "iap", label: "IAP", icon: "iap" },
    { key: "forms", label: "ICS Forms", icon: "forms" },
    { key: "aar", label: "AAR", icon: "aar" },
    { key: "reports", label: "Reports", icon: "sitrep" },
  ] },
  { key: "coordination", label: "Coordination", items: [
    { key: "participants", label: "Participants", icon: "participants" },
    { key: "messages", label: "Messages", icon: "messages" },
    { key: "jic", label: "JIC", icon: "jic" },
    { key: "files", label: "Files", icon: "files" },
    { key: "contacts", label: "Contacts", icon: "participants" },
    { key: "massNotification", label: "Mass Notification", icon: "alerts" },
  ] },
  { key: "data", label: "Data and administration", items: [
    { key: "incidentSetup", label: "Incident Setup", icon: "incidentSetup" },
    { key: "datasets", label: "Datasets", icon: "datasets" },
    { key: "feeds", label: "Feeds", icon: "feeds" },
    { key: "templates", label: "Templates", icon: "templates" },
    { key: "admin", label: "Administration", icon: "settings" },
    { key: "federation", label: "Federation", icon: "participants" },
  ] },
];
/** The rail without the entries this account or deployment cannot use, so no entry opens a refusal. */
function railFor(administers: boolean, designsBoards: boolean, integrations: ReadonlySet<string>, member: boolean): readonly NavGroup[] {
  const hidden = new Set([
    ...(administers ? [] : ["admin", "federation"]),
    // The directory, mass notification and reports belong to members of the jurisdiction in view.
    ...(member ? [] : ["contacts", "massNotification", "reports"]),
    ...(designsBoards ? [] : ["templates"]),
    // Optional integrations register no routes when off, so their entries go too.
    ...["facilities", "tracking"].filter((key) => !integrations.has(key)),
  ]);
  return NAV.map((group) => ({ ...group, items: group.items.filter((item) => !hidden.has(item.key)) }));
}

/** The sections the canonical frames' rail shows; the others are listed when a viewer asks for every section. */
const CORE_SECTIONS = new Set([
  "overview", "map", "lifelines", "sitreps", "boards", "resources", "tasks", "fieldReports",
  "operationalPeriods", "iap", "participants", "messages",
]);
const ALL_SECTIONS_KEY = "openeoc.navigation.allSections";

/** The core rail, keeping the section in view so the viewer always sees where it is. */
function coreRail(rail: readonly NavGroup[], active: string): readonly NavGroup[] {
  return rail
    .map((group) => ({ ...group, items: group.items.filter((item) => CORE_SECTIONS.has(item.key) || item.key === active) }))
    .filter((group) => group.items.length > 0);
}

function readAllSections(): boolean {
  try { return localStorage.getItem(ALL_SECTIONS_KEY) === "1"; } catch { return false; }
}

function saveAllSections(value: boolean): void {
  try { localStorage.setItem(ALL_SECTIONS_KEY, value ? "1" : "0"); } catch { /* a viewer convenience only */ }
}

/**
 * The operations console: the map-first hybrid. The rail switches the
 * center surface, the right dock keeps the boards and notifications always
 * in reach, and every surface reads live data through the one API client.
 */
export function Console(props: { theme: ThemeName; onToggleTheme: () => void }) {
  const session = useSession();
  const { client } = session;
  const jurisdictionId = session.jurisdictionId;
  const incident = useIncident();
  const workspace = useWorkspaceContext();
  const { surface, routeContext, navigate } = useSurface();
  const [recordContext, setRecordContext] = useState<BoardRecordContext | null>(null);
  const [allSections, setAllSections] = useState(readAllSections);
  const receiveRecordContext = useCallback((next: BoardRecordContext | null) => setRecordContext(next), []);
  const viewingJurisdictionId = incident.selectedIncident?.jurisdictionId ?? jurisdictionId;
  const viewingMembership = session.me?.memberships.find(
    (membership) => membership.jurisdictionId === viewingJurisdictionId,
  );
  const resourceJurisdictionId = viewingMembership ? viewingJurisdictionId : jurisdictionId;
  const resourceMembership = session.me?.memberships.find(
    (membership) => membership.jurisdictionId === resourceJurisdictionId,
  );

  const boards = useAsync(
    () =>
      viewingJurisdictionId && viewingMembership
        ? client.listBoards(viewingJurisdictionId)
        : Promise.resolve(
            incident.incidentBoards.map((board) => ({
              ...board,
              templateKey: "",
              templateVersion: 0,
              hasGeometry: false,
            })),
          ),
    [viewingJurisdictionId, viewingMembership?.role, incident.incidentBoards],
  );
  const collections = useAsync(() => client.listCollections(), [incident.selectedIncidentId]);
  const feeds = useAsync(
    () =>
      viewingJurisdictionId && viewingMembership
        ? client.listFeeds(viewingJurisdictionId)
        : Promise.resolve([]),
    [viewingJurisdictionId, viewingMembership?.role],
  );
  const dashboards = useAsync(
    () =>
      viewingJurisdictionId
        ? incident.selectedIncidentId
          ? client.listIncidentDashboards(viewingJurisdictionId, incident.selectedIncidentId)
          : client.listDashboards(viewingJurisdictionId)
        : Promise.resolve([]),
    [viewingJurisdictionId, incident.selectedIncidentId],
  );
  const integrations = useAsync(
    () =>
      viewingJurisdictionId && viewingMembership
        ? client.listIntegrations().then((state) => state.integrations.filter((i) => i.enabled).map((i) => i.key))
        : Promise.resolve([]),
    [viewingJurisdictionId, viewingMembership?.role],
  );
  const enabledIntegrations = useMemo(() => new Set<string>(integrations.data ?? []), [integrations.data]);
  // null while the check runs; an unreachable check hides the screen like a disabled one.
  const facilitiesEnabled = integrations.error ? false : integrations.data ? enabledIntegrations.has("facilities") : null;
  const notifications = useNotifications(client);
  useArrivalAlerts(notifications.data);
  const [lastNotificationCheck, setLastNotificationCheck] = useState<Date | null>(null);
  useEffect(() => {
    if (!notifications.loading && !notifications.error && notifications.data) setLastNotificationCheck(new Date());
  }, [notifications.data, notifications.error, notifications.loading]);

  useEffect(() => {
    if (surface.kind !== "board" || !routeContext.recordId) setRecordContext(null);
  }, [routeContext.recordId, surface.kind]);

  useEffect(() => {
    // One module at a time, so the warm-up never takes the connections the
    // console's own requests need. Best effort: opening a surface loads it anyway.
    void (async () => {
      for (const load of onDemandModules) await load().catch(() => undefined);
    })();
  }, []);

  if (!jurisdictionId) {
    return (
      <EmptyState
        label="No jurisdiction membership."
        hint="This account is not a member of any jurisdiction yet."
      />
    );
  }

  // Until the incident list is in and the selection has followed it, the
  // console waits as it does for the workspace below: a console mounted with
  // no incident would be taken down again when the incident is chosen, and
  // whatever the operator had opened in it, such as a menu, would close.
  if (!incident.settled) return <Loading label="Restoring workspace…" />;
  const expectedWorkspaceScope = session.me && incident.selectedIncidentId
    ? `${session.me.person.id}:${incident.selectedIncidentId}`
    : null;
  if (expectedWorkspaceScope && workspace.loadedScope !== expectedWorkspaceScope && workspace.phase === "loading") {
    return <Loading label="Restoring workspace…" />;
  }

  const baseContext: RouteContext = {
    ...(incident.selectedIncidentId ? { incidentId: incident.selectedIncidentId } : {}),
    periodRevision: workspace.selectedPeriodRevision,
  };
  const navigateInContext = (next: Surface) => navigate(next, baseContext);
  const returnRoute = routeContext.returnTo ? parseRouteHash(routeContext.returnTo) : null;
  const canReturn = Boolean(returnRoute && returnRoute.context.incidentId === incident.selectedIncidentId
    && returnRoute.surface.kind !== "not-found");

  const boardItems: readonly BoardListItem[] = boards.data ?? [];
  // Navigation lists and the map show the selected incident's boards and the
  // jurisdiction's own; another incident's boards stay out of the way.
  const scopedBoards = boardsInScope(boardItems, incident.selectedIncidentId);
  const outOfScope = new Set(boardItems.filter((board) => !scopedBoards.includes(board)).map((board) => board.id));
  const dock = (
    <>
      {workspace.message && (workspace.phase === "conflict" || workspace.phase === "error") ? (
        <section className="eoc-shell-context-state" aria-label="Workspace settings status">
          <h2 className="eoc-dock-heading">Workspace settings</h2>
          <p role="alert">{workspace.message}</p>
          <div>
            <Button kind="quiet" onClick={workspace.reloadSaved}>Reload saved settings</Button>
            {workspace.conflict ? <Button kind="primary" onClick={() => void workspace.keepSession()}>Keep this session</Button> : null}
          </div>
        </section>
      ) : null}
      {surface.kind === "board" && routeContext.recordId ? (
        <section aria-label="Selected record">
          <h2 className="eoc-dock-heading">Selected record</h2>
          {recordContext?.status === "loading" || !recordContext ? <p>Loading record context…</p> : null}
          {recordContext?.status === "missing" ? <p role="status">Record unavailable in this view</p> : null}
          {recordContext?.status === "ready" ? (
            <>
              <LoadBoundary name="Record detail"><Suspense fallback={null}><BoardRecordDetailPane context={recordContext} /></Suspense></LoadBoundary>
              <Button
                kind="quiet"
                onClick={() => navigate(
                  { kind: "files" },
                  {
                    ...baseContext,
                    boardId: surface.id,
                    recordId: recordContext.detail.id,
                    returnTo: surfaceHash(surface, routeContext),
                  },
                )}
              >
                Files for this record
              </Button>
              {boardItems.find((board) => board.id === surface.id)?.hasGeometry ? (
                <Button kind="quiet" onClick={() => navigate({ kind: "map" }, { ...baseContext, boardId: surface.id, recordId: recordContext.detail.id })}>
                  Show on map
                </Button>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      {canReturn && returnRoute ? (
        <section aria-label="Return path">
          <Button kind="quiet" onClick={() => navigate(returnRoute.surface, returnRoute.context)}>
            {returnRoute.context.recordId ? "Return to record" : "Return to previous workspace"}
          </Button>
        </section>
      ) : null}
      <LoadBoundary name="Offline continuity"><Suspense fallback={null}>
        <ContinuityPanel
          client={client}
          personId={session.me?.person.id ?? null}
          incidentId={incident.selectedIncidentId}
          onRecoverSession={session.recoverSession}
          onOpenBoards={() => navigateInContext({ kind: "boards" })}
        />
      </Suspense></LoadBoundary>
      <section aria-label="Boards">
        <h2 className="eoc-dock-heading">Boards</h2>
        {scopedBoards.length === 0 ? (
          <p className="eoc-flush eoc-muted">No boards yet.</p>
        ) : (
          <BoardList
            boards={scopedBoards.map((b) => ({ id: b.id, name: b.title }))}
            onOpen={(id) => navigateInContext({ kind: "board", id })}
          />
        )}
      </section>
    </>
  );

  const notificationSync: ShellSyncState = notifications.error
    ? { state: "error", label: lastNotificationCheck ? `Update failed · checked ${formatTime(lastNotificationCheck)}` : "Updates unavailable" }
    : notifications.loading && !notifications.data
      ? { state: "checking", label: "Checking updates" }
      : { state: "current", live: notifications.live, label: lastNotificationCheck ? `Synced ${formatTime(lastNotificationCheck)}` : "Synced" };
  const sync: ShellSyncState = session.offline
    ? { state: "error", label: "No connection · working offline" }
    : workspace.phase === "loading" || workspace.phase === "saving"
      ? { state: "checking", label: workspace.message ?? "Restoring workspace" }
      : workspace.phase === "conflict" || workspace.phase === "error"
        ? { state: "error", label: workspace.message ?? "Workspace settings unavailable" }
        : notificationSync;
  const scope = `${incident.selectedIncident?.name ?? "No incident selected"} · ${workspace.selectedPeriodDisplay}`;
  // The overview and the lifelines workspace keep their context drawer closed and offer no opener.
  const drawerless = ["lifelines", "lifeline", "esf", "dashboard", "overview", "briefing"].includes(surface.kind);
  const page = pageFor(surface, scope);

  const rail = railFor(
    Boolean(session.me?.isInstanceAdmin || session.me?.memberships.some((m) => m.role === "admin")),
    // A jurisdiction's administrators create boards from published templates; publishing also needs an instance admin.
    viewingMembership?.role === "admin",
    enabledIntegrations,
    Boolean(viewingMembership),
  );
  return (
    <AppShell
      product="Open Source EOC"
      // Each theme's canonical frame carries its own line under the product name.
      organization={props.theme === "dark" ? "People · Information · Action" : "People · Information · Safer communities"}
      context={<IncidentSwitcher />}
      periodLabel={workspace.selectedPeriodDisplay}
      positionLabel={session.me?.position?.title ?? "No acting position"}
      actingPosition={session.me?.position ?? null}
      periodControl={<OperationalPeriodControl />}
      positionControl={<PositionControl />}
      nav={allSections ? rail : coreRail(rail, sectionOf(surface))}
      allSections={allSections}
      onAllSections={(value) => { setAllSections(value); saveAllSections(value); }}
      activeNav={sectionOf(surface)}
      onNavigate={(key) => navigateInContext(sectionForNav(key))}
      userName={session.me?.person.displayName ?? ""}
      roleLabel={viewingMembership?.role ?? "guest"}
      theme={props.theme}
      onToggleTheme={props.onToggleTheme}
      onLogout={() => void session.logout()}
      notificationCount={(notifications.data ?? []).filter((item) => item.assigned_to_current_actor && !item.read_at).length}
      settingsSections={consoleSettingsSections({
        client,
        email: session.me?.person.email ?? "",
        displayName: session.me?.person.displayName ?? "",
        onLogout: () => void session.logout(),
      })}
      notifications={(close) => (
        <NotificationTray
          items={notifications.data ?? []}
          onOpenCenter={() => { close(); navigateInContext({ kind: "alerts" }); }}
          onOpenItem={(id) => { close(); navigateInContext({ kind: "alerts", id }); }}
        />
      )}
      sync={sync}
      page={page.page}
      arrangement={page.arrangement}
      contextOpener={!drawerless}
      layout={drawerless
        ? { ...workspace.layout(page.arrangement), drawerOpen: false }
        : workspace.layout(page.arrangement)}
      onLayoutChange={(next) => workspace.updateLayout(page.arrangement, next)}
      rightDock={dock}
    >
      <ClockNotice client={client} />
      {incident.selectedIncident?.lockedAt ? (
        <p className="eoc-lockdown-banner" role="status">
          <strong>{incident.selectedIncident.name}: guest access is locked.</strong> Guest grants cannot read its boards or records until an administrator lifts the lockdown; members and participating organizations keep their access.
        </p>
      ) : null}
      <LoadBoundary name={page.page.title}><Suspense fallback={<Loading />}>
        <Center
          // Remount the whole center when the incident changes, so no records,
          // cached responses or polling timers from the previous incident
          // survive the switch.
          key={incident.selectedIncidentId ?? "no-incident"}
          surface={surface}
          recordId={routeContext.recordId}
          recordBoardId={routeContext.boardId}
          onRecordContext={receiveRecordContext}
          theme={props.theme}
          client={client}
          personId={session.me?.person.id ?? null}
          positionKey={session.me?.position?.key ?? null}
          me={session.me ?? null}
          onActAs={session.switchPosition}
          onDashboardsChanged={dashboards.reload}
          onBoardsChanged={boards.reload}
          jurisdictionId={viewingJurisdictionId ?? jurisdictionId}
          resourceJurisdictionId={resourceJurisdictionId ?? jurisdictionId}
          discoveryJurisdictionId={jurisdictionId}
          canActivateIncident={session.me?.memberships.some((membership) => membership.jurisdictionId === jurisdictionId && membership.role === "admin") ?? false}
          incidentId={incident.selectedIncidentId}
          incidentName={incident.selectedIncident?.name ?? null}
          incidentJurisdictionId={incident.selectedIncident?.jurisdictionId ?? null}
          periodRevision={workspace.selectedPeriodRevision}
          periods={workspace.periods}
          onSelectPeriod={workspace.selectPeriod}
          operationalPeriod={workspace.selectedPeriodRevision === null ? null : workspace.selectedPeriodLabel}
          incidentCanManage={incident.selectedIncident?.canEditArea ?? false}
          incidentCanManageParticipation={incident.selectedIncident?.canManageParticipation ?? false}
          incidentClosed={Boolean(incident.selectedIncident?.closedAt)}
          incidentBoardIds={incident.incidentBoardIds}
          boards={boardItems}
          boardsInView={scopedBoards}
          onIncidentActivated={incident.selectWhenListed}
          onIncidentsChanged={incident.reload}
          onOpenBoardRecordFromMap={(boardId, recordId) => navigate(
            { kind: "board", id: boardId },
            { ...baseContext, recordId, returnTo: surfaceHash({ kind: "map" }, { ...baseContext, boardId, recordId }) },
          )}
          boardsLoading={boards.loading && !boards.data}
          collections={(collections.data ?? []).filter((collection) => !outOfScope.has(collection.id))
            .map((collection) => ({ ...collection, templateKey: boardItems.find((board) => board.id === collection.id)?.templateKey }))}
          feeds={feeds.data ?? []}
          isAdmin={viewingMembership?.role === "admin"}
          facilitiesEnabled={facilitiesEnabled}
          integrations={enabledIntegrations}
          memberships={session.me?.memberships ?? []}
          canAuthorAlerts={viewingMembership?.role === "admin" || viewingMembership?.role === "member"}
          actorEmail={session.me?.person.email ?? ""}
          isInstanceAdmin={session.me?.isInstanceAdmin === true}
          canWriteResources={resourceMembership?.role === "admin" || resourceMembership?.role === "member"}
          collectionsError={collections.error}
          firstDashboardId={dashboards.data?.[0]?.id}
          dashboards={dashboards.data ?? []}
          routeContext={routeContext}
          onDashboardContext={(change) => navigate(surface, { ...baseContext, ...change })}
          onNavigate={navigateInContext}
          onOpenBoard={(id) => navigateInContext({ kind: "board", id })}
          onOpenRecord={(boardId, recordId, sourceIncidentId) => navigate(
            { kind: "board", id: boardId },
            { ...(sourceIncidentId ? { incidentId: sourceIncidentId } : {}), recordId },
          )}
          onOpenIncident={(incidentId) => navigate({ kind: "incidents" }, { incidentId })}
          {...(canReturn && returnRoute ? {
            onReturn: () => navigate(returnRoute.surface, returnRoute.context),
          } : {})}
          onOpenSitrep={(id) => navigateInContext({ kind: "sitrep", id })}
          onOpenBoardRecord={(boardId, recordId) => navigate(
            { kind: "board", id: boardId },
            { ...baseContext, recordId },
          )}
          onDashboardFilter={(id, f) =>
            navigate(
              f
                ? { kind: "dashboard", id, filterField: f.field, filterEquals: f.equals }
                : { kind: "dashboard", id },
              { ...baseContext, ...routeContext },
            )
          }
        />
      </Suspense></LoadBoundary>
    </AppShell>
  );
}

function sectionForNav(key: string): Surface {
  switch (key) {
    case "overview":
      return { kind: "overview" };
    case "dashboards":
      return { kind: "dashboard" };
    case "boards":
      return { kind: "boards" };
    case "sitreps":
      return { kind: "sitreps" };
    case "forms":
      return { kind: "forms" };
    case "iap":
      return { kind: "iap" };
    case "files":
      return { kind: "files" };
    case "incidentSetup":
      return { kind: "incidents" };
    case "datasets":
      return { kind: "datasets" };
    case "resources":
      return { kind: "resources" };
    case "aar":
      return { kind: "aar" };
    case "feeds":
      return { kind: "feeds" };
    case "messages":
      return { kind: "messages" };
    case "smartForms":
      return { kind: "smartforms" };
    case "tracking":
      return { kind: "tracking" };
    case "damage":
      return { kind: "damage" };
    case "staffing":
      return { kind: "staffing" };
    case "volunteers":
      return { kind: "volunteers" };
    case "facilities":
      return { kind: "facilities" };
    case "fieldReports":
      return { kind: "field-reports" };
    case "lifelines":
      return { kind: "lifelines" };
    case "tasks":
      return { kind: "tasks" };
    case "operationalPeriods":
      return { kind: "periods" };
    case "participants":
      return { kind: "participants" };
    case "jic":
      return { kind: "jic" };
    case "templates":
      return { kind: "templates" };
    case "admin":
      return { kind: "admin" };
    case "federation":
      return { kind: "federation" };
    case "chronology":
      return { kind: "chronology" };
    case "contacts":
      return { kind: "contacts" };
    case "massNotification":
      return { kind: "mass-notification" };
    case "reports":
      return { kind: "reports" };
    default:
      return { kind: "map" };
  }
}

function Center(props: {
  surface: Surface;
  recordId: string | undefined;
  recordBoardId: string | undefined;
  onRecordContext: (state: BoardRecordContext | null) => void;
  theme: ThemeName;
  client: ApiClient;
  personId: string | null;
  positionKey: string | null;
  me: Me | null;
  onActAs: (positionId: string) => Promise<void>;
  onDashboardsChanged: () => void;
  onBoardsChanged: () => void;
  jurisdictionId: string;
  discoveryJurisdictionId: string;
  canActivateIncident: boolean;
  incidentId: string | null;
  incidentName: string | null;
  incidentJurisdictionId: string | null;
  periodRevision: number | null;
  periods: readonly OperationalPeriodChoice[];
  onSelectPeriod: (revision: number | null) => void;
  operationalPeriod: string | null;
  incidentCanManage: boolean;
  incidentCanManageParticipation: boolean;
  incidentClosed: boolean;
  incidentBoardIds: ReadonlySet<string>;
  boards: readonly BoardListItem[];
  boardsInView: readonly BoardListItem[];
  onIncidentActivated: (incidentId: string) => Promise<void>;
  onIncidentsChanged: () => void;
  onOpenBoardRecordFromMap: (boardId: string, recordId: string) => void;
  boardsLoading: boolean;
  collections: readonly CollectionRef[];
  feeds: readonly FeedHealth[];
  isAdmin: boolean;
  facilitiesEnabled: boolean | null;
  integrations: ReadonlySet<string>;
  memberships: readonly Membership[];
  canAuthorAlerts: boolean;
  actorEmail: string;
  isInstanceAdmin: boolean;
  resourceJurisdictionId: string;
  canWriteResources: boolean;
  collectionsError: string | null;
  firstDashboardId: string | undefined;
  dashboards: readonly DashboardListItem[];
  routeContext: RouteContext;
  onDashboardContext: (context: RouteContext) => void;
  onNavigate: (surface: Surface) => void;
  onOpenBoard: (id: string) => void;
  onOpenRecord: (boardId: string, recordId: string, incidentId: string | null) => void;
  onOpenIncident: (incidentId: string) => void;
  onReturn?: () => void;
  onOpenSitrep: (id: string) => void;
  onOpenBoardRecord: (boardId: string, recordId: string) => void;
  onDashboardFilter: (id: string, filter: { field: string; equals: string } | null) => void;
}) {
  const s = props.surface;
  const relationshipBoards = props.boards.filter((board) => props.incidentBoardIds.has(board.id));
  switch (s.kind) {
    case "map":
      return props.collectionsError ? (
        <ErrorNote message={props.collectionsError} />
      ) : (
        <MapSurface
          client={props.client}
          theme={props.theme}
          jurisdictionId={props.jurisdictionId}
          collections={props.collections}
          feeds={props.feeds}
          incidentId={props.incidentId}
          incidentName={props.incidentName}
          operationalPeriod={props.operationalPeriod}
          handlingMarking="FOUO"
          incidentBoardIds={props.incidentBoardIds}
          personId={props.personId}
          focusDatasetId={s.datasetId}
          focusFeatureId={s.featureId}
          focusRecord={props.recordBoardId && props.recordId ? { boardId: props.recordBoardId, recordId: props.recordId } : null}
          onOpenRecord={(boardId, recordId) => props.onOpenBoardRecordFromMap(boardId, recordId)}
          onOpenLifeline={(id) => props.onNavigate({ kind: "lifeline", id })}
          onOpenEsf={(id) => props.onNavigate({ kind: "esf", id })}
        />
      );
    case "overview":
    case "briefing":
      return (
        <IncidentOverview
          client={props.client}
          theme={props.theme}
          jurisdictionId={props.jurisdictionId}
          incidentId={props.incidentId}
          incidentName={props.incidentName}
          periodRevision={props.periodRevision}
          operationalPeriod={props.operationalPeriod}
          collections={props.collections}
          member={props.memberships.some((membership) => membership.jurisdictionId === props.jurisdictionId)}
          briefing={s.kind === "briefing"}
          onBriefing={() => props.onNavigate({ kind: "briefing" })}
          onExitBriefing={() => props.onNavigate({ kind: "overview" })}
          onOpenSitrep={props.onOpenSitrep}
          onOpenRequests={(id) => props.onNavigate(id ? { kind: "resources", id } : { kind: "resources" })}
          onOpenShelters={() => {
            const shelters = props.boardsInView.find((board) => board.templateKey === "shelters");
            if (shelters) props.onOpenBoard(shelters.id);
            else props.onNavigate({ kind: "boards" });
          }}
          onOpenFieldReports={() => props.onNavigate({ kind: "field-reports" })}
          onOpenTasks={() => props.onNavigate({ kind: "tasks" })}
          onOpenLifeline={(id) => props.onNavigate({ kind: "lifeline", id })}
          onOpenLifelines={() => props.onNavigate({ kind: "lifelines" })}
          onOpenChronology={() => props.onNavigate({ kind: "chronology" })}
          onOpenRecord={(boardId, recordId) => props.onOpenRecord(boardId, recordId, props.incidentId)}
          onOpenEsf={() => props.onNavigate({ kind: "esf" })}
        />
      );
    case "dashboard": {
      const id = s.id ?? props.firstDashboardId;
      const filter =
        s.filterField && s.filterEquals !== undefined
          ? { field: s.filterField, equals: s.filterEquals }
          : null;
      return (
        <DashboardSurface
          client={props.client}
          {...(id ? { dashboardId: id } : {})}
          theme={props.theme}
          dashboards={props.dashboards}
          configKey={props.routeContext.view ?? null}
          routeFilter={props.routeContext.filter}
          onConfigKey={(key) => {
            const next = { ...props.routeContext };
            if (key) next.view = key;
            else delete next.view;
            props.onDashboardContext(next);
          }}
          onViewStateChange={(state: DashboardViewState) => {
            const filterState = JSON.stringify(state);
            if (filterState.length > 256) throw new Error("Dashboard filters exceed the saved link limit.");
            props.onDashboardContext({ ...props.routeContext, filter: filterState });
          }}
          onOpenMap={() => props.onNavigate({ kind: "map" })}
          onOpenRecord={(boardId, recordId) => props.onOpenRecord(boardId, recordId, props.incidentId)}
          // The jurisdiction's own dashboard list is for its members; a partner
          // viewer sees only the dashboards shared with their incident.
          {...(props.memberships.some((m) => m.jurisdictionId === props.jurisdictionId)
            ? { jurisdictionId: props.jurisdictionId } : {})}
          isAdmin={props.isAdmin}
          onDashboardsChanged={props.onDashboardsChanged}
          filter={filter}
          incidentId={props.incidentId}
          onFilter={(f) => props.onDashboardFilter(id ?? "", f ? { field: f.field, equals: String(f.equals) } : null)}
        />
      );
    }
    case "boards":
      return <BoardsIndex boards={props.boardsInView} onOpen={props.onOpenBoard} />;
    case "board":
      return <BoardSurface client={props.client} boardId={s.id} incidentId={props.routeContext.incidentId ?? null}
        incidentScoped={Boolean(props.routeContext.incidentId) && props.incidentBoardIds.has(s.id)}
        {...(props.isAdmin && props.isInstanceAdmin ? { onDesign: () => props.onNavigate({ kind: "board-design", id: s.id }) } : {})}
        {...(props.recordId ? { recordId: props.recordId } : {})} onRecordContext={props.onRecordContext} />;
    case "sitreps":
      return (
        <SitrepWorkspace
          client={props.client}
          jurisdictionId={props.jurisdictionId}
          incidentId={props.incidentId}
          incidentName={props.incidentName}
          period={props.operationalPeriod}
          onOpen={props.onOpenSitrep}
        />
      );
    case "sitrep":
      return <SitrepSurface client={props.client} sitrepId={s.id} jurisdictionId={props.jurisdictionId} />;
    case "forms":
      return (
        <FormsSurface
          client={props.client}
          incidentId={props.incidentId}
          incidentName={props.incidentName}
          periodRevision={props.periodRevision}
          operationalPeriod={props.operationalPeriod}
          onOpenIap={() => props.onNavigate({ kind: "iap" })}
          isAdmin={props.isAdmin}
        />
      );
    case "iap":
      return (
        <IapSurface client={props.client} incidentId={props.incidentId} isAdmin={props.isAdmin}
          jurisdictionId={props.jurisdictionId} incidentName={props.incidentName}
          periodRevision={props.periodRevision} operationalPeriod={props.operationalPeriod}
          initialIapId={s.id ?? null}
          onSelectIap={(id) => props.onNavigate(id ? { kind: "iap", id } : { kind: "iap" })}
          onOpenForms={() => props.onNavigate({ kind: "forms" })} />
      );
    case "files":
      return (
        <FilesWorkspace
          client={props.client}
          jurisdictionId={props.jurisdictionId}
          incidentId={props.incidentId}
          incidentName={props.incidentName}
          recordContext={props.recordBoardId && props.recordId ? {
            boardId: props.recordBoardId,
            recordId: props.recordId,
            label: "Selected record",
          } : null}
          onOpenRecord={props.onOpenRecord}
          onOpenIncident={props.onOpenIncident}
          {...(props.onReturn ? { onReturn: props.onReturn } : {})}
        />
      );
    case "resources":
      return (
        <ResourcesSurface
          client={props.client}
          jurisdictionId={props.resourceJurisdictionId}
          incidentId={props.incidentId}
          incidentOwnerId={props.incidentJurisdictionId}
          personId={props.personId}
          selectedRequestId={s.id ?? null}
          onSelectRequest={(id) => props.onNavigate(id ? { kind: "resources", id } : { kind: "resources" })}
          foundResourceId={s.resourceId ?? null}
          onFindResource={(resourceId) => props.onNavigate(resourceId ? { kind: "resources", resourceId } : { kind: "resources" })}
          canMutate={props.canWriteResources}
          closed={props.incidentClosed}
        />
      );
    case "aar":
      return (
        <AarSurface
          client={props.client}
          jurisdictionId={props.jurisdictionId}
          incidentId={props.incidentId}
        />
      );
    case "feeds":
      return (
        <FeedsSurface
          client={props.client}
          jurisdictionId={props.jurisdictionId}
          isAdmin={props.isAdmin}
        />
      );
    case "messages":
      return <MessagesWorkspace client={props.client} jurisdictionId={props.jurisdictionId}
        incidentId={props.incidentId} incidentName={props.incidentName} isAdmin={props.isAdmin}
        personId={props.personId}
        isMember={props.memberships.some((m) => m.jurisdictionId === props.jurisdictionId)} />;
    case "smartforms":
      return <SmartFormsSurface client={props.client} jurisdictionId={props.discoveryJurisdictionId}
        incidentId={props.incidentId} onOpenMap={() => props.onNavigate({ kind: "map" })} />;
    case "field-reports":
      return <FieldReportsSurface client={props.client} boards={props.boards} boardsLoading={props.boardsLoading}
        incidentId={props.incidentId} incidentBoardIds={props.incidentBoardIds}
        period={props.periods.find((period) => period.revision === props.periodRevision) ?? null}
        onOpenSmartForms={() => props.onNavigate({ kind: "smartforms" })}
        onOpenRecord={props.onOpenBoardRecord}
        onOpenMap={() => props.onNavigate({ kind: "map" })} />;
    case "tracking":
      return <TrackingSurface client={props.client} jurisdictionId={props.jurisdictionId} />;
    case "damage":
      return <DamageSurface client={props.client} jurisdictionId={props.jurisdictionId} theme={props.theme}
        canWrite={props.canAuthorAlerts} isAdmin={props.isAdmin} incidentName={props.incidentName} incidentId={props.incidentId} />;
    case "staffing":
      // Staffing writes need the admin-or-member role that alert authoring checks.
      return <StaffingSurface client={props.client} jurisdictionId={props.jurisdictionId} personId={props.personId}
        incidentId={props.incidentId} incidentName={props.incidentName} isAdmin={props.isAdmin} canWrite={props.canAuthorAlerts} />;
    case "volunteers":
      // A partner organization on the selected incident reads it as the incident's; the screen asks the server who may write.
      return <VolunteersSurface client={props.client} jurisdictionId={props.jurisdictionId}
        incidentId={props.incidentId} incidentName={props.incidentName} />;
    case "facilities":
      return props.facilitiesEnabled === null ? <Loading label="Checking facilities…" />
        : props.facilitiesEnabled ? <FacilitiesSurface client={props.client} jurisdictionId={props.jurisdictionId} theme={props.theme} canWrite={props.canAuthorAlerts} />
        : <NotFoundState onMap={() => props.onNavigate({ kind: "map" })} onOverview={() => props.onNavigate({ kind: "overview" })} />;
    case "incidents":
      return (
        <IncidentsSurface
          client={props.client}
          jurisdictionId={props.discoveryJurisdictionId}
          isAdmin={props.canActivateIncident}
          isInstanceAdmin={props.isInstanceAdmin}
          theme={props.theme}
          integrations={props.integrations}
          memberships={props.memberships}
          positionKey={props.positionKey}
          onActivated={props.onIncidentActivated}
          onChanged={props.onIncidentsChanged}
        />
      );
    case "datasets":
      return (
        <IncidentDatasets
          client={props.client}
          incidentId={props.incidentId}
          canManage={props.incidentCanManage}
        />
      );
    case "alerts":
      return <AlertsSurface client={props.client} jurisdictionId={props.jurisdictionId}
        incidentId={props.incidentId} canAuthor={props.canAuthorAlerts} actorEmail={props.actorEmail}
        isAdmin={props.isAdmin} personId={props.personId} notificationId={s.id ?? null} />;
    case "lifelines":
    case "lifeline":
      return <LifelinesSurface client={props.client} incidentId={props.incidentId}
        incidentJurisdictionId={props.incidentJurisdictionId}
        jurisdictionId={props.jurisdictionId} canWrite={props.canAuthorAlerts}
        relationshipBoards={relationshipBoards}
        selectedLifeline={s.kind === "lifeline" ? s.id : null}
        view={s.kind === "lifelines" ? s.view ?? null : null}
        periods={props.periods}
        selectedPeriodRevision={props.periodRevision}
        onSelectPeriod={props.onSelectPeriod}
        onView={(tab) => props.onNavigate(tab === "dependencies" || tab === "history" ? { kind: "lifelines", view: tab } : { kind: "lifelines" })}
        onOpen={(id) => props.onNavigate({ kind: "lifeline", id })}
        onClose={() => props.onNavigate({ kind: "lifelines" })}
        onOpenEsfs={() => props.onNavigate({ kind: "esf" })}
        onOpenEsf={(id) => props.onNavigate({ kind: "esf", id })}
        onOpenTask={() => props.onNavigate({ kind: "tasks" })}
        onOpenResourceRequest={(id) => props.onNavigate({ kind: "resources", id })}
        onOpenIap={(id) => props.onNavigate({ kind: "iap", id })}
        onOpenBoardRecord={props.onOpenBoardRecord}
        onOpenMapFeature={(datasetId, featureId) => props.onNavigate({ kind: "map", datasetId, featureId })} />;
    case "esf":
      return <EsfSurface client={props.client} incidentId={props.incidentId}
        incidentJurisdictionId={props.incidentJurisdictionId} selectedEsf={s.id ?? null}
        relationshipBoards={relationshipBoards}
        operationalPeriod={props.operationalPeriod}
        onOpen={(id) => props.onNavigate({ kind: "esf", id })}
        onClose={() => props.onNavigate({ kind: "esf" })}
        onOpenLifelines={() => props.onNavigate({ kind: "lifelines" })}
        onOpenLifelineView={(view) => props.onNavigate({ kind: "lifelines", view })}
        onOpenLifeline={(id) => props.onNavigate({ kind: "lifeline", id })}
        onOpenTask={() => props.onNavigate({ kind: "tasks" })}
        onOpenResourceRequest={(id) => props.onNavigate({ kind: "resources", id })}
        onOpenIap={(id) => props.onNavigate({ kind: "iap", id })}
        onOpenBoardRecord={props.onOpenBoardRecord}
        onOpenMapFeature={(datasetId, featureId) => props.onNavigate({ kind: "map", datasetId, featureId })} />;
    case "tasks":
      return <TasksSurface client={props.client} incidentId={props.incidentId}
        personId={props.personId} jurisdictionId={props.jurisdictionId}
        canManage={props.isAdmin} closed={props.incidentClosed} me={props.me}
        onOpenRequest={(id) => props.onNavigate({ kind: "resources", id })} onActAs={props.onActAs}
        onOpenTemplates={() => props.onNavigate({ kind: "incidents" })} />;
    case "periods":
      return props.incidentId ? <IncidentAreaEditor client={props.client} incidentId={props.incidentId}
        incidentName={props.incidentName ?? "Incident"} theme={props.theme}
        canEdit={props.incidentCanManage && !props.incidentClosed} />
        : <EmptyState label="Select an incident to manage operational periods." />;
    case "participants":
      return props.incidentId ? <IncidentParticipants client={props.client} incidentId={props.incidentId}
        incidentName={props.incidentName ?? "Incident"} canManage={props.incidentCanManageParticipation}
        closed={props.incidentClosed} />
        : <EmptyState label="Select an incident to manage participation." />;
    case "jic":
      return <SitrepWorkspace mode="jic" client={props.client} jurisdictionId={props.jurisdictionId}
        incidentId={props.incidentId} incidentName={props.incidentName}
        period={props.operationalPeriod} onOpen={props.onOpenSitrep} />;
    case "templates":
      return <TemplatesSurface client={props.client} jurisdictionId={props.jurisdictionId} boards={props.boards}
        isInstanceAdmin={props.isInstanceAdmin} isJurisdictionAdmin={props.isAdmin}
        onBoardsChanged={props.onBoardsChanged}
        onOpenBoard={props.onOpenBoard} onDesignBoard={(id) => props.onNavigate({ kind: "board-design", id })} />;
    case "board-design":
      return <TemplatesSurface client={props.client} jurisdictionId={props.jurisdictionId} boards={props.boards} boardId={s.id}
        isInstanceAdmin={props.isInstanceAdmin} isJurisdictionAdmin={props.isAdmin}
        onBoardsChanged={props.onBoardsChanged}
        onOpenBoard={props.onOpenBoard} onDesignBoard={(id) => props.onNavigate({ kind: "board-design", id })} />;
    case "admin":
      return <AdminSurface client={props.client} jurisdictionId={props.jurisdictionId} personId={props.personId}
        isAdmin={props.isAdmin} isInstanceAdmin={props.isInstanceAdmin} boards={props.boards} />;
    case "federation":
      return <FederationSurface client={props.client} jurisdictionId={props.jurisdictionId}
        isAdmin={props.isAdmin} boards={props.boards} />;
    case "chronology":
      return <ChronologySurface client={props.client} jurisdictionId={props.jurisdictionId}
        incidentId={props.incidentId} incidentName={props.incidentName} isAdmin={props.isAdmin} />;
    case "contacts":
      return <ContactsSurface client={props.client} jurisdictionId={props.jurisdictionId} isAdmin={props.isAdmin} />;
    case "mass-notification":
      // Sending needs the admin-or-member role that alert authoring checks; viewers follow the sends.
      return <MassNotificationSurface client={props.client} jurisdictionId={props.jurisdictionId} canSend={props.canAuthorAlerts} />;
    case "reports":
      // Viewers read and run reports; writers build them.
      return <ReportsSurface client={props.client} jurisdictionId={props.jurisdictionId} boards={props.boards}
        incidentId={props.incidentId} incidentName={props.incidentName} incidentBoardIds={props.incidentBoardIds}
        canBuild={props.canAuthorAlerts} />;
    case "not-found":
      return <NotFoundState onMap={() => props.onNavigate({ kind: "map" })} onOverview={() => props.onNavigate({ kind: "overview" })} />;
  }
}

function pageFor(surface: Surface, scope: string): { readonly page: ShellPage; readonly arrangement: WorkspaceArrangement } {
  const result = (group: string, title: string, arrangement: WorkspaceArrangement, line = scope) => ({ page: { group, title, scope: line }, arrangement });
  const lifelines = "Essential service conditions and coordinated response";
  switch (surface.kind) {
    case "map": return result("Situation", "Map", "map");
    case "overview": return result("Situation", "Incident overview", "map");
    case "briefing": return result("Situation", "Incident overview", "map");
    case "dashboard": return result("Situation", "Dashboards", "map");
    case "lifelines": return result("Situation", "ESFs & Lifelines", "map", lifelines);
    case "lifeline": return result("Situation", "ESFs & Lifelines", "map", lifelines);
    case "esf": return result("Situation", "ESFs & Lifelines", "map", lifelines);
    case "sitreps": return result("Situation", "SITREP", "planning");
    case "sitrep": return result("Situation", "Situation report", "planning");
    case "chronology": return result("Situation", "Chronology", "boards");
    case "boards": return result("Operations", "Boards", "boards");
    case "board": return result("Operations", "Board detail", "boards");
    case "board-design": return result("Operations", "Board customization", "boards");
    case "resources": return result("Operations", "Resources", "boards");
    case "tasks": return result("Operations", "Tasks", "boards");
    case "smartforms": return result("Operations", "Smart Forms", "boards");
    case "field-reports": return result("Operations", "Field Reports", "boards");
    case "tracking": return result("Operations", "Tracking", "boards");
    case "damage": return result("Operations", "Damage Assessment", "boards");
    case "staffing": return result("Operations", "Staffing", "boards");
    case "volunteers": return result("Operations", "Volunteers", "boards");
    case "facilities": return result("Operations", "Facilities", "boards");
    case "periods": return result("Planning", "Operational Periods", "planning");
    case "forms": return result("Planning", "ICS Forms", "planning");
    case "iap": return result("Planning", "IAP", "planning");
    case "aar": return result("Planning", "AAR", "planning");
    case "reports": return result("Planning", "Reports", "planning");
    case "participants": return result("Coordination", "Participants", "boards");
    case "messages": return result("Coordination", "Messages", "boards");
    case "jic": return result("Coordination", "JIC", "planning");
    case "files": return result("Coordination", "Files", "boards");
    case "contacts": return result("Coordination", "Contacts", "boards");
    case "mass-notification": return result("Coordination", "Mass Notification", "boards");
    case "incidents": return result("Data and administration", "Incident Setup", "boards");
    case "datasets": return result("Data and administration", "Datasets", "map");
    case "feeds": return result("Data and administration", "Feeds", "map");
    case "templates": return result("Data and administration", "Templates", "boards");
    case "admin": return result("Data and administration", "Administration", "boards");
    case "federation": return result("Data and administration", "Federation", "boards");
    case "alerts": return result("Notifications", "Notification center", "boards");
    case "not-found": return result("Navigation", "Page not found", "boards");
  }
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(value);
}
