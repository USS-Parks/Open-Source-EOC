import { Dashboard } from "../../dashboards/Dashboard.js";
import type { ApiClient } from "../api/client.js";
import { usePolled } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll } from "../screens/parts.js";

/**
 * The dashboard surface (the ArcGIS-Dashboards-style read). The snapshot is
 * computed server-side; here it is fetched over REST and refreshed on a
 * short poll so the numbers stay live until the dashboard WebSocket stream
 * is wired in a later milestone.
 */
export function DashboardSurface(props: { client: ApiClient; dashboardId: string }) {
  const { data, error, loading } = usePolled(
    () => props.client.dashboardData(props.dashboardId),
    5000,
    [props.dashboardId],
  );
  if (loading && !data) return <Loading label="Loading dashboard…" />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <Scroll>
      <Dashboard snapshot={data} />
      <p style={{ color: "var(--eoc-text-muted)", marginTop: 12, fontSize: "0.85em" }}>
        Updated {new Date(data.computedAt).toLocaleTimeString()}
      </p>
    </Scroll>
  );
}
