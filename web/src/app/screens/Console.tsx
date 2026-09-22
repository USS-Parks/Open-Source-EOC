import { useCallback, useEffect, useState } from "react";
import { BoardList, NotificationTray } from "../../design/layout.js";
import { Button, type Status } from "../../design/components.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, BoardListItem, DashboardListItem, CollectionRef, FeedHealth } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { IncidentSwitcher, useIncident } from "../incident/context.js";
import { useAsync, usePolled } from "../data/hooks.js";
import {
  AppShell,
  type NavGroup,
  type ShellPage,
  type ShellSyncState,
  type WorkspaceArrangement,
} from "../layout/AppShell.js";
import { OperationalPeriodControl, PositionControl, useWorkspaceContext } from "../layout/context.js";
import { parseRouteHash, sectionOf, useSurface, type RouteContext, type Surface } from "../router.js";
import { EmptyState, ErrorNote, Loading, NotFoundState, UnavailableState } from "./parts.js";
import { MapSurface } from "../surfaces/MapSurface.js";
import { DashboardSurface, parseDashboardViewState, type DashboardViewState } from "../surfaces/DashboardSurface.js";
import { BoardSurface, BoardRecordDetailPane, type BoardRecordContext } from "../surfaces/BoardSurface.js";
import { SitrepSurface } from "../surfaces/SitrepSurface.js";
import { FormsSurface } from "../surfaces/FormsSurface.js";
import { IapSurface } from "../surfaces/IapSurface.js";
import { FilesSurface } from "../surfaces/FilesSurface.js";
import { IncidentsSurface } from "../surfaces/IncidentsSurface.js";
import { IncidentAreaEditor } from "../surfaces/IncidentAreaEditor.js";
import { IncidentParticipants } from "../surfaces/IncidentParticipants.js";
import { IncidentDatasets } from "../surfaces/IncidentDatasets.js";
import { ResourcesSurface } from "../surfaces/ResourcesSurface.js";
import { AarSurface } from "../surfaces/AarSurface.js";
import { FeedsSurface } from "../surfaces/FeedsSurface.js";
import { MessagesSurface } from "../surfaces/MessagesSurface.js";
import { SmartFormsSurface } from "../surfaces/SmartFormsSurface.js";
import { TrackingSurface } from "../surfaces/TrackingSurface.js";
import { AlertsSurface, BoardsIndex, SitrepsIndex } from "../surfaces/lists.js";
import { LifelinesSurface } from "../surfaces/LifelinesSurface.js";
import { EsfSurface } from "../surfaces/EsfSurface.js";

const NAV: readonly NavGroup[] = [
  { key: "situation", label: "Situation", items: [
    { key: "overview", label: "Overview", icon: "overview" },
    { key: "map", label: "Map", icon: "map" },
    { key: "lifelines", label: "ESFs & Lifelines", icon: "lifelines" },
    { key: "sitreps", label: "SITREP", icon: "sitrep" },
  ] },
  { key: "operations", label: "Operations", items: [
    { key: "boards", label: "Boards", icon: "boards" },
    { key: "resources", label: "Resources", icon: "resources" },
    { key: "tasks", label: "Tasks", icon: "tasks" },
    { key: "fieldReports", label: "Field Reports", icon: "fieldReports" },
    { key: "smartForms", label: "Smart Forms", icon: "smartForms" },
    { key: "tracking", label: "Tracking", icon: "tracking" },
  ] },
  { key: "planning", label: "Planning", items: [
    { key: "operationalPeriods", label: "Operational Periods", icon: "operationalPeriods" },
    { key: "forms", label: "ICS Forms", icon: "forms" },
    { key: "iap", label: "IAP", icon: "iap" },
    { key: "aar", label: "AAR", icon: "aar" },
  ] },
  { key: "coordination", label: "Coordination", items: [
    { key: "participants", label: "Participants", icon: "participants" },
    { key: "messages", label: "Messages", icon: "messages" },
    { key: "jic", label: "JIC", icon: "jic" },
    { key: "files", label: "Files", icon: "files" },
  ] },
  { key: "data", label: "Data and administration", items: [
    { key: "incidentSetup", label: "Incident Setup", icon: "incidentSetup" },
    { key: "datasets", label: "Datasets", icon: "datasets" },
    { key: "feeds", label: "Feeds", icon: "feeds" },
    { key: "templates", label: "Templates", icon: "templates" },
    { key: "settings", label: "Settings", icon: "settings" },
  ] },
];

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
  const receiveRecordContext = useCallback((next: BoardRecordContext | null) => setRecordContext(next), []);
  const viewingJurisdictionId = incident.selectedIncident?.jurisdictionId ?? jurisdictionId;
  const viewingMembership = session.me?.memberships.find(
    (membership) => membership.jurisdictionId === viewingJurisdictionId,
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
  const notifications = usePolled(() => client.notifications(), 8000, []);
  const [lastNotificationCheck, setLastNotificationCheck] = useState<Date | null>(null);
  useEffect(() => {
    if (!notifications.loading && !notifications.error && notifications.data) setLastNotificationCheck(new Date());
  }, [notifications.data, notifications.error, notifications.loading]);

  useEffect(() => {
    if (surface.kind !== "board" || !routeContext.recordId) setRecordContext(null);
  }, [routeContext.recordId, surface.kind]);

  if (!jurisdictionId) {
    return (
      <EmptyState
        label="No jurisdiction membership."
        hint="This account is not a member of any jurisdiction yet."
      />
    );
  }

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

  const boardItems = boards.data ?? [];
  const dock = (
    <>
      {workspace.message && (workspace.phase === "conflict" || workspace.phase === "error") ? (
        <section className="eoc-shell-context-state" aria-label="Workspace settings status">
          <h2 style={dockHeading}>Workspace settings</h2>
          <p role="alert">{workspace.message}</p>
          <div>
            <Button kind="quiet" onClick={workspace.reloadSaved}>Reload saved settings</Button>
            {workspace.conflict ? <Button kind="primary" onClick={() => void workspace.keepSession()}>Keep this session</Button> : null}
          </div>
        </section>
      ) : null}
      {surface.kind === "board" && routeContext.recordId ? (
        <section aria-label="Selected record">
          <h2 style={dockHeading}>Selected record</h2>
          {recordContext?.status === "loading" || !recordContext ? <p>Loading record context…</p> : null}
          {recordContext?.status === "missing" ? <p role="status">Record unavailable in this view</p> : null}
          {recordContext?.status === "ready" ? (
            <BoardRecordDetailPane context={recordContext} />
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
      <section aria-label="Boards">
        <h2 style={dockHeading}>Boards</h2>
        {boardItems.length === 0 ? (
          <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>No boards yet.</p>
        ) : (
          <BoardList
            boards={boardItems.map((b) => ({ id: b.id, name: b.title }))}
            onOpen={(id) => navigateInContext({ kind: "board", id })}
          />
        )}
      </section>
      <section aria-label="Recent notifications">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <h2 style={{ ...dockHeading, margin: 0 }}>Notifications</h2>
          <Button kind="quiet" onClick={() => navigateInContext({ kind: "alerts" })}>Open center</Button>
        </div>
        <NotificationTray
          items={(notifications.data ?? []).slice(0, 6).map((n) => ({
            id: n.id,
            status: (n.read_at ? "unknown" : "info") as Status,
            text: n.title,
          }))}
        />
      </section>
    </>
  );

  const notificationSync: ShellSyncState = notifications.error
    ? { state: "error", label: lastNotificationCheck ? `Update failed · checked ${formatTime(lastNotificationCheck)}` : "Updates unavailable" }
    : notifications.loading && !notifications.data
      ? { state: "checking", label: "Checking updates" }
      : { state: "current", label: lastNotificationCheck ? `Checked ${formatTime(lastNotificationCheck)}` : "Update received" };
  const sync: ShellSyncState = workspace.phase === "loading" || workspace.phase === "saving"
    ? { state: "checking", label: workspace.message ?? "Restoring workspace" }
    : workspace.phase === "conflict" || workspace.phase === "error"
      ? { state: "error", label: workspace.message ?? "Workspace settings unavailable" }
      : notificationSync;
  const scope = `${incident.selectedIncident?.name ?? "No incident selected"} · ${workspace.selectedPeriodLabel}`;
  const page = pageFor(surface, scope);

  return (
    <AppShell
      product="Open Source EOC"
      organization="Emergency coordination"
      context={<IncidentSwitcher />}
      periodLabel={workspace.selectedPeriodLabel}
      positionLabel={session.me?.position?.title ?? "No acting position"}
      periodControl={<OperationalPeriodControl />}
      positionControl={<PositionControl />}
      nav={NAV}
      activeNav={sectionOf(surface)}
      onNavigate={(key) => navigateInContext(sectionForNav(key))}
      userName={session.me?.person.displayName ?? ""}
      roleLabel={viewingMembership?.role ?? "guest"}
      theme={props.theme}
      onToggleTheme={props.onToggleTheme}
      onLogout={() => void session.logout()}
      notificationCount={(notifications.data ?? []).filter((item) => !item.read_at).length}
      sync={sync}
      page={page.page}
      arrangement={page.arrangement}
      layout={surface.kind === "lifelines" || surface.kind === "lifeline" || surface.kind === "esf" || surface.kind === "dashboard"
        ? { ...workspace.layout(page.arrangement), drawerOpen: false }
        : workspace.layout(page.arrangement)}
      onLayoutChange={(next) => workspace.updateLayout(page.arrangement, next)}
      rightDock={dock}
    >
      <Center
        // Remount the whole center when the incident changes, so no records,
        // cached responses or polling timers from the previous incident
        // survive the switch (VEOC-79B teardown).
        key={incident.selectedIncidentId ?? "no-incident"}
        surface={surface}
        recordId={routeContext.recordId}
        onRecordContext={receiveRecordContext}
        theme={props.theme}
        client={client}
        jurisdictionId={viewingJurisdictionId ?? jurisdictionId}
        discoveryJurisdictionId={jurisdictionId}
        canActivateIncident={session.me?.memberships.some((membership) => membership.jurisdictionId === jurisdictionId && membership.role === "admin") ?? false}
        incidentId={incident.selectedIncidentId}
        incidentName={incident.selectedIncident?.name ?? null}
        incidentJurisdictionId={incident.selectedIncident?.jurisdictionId ?? null}
        operationalPeriod={workspace.selectedPeriodRevision === null ? null : workspace.selectedPeriodLabel}
        incidentCanManage={incident.selectedIncident?.canEditArea ?? false}
        incidentCanManageParticipation={incident.selectedIncident?.canManageParticipation ?? false}
        incidentClosed={Boolean(incident.selectedIncident?.closedAt)}
        incidentBoardIds={incident.incidentBoardIds}
        boards={boardItems}
        collections={collections.data ?? []}
        feeds={feeds.data ?? []}
        isAdmin={viewingMembership?.role === "admin"}
        collectionsError={collections.error}
        firstDashboardId={dashboards.data?.[0]?.id}
        dashboards={dashboards.data ?? []}
        routeContext={routeContext}
        onDashboardContext={(change) => navigate(surface, { ...baseContext, ...change })}
        onNavigate={navigateInContext}
        onOpenBoard={(id) => navigateInContext({ kind: "board", id })}
        onOpenSitrep={(id) => navigateInContext({ kind: "sitrep", id })}
        onDashboardFilter={(id, f) =>
          navigate(
            f
              ? { kind: "dashboard", id, filterField: f.field, filterEquals: f.equals }
              : { kind: "dashboard", id },
            { ...baseContext, ...routeContext },
          )
        }
      />
    </AppShell>
  );
}

function sectionForNav(key: string): Surface {
  switch (key) {
    case "overview":
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
    case "lifelines":
      return { kind: "lifelines" };
    case "tasks":
      return { kind: "tasks" };
    case "fieldReports":
      return { kind: "field-reports" };
    case "operationalPeriods":
      return { kind: "periods" };
    case "participants":
      return { kind: "participants" };
    case "jic":
      return { kind: "jic" };
    case "templates":
      return { kind: "templates" };
    case "settings":
      return { kind: "settings" };
    default:
      return { kind: "map" };
  }
}

function Center(props: {
  surface: Surface;
  recordId: string | undefined;
  onRecordContext: (state: BoardRecordContext | null) => void;
  theme: ThemeName;
  client: ApiClient;
  jurisdictionId: string;
  discoveryJurisdictionId: string;
  canActivateIncident: boolean;
  incidentId: string | null;
  incidentName: string | null;
  incidentJurisdictionId: string | null;
  operationalPeriod: string | null;
  incidentCanManage: boolean;
  incidentCanManageParticipation: boolean;
  incidentClosed: boolean;
  incidentBoardIds: ReadonlySet<string>;
  boards: readonly BoardListItem[];
  collections: readonly CollectionRef[];
  feeds: readonly FeedHealth[];
  isAdmin: boolean;
  collectionsError: string | null;
  firstDashboardId: string | undefined;
  dashboards: readonly DashboardListItem[];
  routeContext: RouteContext;
  onDashboardContext: (context: RouteContext) => void;
  onNavigate: (surface: Surface) => void;
  onOpenBoard: (id: string) => void;
  onOpenSitrep: (id: string) => void;
  onDashboardFilter: (id: string, filter: { field: string; equals: string } | null) => void;
}) {
  const s = props.surface;
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
          incidentBoardIds={props.incidentBoardIds}
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
          {...(props.routeContext.filter ? { viewState: parseDashboardViewState(props.routeContext.filter) } : {})}
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
          filter={filter}
          incidentId={props.incidentId}
          onFilter={(f) => props.onDashboardFilter(id ?? "", f ? { field: f.field, equals: String(f.equals) } : null)}
        />
      );
    }
    case "boards":
      return <BoardsIndex boards={props.boards} onOpen={props.onOpenBoard} />;
    case "board":
      return <BoardSurface client={props.client} boardId={s.id} incidentId={props.incidentId}
        incidentScoped={props.incidentBoardIds.has(s.id)}
        {...(props.recordId ? { recordId: props.recordId } : {})} onRecordContext={props.onRecordContext} />;
    case "sitreps":
      return (
        <SitrepsIndex
          client={props.client}
          jurisdictionId={props.jurisdictionId}
          onOpen={props.onOpenSitrep}
        />
      );
    case "sitrep":
      return <SitrepSurface client={props.client} sitrepId={s.id} />;
    case "forms":
      return (
        <FormsSurface
          client={props.client}
          incidentId={props.incidentId}
          isAdmin={props.isAdmin}
        />
      );
    case "iap":
      return (
        <IapSurface client={props.client} incidentId={props.incidentId} isAdmin={props.isAdmin} />
      );
    case "files":
      return <FilesSurface client={props.client} jurisdictionId={props.jurisdictionId} />;
    case "resources":
      return (
        <ResourcesSurface
          client={props.client}
          jurisdictionId={props.jurisdictionId}
          incidentId={props.incidentId}
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
      return <MessagesSurface client={props.client} jurisdictionId={props.jurisdictionId} />;
    case "smartforms":
      return <SmartFormsSurface client={props.client} jurisdictionId={props.jurisdictionId} />;
    case "tracking":
      return <TrackingSurface client={props.client} jurisdictionId={props.jurisdictionId} />;
    case "incidents":
      return (
        <IncidentsSurface
          client={props.client}
          jurisdictionId={props.discoveryJurisdictionId}
          isAdmin={props.canActivateIncident}
          theme={props.theme}
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
      return <AlertsSurface client={props.client} />;
    case "lifelines":
    case "lifeline":
      return <LifelinesSurface client={props.client} incidentId={props.incidentId}
        selectedLifeline={s.kind === "lifeline" ? s.id : null}
        onOpen={(id) => props.onNavigate({ kind: "lifeline", id })}
        onClose={() => props.onNavigate({ kind: "lifelines" })}
        onOpenEsfs={() => props.onNavigate({ kind: "esf" })} />;
    case "esf":
      return <EsfSurface client={props.client} incidentId={props.incidentId}
        incidentJurisdictionId={props.incidentJurisdictionId} selectedEsf={s.id ?? null}
        operationalPeriod={props.operationalPeriod}
        onOpen={(id) => props.onNavigate({ kind: "esf", id })}
        onClose={() => props.onNavigate({ kind: "esf" })}
        onOpenLifelines={() => props.onNavigate({ kind: "lifelines" })} />;
    case "tasks":
      return <UnavailableState title="Tasks is unavailable" message="This section is not available in the current application." returnLabel="Return to Boards" onReturn={() => props.onNavigate({ kind: "boards" })} />;
    case "field-reports":
      return <UnavailableState title="Field Reports is unavailable" message="This section is not available in the current application. Existing reports remain available through their board." returnLabel="Return to Boards" onReturn={() => props.onNavigate({ kind: "boards" })} />;
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
      return <UnavailableState title="JIC is unavailable" message="This section is not available in the current application." returnLabel="Open SITREP" onReturn={() => props.onNavigate({ kind: "sitreps" })} />;
    case "templates":
      return <UnavailableState title="Templates is unavailable" message="This section is not available in the current application." returnLabel="Return to Boards" onReturn={() => props.onNavigate({ kind: "boards" })} />;
    case "settings":
      return <UnavailableState title="Settings is unavailable" message="This section is not available in the current application." returnLabel="Open Incident Setup" onReturn={() => props.onNavigate({ kind: "incidents" })} />;
    case "board-design":
      return <UnavailableState title="Board customization is unavailable" message="This board can be used, but customization is not available in the current application." returnLabel="Return to board" onReturn={() => props.onNavigate({ kind: "board", id: s.id })} />;
    case "not-found":
      return <NotFoundState onMap={() => props.onNavigate({ kind: "map" })} onOverview={() => props.onNavigate({ kind: "dashboard" })} />;
  }
}

function pageFor(surface: Surface, scope: string): { readonly page: ShellPage; readonly arrangement: WorkspaceArrangement } {
  const result = (group: string, title: string, arrangement: WorkspaceArrangement) => ({ page: { group, title, scope }, arrangement });
  switch (surface.kind) {
    case "map": return result("Situation", "Map", "map");
    case "dashboard": return result("Situation", "Overview", "map");
    case "lifelines": return result("Situation", "ESFs & Lifelines", "map");
    case "lifeline": return result("Situation", "Lifeline detail", "map");
    case "esf": return result("Situation", "ESF coordination", "map");
    case "sitreps": return result("Situation", "SITREP", "planning");
    case "sitrep": return result("Situation", "Situation report", "planning");
    case "boards": return result("Operations", "Boards", "boards");
    case "board": return result("Operations", "Board detail", "boards");
    case "board-design": return result("Operations", "Board customization", "boards");
    case "resources": return result("Operations", "Resources", "boards");
    case "tasks": return result("Operations", "Tasks", "boards");
    case "field-reports": return result("Operations", "Field Reports", "boards");
    case "smartforms": return result("Operations", "Smart Forms", "boards");
    case "tracking": return result("Operations", "Tracking", "boards");
    case "periods": return result("Planning", "Operational Periods", "planning");
    case "forms": return result("Planning", "ICS Forms", "planning");
    case "iap": return result("Planning", "IAP", "planning");
    case "aar": return result("Planning", "AAR", "planning");
    case "participants": return result("Coordination", "Participants", "boards");
    case "messages": return result("Coordination", "Messages", "boards");
    case "jic": return result("Coordination", "JIC", "planning");
    case "files": return result("Coordination", "Files", "boards");
    case "incidents": return result("Data and administration", "Incident Setup", "boards");
    case "datasets": return result("Data and administration", "Datasets", "map");
    case "feeds": return result("Data and administration", "Feeds", "map");
    case "templates": return result("Data and administration", "Templates", "boards");
    case "settings": return result("Data and administration", "Settings", "boards");
    case "alerts": return result("Notifications", "Notification center", "boards");
    case "not-found": return result("Navigation", "Page not found", "boards");
  }
}

function formatTime(value: Date) {
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const dockHeading = { margin: "0 0 8px", fontSize: "1em" } as const;
