import { BoardList, NotificationTray } from "../../design/layout.js";
import type { Status } from "../../design/components.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, BoardListItem, CollectionRef, FeedHealth } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { IncidentSwitcher, useIncident } from "../incident/context.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { AppShell, type NavItem } from "../layout/AppShell.js";
import { sectionOf, useSurface, type Surface } from "../router.js";
import { EmptyState, ErrorNote } from "./parts.js";
import { MapSurface } from "../surfaces/MapSurface.js";
import { DashboardSurface } from "../surfaces/DashboardSurface.js";
import { BoardSurface } from "../surfaces/BoardSurface.js";
import { SitrepSurface } from "../surfaces/SitrepSurface.js";
import { FormsSurface } from "../surfaces/FormsSurface.js";
import { IapSurface } from "../surfaces/IapSurface.js";
import { FilesSurface } from "../surfaces/FilesSurface.js";
import { IncidentsSurface } from "../surfaces/IncidentsSurface.js";
import { IncidentDatasets } from "../surfaces/IncidentDatasets.js";
import { ResourcesSurface } from "../surfaces/ResourcesSurface.js";
import { AarSurface } from "../surfaces/AarSurface.js";
import { FeedsSurface } from "../surfaces/FeedsSurface.js";
import { MessagesSurface } from "../surfaces/MessagesSurface.js";
import { SmartFormsSurface } from "../surfaces/SmartFormsSurface.js";
import { TrackingSurface } from "../surfaces/TrackingSurface.js";
import { AlertsSurface, BoardsIndex, SitrepsIndex } from "../surfaces/lists.js";

const NAV: readonly NavItem[] = [
  { key: "map", label: "Map" },
  { key: "dashboard", label: "Dashboard" },
  { key: "incidents", label: "Incidents" },
  { key: "datasets", label: "Datasets" },
  { key: "boards", label: "Boards" },
  { key: "sitreps", label: "SITREP" },
  { key: "forms", label: "Forms" },
  { key: "iap", label: "IAP" },
  { key: "smartforms", label: "Smart Forms" },
  { key: "resources", label: "Resources" },
  { key: "tracking", label: "Tracking" },
  { key: "aar", label: "AAR" },
  { key: "feeds", label: "Feeds" },
  { key: "messages", label: "Messages" },
  { key: "files", label: "Files" },
  { key: "alerts", label: "Alerts" },
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
  const { surface, navigate } = useSurface();

  const boards = useAsync(
    () => (jurisdictionId ? client.listBoards(jurisdictionId) : Promise.resolve([])),
    [jurisdictionId],
  );
  const collections = useAsync(() => client.listCollections(), []);
  const feeds = useAsync(
    () => (jurisdictionId ? client.listFeeds(jurisdictionId) : Promise.resolve([])),
    [jurisdictionId],
  );
  const dashboards = useAsync(
    () => (jurisdictionId ? client.listDashboards(jurisdictionId) : Promise.resolve([])),
    [jurisdictionId],
  );
  const notifications = usePolled(() => client.notifications(), 8000, []);

  if (!jurisdictionId) {
    return (
      <EmptyState
        label="No jurisdiction membership."
        hint="This account is not a member of any jurisdiction yet."
      />
    );
  }

  const boardItems = boards.data ?? [];
  const dock = (
    <>
      <section aria-label="Boards">
        <h2 style={dockHeading}>Boards</h2>
        {boardItems.length === 0 ? (
          <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>No boards yet.</p>
        ) : (
          <BoardList
            boards={boardItems.map((b) => ({ id: b.id, name: b.title }))}
            onOpen={(id) => navigate({ kind: "board", id })}
          />
        )}
      </section>
      <section aria-label="Recent notifications">
        <h2 style={dockHeading}>Notifications</h2>
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

  return (
    <AppShell
      product="Open Source EOC"
      context={<IncidentSwitcher />}
      nav={NAV}
      activeNav={sectionOf(surface)}
      onNavigate={(key) => navigate(sectionForNav(key))}
      userName={session.me?.person.displayName ?? ""}
      roleLabel={session.role ?? "member"}
      theme={props.theme}
      onToggleTheme={props.onToggleTheme}
      onLogout={() => void session.logout()}
      rightDock={dock}
    >
      <Center
        // Remount the whole center when the incident changes, so no records,
        // cached responses or polling timers from the previous incident
        // survive the switch (VEOC-79B teardown).
        key={incident.selectedIncidentId ?? "no-incident"}
        surface={surface}
        theme={props.theme}
        client={client}
        jurisdictionId={jurisdictionId}
        incidentId={incident.selectedIncidentId}
        incidentName={incident.selectedIncident?.name ?? null}
        incidentCanManage={incident.selectedIncident?.canEditArea ?? false}
        boards={boardItems}
        collections={collections.data ?? []}
        feeds={feeds.data ?? []}
        isAdmin={session.role === "admin"}
        collectionsError={collections.error}
        firstDashboardId={dashboards.data?.[0]?.id}
        onOpenBoard={(id) => navigate({ kind: "board", id })}
        onOpenSitrep={(id) => navigate({ kind: "sitrep", id })}
        onDashboardFilter={(id, f) =>
          navigate(
            f
              ? { kind: "dashboard", id, filterField: f.field, filterEquals: f.equals }
              : { kind: "dashboard", id },
          )
        }
      />
    </AppShell>
  );
}

function sectionForNav(key: string): Surface {
  switch (key) {
    case "dashboard":
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
    case "incidents":
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
    case "smartforms":
      return { kind: "smartforms" };
    case "tracking":
      return { kind: "tracking" };
    case "alerts":
      return { kind: "alerts" };
    default:
      return { kind: "map" };
  }
}

function Center(props: {
  surface: Surface;
  theme: ThemeName;
  client: ApiClient;
  jurisdictionId: string;
  incidentId: string | null;
  incidentName: string | null;
  incidentCanManage: boolean;
  boards: readonly BoardListItem[];
  collections: readonly CollectionRef[];
  feeds: readonly FeedHealth[];
  isAdmin: boolean;
  collectionsError: string | null;
  firstDashboardId: string | undefined;
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
        />
      );
    case "dashboard": {
      const id = s.id ?? props.firstDashboardId;
      if (!id)
        return <EmptyState label="No dashboard configured." hint="An admin creates one from a dashboard template." />;
      const filter =
        s.filterField && s.filterEquals !== undefined
          ? { field: s.filterField, equals: s.filterEquals }
          : null;
      return (
        <DashboardSurface
          client={props.client}
          dashboardId={id}
          filter={filter}
          onFilter={(f) => props.onDashboardFilter(id, f)}
        />
      );
    }
    case "boards":
      return <BoardsIndex boards={props.boards} onOpen={props.onOpenBoard} />;
    case "board":
      return <BoardSurface client={props.client} boardId={s.id} />;
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
      return <ResourcesSurface client={props.client} jurisdictionId={props.jurisdictionId} />;
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
          jurisdictionId={props.jurisdictionId}
          isAdmin={props.isAdmin}
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
  }
}

const dockHeading = { margin: "0 0 8px", fontSize: "1em" } as const;
