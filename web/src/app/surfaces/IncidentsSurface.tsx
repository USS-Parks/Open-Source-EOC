import { useState } from "react";
import type { ThemeName } from "../../design/tokens.js";
import { IncidentAreaEditor } from "./IncidentAreaEditor.js";
import { IncidentParticipants } from "./IncidentParticipants.js";
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
  theme: ThemeName;
}) {
  const [reload, setReload] = useState(0);
  const [selectedIncident, setSelectedIncident] = useState<string | null>(null);
  const [closeCandidate, setCloseCandidate] = useState<string | null>(null);
  const incidents = useAsync(
    () => props.client.listIncidents(props.jurisdictionId),
    [props.jurisdictionId, reload],
  );
  const templates = useAsync(
    () => (props.isAdmin ? props.client.listIncidentTemplates() : Promise.resolve([])),
    [props.isAdmin],
  );
  const detail = useAsync(
    () => selectedIncident ? props.client.getIncident(selectedIncident) : Promise.resolve(null),
    [selectedIncident, reload],
  );
  const [templateKey, setTemplateKey] = useState("");
  const [kind, setKind] = useState<"incident" | "daily_ops" | "planned_event">("incident");
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
      const activated = await props.client.activateIncident(props.jurisdictionId, {
        templateKey: activeTpl,
        name: name.trim(),
        kind,
      });
      setName("");
      setSelectedIncident(activated.incidentId);
    });

  const list = incidents.data ?? [];

  return (
    <Scroll>
      <SurfaceHeader title="Incidents" />
      <div style={{ display: "grid", gap: 16, maxWidth: selectedIncident ? 1320 : 760 }}>
        {props.isAdmin && tpls.length > 0 ? (
          <Panel title="Activate an incident">
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <EnumSelect
                label="Scenario template"
                values={tpls.map((t) => t.key)}
                value={activeTpl}
                onChange={setTemplateKey}
                labels={Object.fromEntries(tpls.map((t) => [t.key, t.title]))}
              />
              <TextField label="Incident name" value={name} onChange={setName} />
              <EnumSelect label="Incident type" values={["incident", "daily_ops", "planned_event"]} value={kind}
                onChange={(value) => setKind(value as typeof kind)}
                labels={{ incident: "Incident", daily_ops: "Daily operations", planned_event: "Planned event" }} />
            </div>
            <div style={{ marginTop: 12 }}>
              <Button kind="primary" onClick={activate} disabled={busy}>
                Activate
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
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 10px",
                    border: "1px solid var(--eoc-border)",
                    borderRadius: 4,
                  }}
                >
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                      <StatusBadge status={i.closedAt ? "unknown" : "info"}>{i.closedAt ? "closed" : "open"}</StatusBadge>
                      <strong>{i.name}</strong>
                      <span style={{ color: "var(--eoc-text-muted)", fontSize: "0.9em" }}>{i.kind.replaceAll("_", " ")}</span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, color: "var(--eoc-text-muted)", fontSize: "0.9em" }}>
                      <span>{i.canManageParticipation ? "Host owner administrator" : "No participation-administration authority"}</span>
                      <span aria-hidden="true">·</span>
                      <span>{i.canEditArea ? "Operational-area authority" : "No operational-area authority"}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
                    <Button onClick={() => { setSelectedIncident(i.id); setCloseCandidate(null); }}>Operational area</Button>
                    <Button onClick={() => { setSelectedIncident(i.id); setCloseCandidate(null); }}>Participants</Button>
                    {i.canManageParticipation && !i.closedAt ? <Button kind="danger" onClick={() => setCloseCandidate(i.id)} disabled={busy}>Close incident</Button> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        {list.filter((i) => i.id === selectedIncident).map((incident) => <Panel key={incident.id} title={incident.name + ": incident setup"}>
          <div style={{ display: "grid", gap: 16 }}>
            <p style={{ margin: 0 }}>The host organization is the jurisdiction that owns this incident. Its owner administrators activate and manage participation. Participants receive only their explicit grant. Incident positions describe operational command assignments; they do not by themselves transfer ownership or establish unified command.</p>
            {detail.loading && !detail.data ? <Loading label="Loading incident setup…" /> : null}
            {detail.error ? <ErrorNote message={detail.error} /> : null}
            {detail.data ? <section aria-label="Incident positions">
              <h3 style={{ marginTop: 0 }}>Template positions</h3>
              <p style={{ marginTop: 0, color: "var(--eoc-text-muted)" }}>These are the incident's available operational positions. Participant grants remain separate from command authority.</p>
              {detail.data.positions.length ? <ul style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, margin: 0, paddingLeft: 20 }}>
                {detail.data.positions.map((position) => <li key={position.id}>{position.title}</li>)}
              </ul> : <p>No template positions are attached.</p>}
            </section> : null}
            <IncidentAreaEditor client={props.client} incidentId={incident.id} incidentName={incident.name}
              theme={props.theme} canEdit={incident.canEditArea && !incident.closedAt} />
            <IncidentParticipants client={props.client} incidentId={incident.id} incidentName={incident.name}
              canManage={incident.canManageParticipation} closed={Boolean(incident.closedAt)} />
          </div>
        </Panel>)}

        {list.filter((i) => i.id === closeCandidate).map((incident) => <Panel key={incident.id} title={"Close " + incident.name}>
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ margin: 0 }}>Closeout prevents new incident updates. Recorded history remains available under existing authorization. End participant grants separately when their access should end.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Button kind="danger" onClick={() => run(async () => { await props.client.closeIncident(incident.id); setCloseCandidate(null); setSelectedIncident(null); })} disabled={busy}>Confirm closeout</Button>
              <Button onClick={() => setCloseCandidate(null)} disabled={busy}>Keep incident open</Button>
            </div>
          </div>
        </Panel>)}

        {error ? (
          <p role="alert" style={{ color: "var(--eoc-status-critical)" }}>
            {error}
          </p>
        ) : null}
      </div>
    </Scroll>
  );
}
