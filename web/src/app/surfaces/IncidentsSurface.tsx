import { useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

/**
 * Incident lifecycle for the operator (F12): activate an incident from a
 * scenario template in one action (org chart, boards, checklists, and
 * libraries follow), see what is running, and close it. Activation and
 * closure are admin-gated; everyone sees the list.
 */
export function IncidentsSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  isAdmin: boolean;
}) {
  const [reload, setReload] = useState(0);
  const incidents = useAsync(
    () => props.client.listIncidents(props.jurisdictionId),
    [props.jurisdictionId, reload],
  );
  const templates = useAsync(
    () => (props.isAdmin ? props.client.listIncidentTemplates() : Promise.resolve([])),
    [props.isAdmin],
  );
  const lockdown = useAsync(
    () => props.client.getLockdown(props.jurisdictionId),
    [props.jurisdictionId, reload],
  );
  const [templateKey, setTemplateKey] = useState("");
  const [name, setName] = useState("");
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

  const tpls = templates.data ?? [];
  const activeTpl = templateKey || tpls[0]?.key || "";

  const activate = () =>
    run(async () => {
      if (!activeTpl || !name.trim()) throw new Error("Pick a template and enter an incident name.");
      await props.client.activateIncident(props.jurisdictionId, {
        templateKey: activeTpl,
        name: name.trim(),
      });
      setName("");
    });

  const list = incidents.data ?? [];

  return (
    <Scroll>
      <SurfaceHeader title="Incidents" />
      <div style={{ display: "grid", gap: 16, maxWidth: 760 }}>
        {props.isAdmin && tpls.length > 0 ? (
          <Panel title="Activate an incident">
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
              <EnumSelect
                label="Scenario template"
                values={tpls.map((t) => t.key)}
                value={activeTpl}
                onChange={setTemplateKey}
                labels={Object.fromEntries(tpls.map((t) => [t.key, t.title]))}
              />
              <TextField label="Incident name" value={name} onChange={setName} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Button kind="primary" onClick={activate} disabled={busy}>
                Activate
              </Button>
            </div>
          </Panel>
        ) : null}

        {props.isAdmin ? (
          <Panel title="Dashboard lockdown">
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <StatusBadge status={lockdown.data?.locked ? "critical" : "success"}>
                {lockdown.data?.locked ? "locked" : "open"}
              </StatusBadge>
              <span style={{ flex: 1, color: "var(--eoc-text-muted)" }}>
                {lockdown.data?.locked
                  ? "Guest and public read is suspended while an incident is open."
                  : "Guests read normally; lockdown engages when an incident opens."}
              </span>
              <Button
                onClick={() =>
                  run(() => props.client.setLockdown(props.jurisdictionId, !lockdown.data?.locked))
                }
                disabled={busy}
              >
                {lockdown.data?.locked ? "Lift lockdown" : "Lock down"}
              </Button>
            </div>
          </Panel>
        ) : null}

        <Panel title="Incidents">
          {incidents.loading && !incidents.data ? <Loading label="Loading incidents…" /> : null}
          {incidents.error && !incidents.data ? <ErrorNote message={incidents.error} /> : null}
          {incidents.data && list.length === 0 ? (
            <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>No incidents yet.</p>
          ) : null}
          {list.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {list.map((i) => (
                <li
                  key={i.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid var(--eoc-border)",
                    borderRadius: 4,
                  }}
                >
                  <StatusBadge status={i.closedAt ? "unknown" : "info"}>
                    {i.closedAt ? "closed" : "open"}
                  </StatusBadge>
                  <span style={{ flex: 1 }}>{i.name}</span>
                  <span style={{ color: "var(--eoc-text-muted)", fontSize: "0.9em" }}>{i.kind}</span>
                  {props.isAdmin && !i.closedAt ? (
                    <Button onClick={() => run(() => props.client.closeIncident(i.id))} disabled={busy}>
                      Close
                    </Button>
                  ) : null}
                </li>
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
