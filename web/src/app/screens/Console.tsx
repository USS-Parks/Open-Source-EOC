import { BoardList, NotificationTray } from "../../design/layout.js";
import type { Status } from "../../design/components.js";
import type { ThemeName } from "../../design/tokens.js";
import type { ApiClient, BoardListItem, CollectionRef, FeedHealth } from "../api/client.js";
import { useSession } from "../auth/session.js";
import { useAsync, usePolled } from "../data/hooks.js";
import { AppShell, type NavItem } from "../layout/AppShell.js";
import { sectionOf, useSurface, type Surface } from "../router.js";
import { EmptyState, ErrorNote } from "./parts.js";
import { MapSurface } from "../surfaces/MapSurface.js";
import { DashboardSurface } from "../surfaces/DashboardSurface.js";
import { BoardSurface } from "../surfaces/BoardSurface.js";
import { SitrepSurface } from "../surfaces/SitrepSurface.js";
import { AlertsSurface, BoardsIndex, SitrepsIndex } from "../surfaces/lists.js";

const NAV: readonly NavItem[] = [
  { key: "map", label: "Map" },
  { key: "dashboard", label: "Dashboard" },
  { key: "boards", label: "Boards" },
  { key: "sitreps", label: "SITREP" },
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
      context="Operational picture"
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
        surface={surface}
        theme={props.theme}
        client={client}
        jurisdictionId={jurisdictionId}
        boards={boardItems}
        collections={collections.data ?? []}
        feeds={feeds.data ?? []}
        collectionsError={collections.error}
        firstDashboardId={dashboards.data?.[0]?.id}
        onOpenBoard={(id) => navigate({ kind: "board", id })}
        onOpenSitrep={(id) => navigate({ kind: "sitrep", id })}
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
  boards: readonly BoardListItem[];
  collections: readonly CollectionRef[];
  feeds: readonly FeedHealth[];
  collectionsError: string | null;
  firstDashboardId: string | undefined;
  onOpenBoard: (id: string) => void;
  onOpenSitrep: (id: string) => void;
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
          collections={props.collections}
          feeds={props.feeds}
        />
      );
    case "dashboard": {
      const id = s.id ?? props.firstDashboardId;
      if (!id)
        return <EmptyState label="No dashboard configured." hint="An admin creates one from a dashboard template." />;
      return <DashboardSurface client={props.client} dashboardId={id} />;
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
    case "alerts":
      return <AlertsSurface client={props.client} />;
  }
}

const dockHeading = { margin: "0 0 8px", fontSize: "1em" } as const;
