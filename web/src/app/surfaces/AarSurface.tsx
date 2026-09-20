import { useState } from "react";
import { Button, EnumSelect, Panel, StatusBadge, TextField } from "../../design/components.js";
import type { ApiClient, AarObservation } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, ErrorNote, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";

/**
 * After-action review (F, VEOC-36). Capture observations against capabilities
 * during or after an incident, then compile the AAR: the platform assembles it
 * from these observations plus the immutable chronology and exports a PDF.
 */
export function AarSurface(props: { client: ApiClient; jurisdictionId: string }) {
  const incidents = useAsync(
    () => props.client.listIncidents(props.jurisdictionId),
    [props.jurisdictionId],
  );
  const list = incidents.data ?? [];
  const [incidentId, setIncidentId] = useState("");
  const [reload, setReload] = useState(0);
  const [capability, setCapability] = useState("");
  const [kind, setKind] = useState<"strength" | "improvement">("improvement");
  const [observation, setObservation] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [overview, setOverview] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = incidentId || list[0]?.id || "";
  const observations = useAsync(
    () => (active ? props.client.listAarObservations(active) : Promise.resolve([] as AarObservation[])),
    [active, reload],
  );

  if (incidents.loading && !incidents.data) return <Loading label="Loading incidents…" />;
  if (incidents.error && !incidents.data) return <ErrorNote message={incidents.error} />;
  if (list.length === 0)
    return (
      <EmptyState
        label="No incidents to review."
        hint="Activate an incident; its after-action report assembles from observations and the chronology here."
      />
    );

  const run = async (fn: () => Promise<unknown>, reloadAfter = true) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (reloadAfter) setReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addObservation = () =>
    run(async () => {
      if (!capability.trim() || !observation.trim())
        throw new Error("Capability and observation are required.");
      await props.client.recordAarObservation(active, {
        capability: capability.trim(),
        kind,
        observation: observation.trim(),
        ...(recommendation.trim() ? { recommendation: recommendation.trim() } : {}),
      });
      setCapability("");
      setObservation("");
      setRecommendation("");
    });

  const compile = () =>
    run(async () => {
      if (!overview.trim()) throw new Error("Enter an overview for the AAR.");
      const { id } = await props.client.composeAar(active, { overview: overview.trim() });
      const blob = await props.client.downloadAarPdf(id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "after-action-review.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg("AAR compiled and downloaded.");
    }, false);

  const rows = observations.data ?? [];

  return (
    <Scroll>
      <SurfaceHeader title="After-Action Review" />
      <div style={{ display: "grid", gap: 16, maxWidth: 820 }}>
        <Panel title="Incident">
          <EnumSelect
            label="Incident"
            values={list.map((i) => i.id)}
            value={active}
            onChange={setIncidentId}
            labels={Object.fromEntries(list.map((i) => [i.id, i.name]))}
          />
        </Panel>

        <Panel title="Record an observation">
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "2fr 1fr" }}>
              <TextField label="Capability" value={capability} onChange={setCapability} />
              <EnumSelect
                label="Kind"
                values={["improvement", "strength"]}
                value={kind}
                onChange={(v) => setKind(v as "strength" | "improvement")}
              />
            </div>
            <TextField label="Observation" value={observation} onChange={setObservation} />
            <TextField label="Recommendation" value={recommendation} onChange={setRecommendation} />
            <div>
              <Button kind="primary" onClick={addObservation} disabled={busy}>
                Add observation
              </Button>
            </div>
          </div>
        </Panel>

        <Panel title="Observations">
          {observations.loading && !observations.data ? <Loading label="Loading…" /> : null}
          {rows.length === 0 && observations.data ? (
            <p style={{ color: "var(--eoc-text-muted)", margin: 0 }}>No observations yet.</p>
          ) : null}
          {rows.length > 0 ? (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
              {rows.map((o, i) => (
                <li
                  key={i}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "baseline",
                    padding: "8px 10px",
                    border: "1px solid var(--eoc-border)",
                    borderRadius: 4,
                  }}
                >
                  <StatusBadge status={o.kind === "strength" ? "success" : "warning"}>
                    {o.kind}
                  </StatusBadge>
                  <div style={{ flex: 1 }}>
                    <strong>{o.capability}</strong>
                    <div>{o.observation}</div>
                    {o.recommendation ? (
                      <div style={{ color: "var(--eoc-text-muted)" }}>Rec: {o.recommendation}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title="Compile the AAR">
          <TextField label="Overview" value={overview} onChange={setOverview} />
          <div style={{ marginTop: 12 }}>
            <Button kind="primary" onClick={compile} disabled={busy}>
              Compile and download PDF
            </Button>
          </div>
          {msg ? (
            <p style={{ color: "var(--eoc-status-success)", margin: "8px 0 0" }}>{msg}</p>
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
