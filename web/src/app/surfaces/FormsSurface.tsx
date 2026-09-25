import { useEffect, useMemo, useState } from "react";
import { ICS_FORM_IDS, type IcsFormContent, type IncidentAreaRevision } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge } from "../../design/components.js";
import type { ApiClient, IapResult } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { EmptyState, Loading, Scroll, SurfaceHeader } from "../screens/parts.js";
import { FORM_TITLES, FormPreview, formLabel } from "../../iap/FormPreview.js";
import { FormComponents } from "../../iap/FormComponents.js";
import "../../iap/iap-workspace.css";

interface PeriodChoice {
  readonly revision: number;
  readonly label: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

function choicesFor(revisions: readonly IncidentAreaRevision[]): PeriodChoice[] {
  const seen = new Set<number>();
  return [...revisions]
    .sort((a, b) => b.revision - a.revision)
    .flatMap((revision) => {
      if (!revision.operationalPeriod || seen.has(revision.revision)) return [];
      seen.add(revision.revision);
      return [{ revision: revision.revision, ...revision.operationalPeriod }];
    });
}

function timeRange(period: PeriodChoice): string {
  return `${new Date(period.startsAt).toLocaleString()} to ${new Date(period.endsAt).toLocaleString()}`;
}

export interface FormsSurfaceProps {
  readonly client: ApiClient;
  readonly incidentId: string | null;
  readonly incidentName?: string | null;
  readonly periodRevision?: number | null;
  readonly operationalPeriod?: string | null;
  readonly isAdmin: boolean;
  readonly onOpenIap?: () => void;
}

export function FormsSurface(props: FormsSurfaceProps) {
  const [selectedRevision, setSelectedRevision] = useState<number | null>(props.periodRevision ?? null);
  const [formId, setFormId] = useState<string>(ICS_FORM_IDS[0]);
  const [preview, setPreview] = useState<IcsFormContent | null>(null);
  const [iap, setIap] = useState<IapResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = props.incidentId;

  useEffect(() => {
    setSelectedRevision(props.periodRevision ?? null);
    setPreview(null);
    setIap(null);
    setError(null);
  }, [active, props.periodRevision]);

  const periods = useAsync(async () => {
    if (!active) return [] as PeriodChoice[];
    const [current, history] = await Promise.all([
      props.client.getIncidentArea(active),
      props.client.incidentAreaHistory(active),
    ]);
    return choicesFor([current, ...history]);
  }, [active]);
  const selectedPeriod = useMemo(
    () => periods.data?.find((period) => period.revision === selectedRevision) ?? null,
    [periods.data, selectedRevision],
  );
  const contextPeriodLabel = selectedPeriod?.label
    ?? (selectedRevision === props.periodRevision ? props.operationalPeriod : null)
    ?? (selectedRevision ? `Operational period revision ${selectedRevision}` : "No operational period selected");

  if (!active) {
    return (
      <EmptyState
        label="No incident selected."
        hint="Choose an incident and an authoritative operational period before assembling ICS forms."
      />
    );
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function selectPeriod(value: string) {
    setSelectedRevision(value ? Number(value) : null);
    setPreview(null);
    setIap(null);
    setError(null);
  }

  return (
    <Scroll>
      <SurfaceHeader
        title="ICS Forms and IAP Assembly"
        actions={props.onOpenIap ? <Button onClick={props.onOpenIap}>Open IAP workspace</Button> : undefined}
      />
      <div className="iap-forms-workspace">
        <div className="iap-context" aria-label="ICS form context">
          <strong>{props.incidentName ?? "Selected incident"}</strong>
          <span>Incident {active}</span>
          <span>{contextPeriodLabel}</span>
          {selectedRevision ? <span>Area revision {selectedRevision}</span> : null}
        </div>

        <Panel title="Authoritative planning period">
          {periods.loading && !periods.data ? <Loading label="Loading operational periods…" /> : null}
          {periods.error ? <p role="alert" className="iap-error">{periods.error}</p> : null}
          <label className="iap-field">
            <span>Operational period revision</span>
            <select value={selectedRevision ?? ""} onChange={(event) => selectPeriod(event.target.value)}>
              <option value="">Select an operational period</option>
              {(periods.data ?? []).map((period) => (
                <option key={period.revision} value={period.revision}>
                  {period.label} · area revision {period.revision}
                </option>
              ))}
            </select>
          </label>
          {selectedPeriod ? (
            <p className="iap-muted">
              <strong>{selectedPeriod.label}</strong> · {timeRange(selectedPeriod)}
            </p>
          ) : (
            <p className="iap-period-empty">
              Select a recorded operational period. The workspace does not create an inferred period label.
            </p>
          )}
        </Panel>

        {selectedPeriod ? (
          <Panel title="ICS forms for this period">
            <FormComponents client={props.client} incidentId={active} periodRevision={selectedPeriod.revision}
              periodLabel={selectedPeriod.label} />
          </Panel>
        ) : null}

        <Panel title="Build from live incident records">
          <EnumSelect
            label="ICS form"
            values={ICS_FORM_IDS as readonly string[]}
            value={formId}
            onChange={(value) => {
              setFormId(value);
              setPreview(null);
            }}
            labels={FORM_TITLES}
          />
          <div className="iap-actions">
            <Button
              onClick={() => void run(async () => {
                if (!selectedPeriod) throw new Error("Select an authoritative operational period first.");
                setPreview(await props.client.getIcsForm(active, formId, selectedPeriod.label));
              })}
              disabled={busy || !selectedPeriod}
            >
              Preview selected form
            </Button>
            <Button
              kind="primary"
              onClick={() => void run(async () => {
                if (!selectedPeriod) throw new Error("Select an authoritative operational period first.");
                const created = await props.client.createIap(active, {
                  operationalPeriod: selectedPeriod.label,
                  periodRevision: selectedPeriod.revision,
                });
                setIap(await props.client.getIap(created.id));
              })}
              disabled={busy || !selectedPeriod}
            >
              Assemble draft IAP
            </Button>
          </div>
          <p className="iap-muted">
            Assembly creates a draft snapshot. Submission, approval, revisions, and exact-revision export are handled in the IAP workspace.
          </p>
          {error ? <p role="alert" className="iap-error">{error}</p> : null}
        </Panel>

        {preview ? (
          <Panel title={`Preview: ${formLabel(preview.id)}`}>
            <FormPreview form={preview} />
          </Panel>
        ) : null}

        {iap ? (
          <Panel title="Assembled draft">
            <div className="iap-detail">
              <div className="iap-detail-heading">
                <h2>{iap.operationalPeriod}</h2>
                <StatusBadge status="info">Draft</StatusBadge>
              </div>
              <p className="iap-muted">
                {iap.content.forms.length} stored forms · Incident {props.incidentName ?? active}
              </p>
              {props.onOpenIap ? (
                <Button kind="primary" onClick={props.onOpenIap}>Review draft in IAP workspace</Button>
              ) : null}
              <div className="iap-form-tabs" role="list" aria-label="Assembled forms">
                {iap.content.forms.map((form) => <span key={form.id}>{form.id}</span>)}
              </div>
            </div>
          </Panel>
        ) : null}
      </div>
    </Scroll>
  );
}
