import { useState, type CSSProperties } from "react";
import { RESOURCE_REQUEST_TRANSITIONS } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import type { ApiClient, ResourceRequestSummary } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

const PRIORITIES = ["routine", "priority", "immediate"];

const selectStyle: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "1em",
  padding: 6,
  minHeight: 44,
  borderRadius: 4,
  border: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)",
  color: "var(--eoc-text)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 10px",
  border: "1px solid var(--eoc-border)",
  borderRadius: 4,
};

type BadgeStatus = "info" | "warning" | "success" | "unknown";
function stateStatus(state: string): BadgeStatus {
  if (state === "closed") return "success";
  if (state === "cancelled") return "unknown";
  if (state === "submitted" || state === "triaged") return "warning";
  return "info";
}

function RequestRow(props: {
  req: ResourceRequestSummary;
  busy: boolean;
  onAdvance: (id: string, toState: string) => void;
}) {
  const nexts = RESOURCE_REQUEST_TRANSITIONS[props.req.state] ?? [];
  const [to, setTo] = useState<string>(nexts[0] ?? "");
  const target = to || nexts[0] || "";
  return (
    <li style={rowStyle}>
      <StatusBadge status={stateStatus(props.req.state)}>{props.req.state}</StatusBadge>
      <span style={{ flex: 1 }}>
        {props.req.item}{" "}
        <span style={{ color: "var(--eoc-text-muted)" }}>×{props.req.quantity}</span>
      </span>
      <span style={{ color: "var(--eoc-text-muted)", fontSize: "0.85em" }}>{props.req.priority}</span>
      {nexts.length > 0 ? (
        <>
          <select
            aria-label={`Next state for ${props.req.item}`}
            value={target}
            onChange={(e) => setTo(e.target.value)}
            style={selectStyle}
          >
            {nexts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Button onClick={() => props.onAdvance(props.req.id, target)} disabled={props.busy}>
            Advance
          </Button>
        </>
      ) : (
        <span style={{ color: "var(--eoc-text-muted)", fontSize: "0.85em" }}>terminal</span>
      )}
    </li>
  );
}

/**
 * The 213RR resource-request board (F5). Submit a request, and move each one
 * through the NIMS ordering lifecycle; the allowed next states come straight
 * from the dictionary transition table, so the UI can never offer an illegal
 * move (the server enforces the same table).
 */
export function ResourcesSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  incidentId: string | null;
}) {
  const [reload, setReload] = useState(0);
  const requests = useAsync(
    () => props.client.listResourceRequests(props.jurisdictionId, props.incidentId),
    [props.jurisdictionId, props.incidentId, reload],
  );
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [priority, setPriority] = useState("routine");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (!item.trim()) throw new Error("Enter a requested item.");
      await props.client.submitResourceRequest(props.jurisdictionId, {
        origin: "eoc",
        item: item.trim(),
        quantity: Number(quantity) || 1,
        priority,
        // Tag the request to the working incident so it lists in that context;
        // with no incident selected it stays a jurisdiction-wide request (79B2).
        ...(props.incidentId ? { incidentId: props.incidentId } : {}),
      });
      setItem("");
      setQuantity("1");
    });

  const list = requests.data ?? [];

  return (
    <Scroll>
      <SurfaceHeader title="Resource Requests (213RR)" />
      <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
        <Panel title="New request">
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr 1fr" }}>
            <TextField label="Requested item" value={item} onChange={setItem} />
            <TextField label="Quantity" value={quantity} onChange={setQuantity} />
            <EnumSelect label="Priority" values={PRIORITIES} value={priority} onChange={setPriority} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Button kind="primary" onClick={submit} disabled={busy}>
              Submit request
            </Button>
          </div>
        </Panel>

        <Panel title="Requests">
          {requests.loading && !requests.data ? <Loading label="Loading requests…" /> : null}
          {requests.error && !requests.data ? <ErrorNote message={requests.error} /> : null}
          {requests.data && list.length === 0 ? (
            <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>No resource requests yet.</p>
          ) : null}
          {list.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {list.map((r) => (
                <RequestRow
                  key={r.id}
                  req={r}
                  busy={busy}
                  onAdvance={(id, toState) =>
                    run(() => props.client.transitionResourceRequest(id, toState))
                  }
                />
              ))}
            </ul>
          ) : null}
        </Panel>

        {error ? (
          <p role="alert" style={{ color: "var(--eoc-status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Scroll>
  );
}
