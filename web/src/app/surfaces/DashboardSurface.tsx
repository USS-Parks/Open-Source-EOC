import { Dashboard } from "../../dashboards/Dashboard.js";
import { Button } from "../../design/components.js";
import type { ApiClient } from "../api/client.js";
import { usePolled } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll } from "../screens/parts.js";

/**
 * The dashboard surface (the ArcGIS-Dashboards-style read). The snapshot is
 * computed server-side; here it is fetched over REST and refreshed on a short
 * poll. A runtime filter (carried in the URL) scopes every counting widget, so
 * a drilldown and a deep link reconcile to the same records (VEOC-81).
 */
export function DashboardSurface(props: {
  client: ApiClient;
  dashboardId: string;
  filter: { field: string; equals: string } | null;
  onFilter: (filter: { field: string; equals: string } | null) => void;
}) {
  const { data, error, loading } = usePolled(
    () => props.client.dashboardData(props.dashboardId, props.filter),
    5000,
    [props.dashboardId, props.filter?.field, props.filter?.equals],
  );
  if (loading && !data) return <Loading label="Loading dashboard…" />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <Scroll>
      {props.filter ? (
        <div
          role="status"
          style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" }}
        >
          <span style={{ color: "var(--eoc-text-muted)" }}>Filtered</span>
          <strong>
            {props.filter.field} = {props.filter.equals}
          </strong>
          <Button kind="quiet" onClick={() => props.onFilter(null)}>
            Clear filter
          </Button>
        </div>
      ) : null}
      <Dashboard
        snapshot={data}
        onDrill={(field, value) => props.onFilter({ field, equals: value })}
      />
      <p style={{ color: "var(--eoc-text-muted)", marginTop: 12, fontSize: "0.85em" }}>
        Updated {new Date(data.computedAt).toLocaleTimeString()}
      </p>
    </Scroll>
  );
}
