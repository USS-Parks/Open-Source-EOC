import { useState } from "react";
import {
  PA_CATEGORY_LABELS,
  equipmentRatesFromTable,
  equipmentSummaryCsv,
  laborSummaryCsv,
  type ForceAccountSummary,
  type LaborRateView,
} from "@openeoc/shared";
import { EnumSelect, Panel, StatusBadge, TextField } from "../design/components.js";
import { ActionButton } from "../design/controls.js";
import type { ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { saveFile } from "../admin/labels.js";
import { formatTime } from "../datasets/format.js";
import { csvRows, dollars } from "./model.js";

/**
 * FEMA Public Assistance force account (VC-10) for the selected incident:
 * the applicant's labor, read from check-ins and shifts, and its equipment
 * hours against pool resources, costed at the jurisdiction's labor rates
 * and equipment schedule, downloaded as FEMA's Force Account Labor and
 * Equipment Summary Records, and rolled into a Public Assistance line item.
 * Administrators set labor rates and import the equipment schedule.
 */

type ForceAccountClient = Pick<ApiClient,
  "forceAccount" | "paRates" | "setLaborRate" | "importEquipmentRates" | "recordEquipmentHours" |
  "removeEquipmentHours" | "rollUpForceAccount" | "listResources" | "listPaItems">;

const SOURCE_WORDS: Readonly<Record<string, string>> = { check_in: "check-in", shift: "shift" };
const cents = (value: number) => dollars(value / 100);
const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const today = (): string => new Date().toLocaleDateString("en-CA");

interface RateDraft {
  personId: string;
  jobTitle: string;
  hourlyRate: string;
  overtimeRate: string;
  fringePercent: string;
  overtimeFringePercent: string;
  overtimeAfterHours: string;
}

interface HoursDraft {
  resourceId: string;
  rateCode: string;
  operatorPersonId: string;
  usedOn: string;
  quantity: string;
  note: string;
}

function amount(text: string, what: string, optional = false): number | null {
  if (optional && text.trim() === "") return null;
  const value = Number(text.trim());
  if (text.trim() === "" || !Number.isFinite(value)) throw new Error(`${what}: enter a number.`);
  return value;
}

export function ForceAccountPanel(props: {
  readonly client: ForceAccountClient;
  readonly jurisdictionId: string;
  readonly incidentId: string;
  readonly incidentName: string;
  readonly isAdmin: boolean;
  /** A line item's cost changed, so the Public Assistance totals read again. */
  readonly onChanged?: () => void;
}) {
  const zone = localZone();
  const [revision, setRevision] = useState(0);
  const summary = useAsync(() => props.client.forceAccount(props.incidentId, zone), [props.incidentId, zone, revision]);
  const rates = useAsync(() => props.client.paRates(props.jurisdictionId), [props.jurisdictionId, revision]);
  const resources = useAsync(() => props.client.listResources(props.jurisdictionId), [props.jurisdictionId]);
  const items = useAsync(() => props.client.listPaItems(props.jurisdictionId, { limit: 100 }), [props.jurisdictionId, revision]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [hours, setHours] = useState<HoursDraft>({ resourceId: "", rateCode: "", operatorPersonId: "", usedOn: today(), quantity: "", note: "" });
  const [rate, setRate] = useState<RateDraft | null>(null);
  const [paItemId, setPaItemId] = useState("");
  const [rateFile, setRateFile] = useState<File | null>(null);
  const [edition, setEdition] = useState("FEMA 2025");
  const [source, setSource] = useState<"fema" | "local">("fema");

  const act = async (fn: () => Promise<string>) => {
    setBusy(true); setError(null); setNotice("");
    try {
      setNotice(await fn());
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const s: ForceAccountSummary | null = summary.data;
  const labor = rates.data?.labor ?? [];
  const schedule = rates.data?.equipment ?? [];
  const people = new Map<string, string>();
  for (const row of s?.labor ?? []) people.set(row.personId, row.personName);
  for (const row of labor) people.set(row.personId, row.personName);
  const lineItems = (items.data?.items ?? []).filter((item) => !item.incident_id || item.incident_id === props.incidentId);
  const fileBase = props.incidentName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "incident";

  const openRate = (personId: string, existing: LaborRateView | undefined) => setRate({
    personId,
    jobTitle: existing?.jobTitle ?? "",
    hourlyRate: existing ? String(existing.hourlyRate) : "",
    overtimeRate: existing?.overtimeRate ? String(existing.overtimeRate) : "",
    fringePercent: existing ? String(existing.fringePercent) : "0",
    overtimeFringePercent: existing?.overtimeFringePercent !== null && existing?.overtimeFringePercent !== undefined ? String(existing.overtimeFringePercent) : "",
    overtimeAfterHours: existing ? String(existing.overtimeAfterHours) : "8",
  });
  const saveRate = () => act(async () => {
    if (!rate) return "";
    if (!rate.jobTitle.trim()) throw new Error("Enter the job title.");
    const saved = await props.client.setLaborRate(props.jurisdictionId, rate.personId, {
      jobTitle: rate.jobTitle.trim(),
      hourlyRate: amount(rate.hourlyRate, "Hourly rate")!,
      overtimeRate: amount(rate.overtimeRate, "Overtime rate", true),
      fringePercent: amount(rate.fringePercent, "Fringe percent")!,
      overtimeFringePercent: amount(rate.overtimeFringePercent, "Overtime fringe percent", true),
      overtimeAfterHours: amount(rate.overtimeAfterHours, "Overtime after")!,
    });
    setRate(null);
    return `Labor rate saved for ${saved.personName}.`;
  });
  const recordHours = () => act(async () => {
    if (!hours.rateCode) throw new Error("Choose the equipment rate code.");
    await props.client.recordEquipmentHours(props.incidentId, {
      resourceId: hours.resourceId || null,
      rateCode: hours.rateCode,
      operatorPersonId: hours.operatorPersonId || null,
      usedOn: hours.usedOn,
      quantity: amount(hours.quantity, "Hours")!,
      note: hours.note.trim(),
    });
    setHours((current) => ({ ...current, quantity: "", note: "" }));
    return "Equipment hours recorded.";
  });
  const importRates = () => act(async () => {
    if (!rateFile) throw new Error("Choose the rate schedule's CSV file.");
    if (!edition.trim()) throw new Error("Name the schedule's edition, such as FEMA 2025.");
    const { rows, refused } = equipmentRatesFromTable(csvRows(await rateFile.text()));
    if (rows.length === 0) throw new Error("The file holds no rates.");
    const result = await props.client.importEquipmentRates(props.jurisdictionId, { edition: edition.trim(), source, rows });
    return `${result.inserted} rates added and ${result.updated} replaced from ${edition.trim()}.`
      + (refused.length ? ` ${refused.length} lines were left out: ${refused.slice(0, 5).map((r) => `line ${r.line}, ${r.reason}`).join("; ")}.` : "");
  });
  const rollUp = () => act(async () => {
    if (!paItemId) throw new Error("Choose the line item the force account costs.");
    const result = await props.client.rollUpForceAccount(props.incidentId, paItemId, zone);
    props.onChanged?.();
    return `The line item's estimated cost is now ${cents(result.summary.totals.totalCents)}, from the force account.`;
  });

  return (
    <Panel title="Force account">
      <p className="d21-muted">
        {props.incidentName}'s own labor and equipment, costed at the jurisdiction's rates. Labor comes from closed check-ins and
        from past shifts no check-in covers, one row per person per day in {zone}. Regular and overtime hours are kept apart:
        under the Public Assistance Program and Policy Guide, straight time of budgeted staff on emergency work is not eligible.
      </p>
      {summary.error ? <p className="d21-error" role="alert">{summary.error}</p> : null}
      {s ? <>
        <div className="damage-kpis" aria-label="Force account totals">
          <div className="damage-fa-total"><span>Labor</span><strong>{cents(s.totals.laborCents)}</strong>
            <small>{s.totals.regularHours} regular and {s.totals.overtimeHours} overtime hours</small></div>
          <div className="damage-fa-total"><span>Equipment</span><strong>{cents(s.totals.equipmentCents)}</strong></div>
          <div className="damage-fa-total"><span>Force account total</span><strong>{cents(s.totals.totalCents)}</strong></div>
        </div>
        {s.openCheckIns.length ? (
          <p className="d21-callout" role="note">
            Still checked in, and not counted until they check out:{" "}
            {s.openCheckIns.map((open) => `${open.personName} since ${formatTime(open.since)}`).join("; ")}.
          </p>
        ) : null}
        {s.unratedPeople.length || s.unratedCodes.length ? (
          <p className="d21-callout" role="note">
            Costed at nothing until they have a rate:{" "}
            {[...s.unratedPeople.map((p) => p.personName), ...s.unratedCodes.map((code) => `equipment code ${code}`)].join(", ")}.
          </p>
        ) : null}
        <table className="damage-fa-table">
          <caption>Labor</caption>
          <thead><tr><th scope="col">Name</th><th scope="col">Job title</th><th scope="col">Date</th><th scope="col">Regular hours</th>
            <th scope="col">Overtime hours</th><th scope="col">Cost</th><th scope="col">From</th></tr></thead>
          <tbody>
            {s.labor.length === 0 ? <tr><td colSpan={7}>No closed check-ins or past shifts on this incident yet.</td></tr> : null}
            {s.labor.map((row) => (
              <tr key={`${row.personId}:${row.date}`}>
                <td>{row.personName}</td>
                <td>{row.jobTitle ?? <StatusBadge status="warning">No labor rate</StatusBadge>}</td>
                <td>{row.date}</td><td>{row.regularHours}</td><td>{row.overtimeHours}</td><td>{cents(row.costCents)}</td>
                <td>{row.sources.map((source) => SOURCE_WORDS[source]).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="damage-fa-table">
          <caption>Equipment</caption>
          <thead><tr><th scope="col">Equipment</th><th scope="col">Code</th><th scope="col">Operator</th><th scope="col">Date</th>
            <th scope="col">Used</th><th scope="col">Rate</th><th scope="col">Cost</th><th scope="col">Remove</th></tr></thead>
          <tbody>
            {s.equipment.length === 0 ? <tr><td colSpan={8}>No equipment hours recorded on this incident yet.</td></tr> : null}
            {s.equipment.map((row) => (
              <tr key={row.id}>
                <td>{[row.resourceName, row.equipment].filter(Boolean).join(": ") || row.code}</td>
                <td>{row.code}</td><td>{row.operatorName ?? ""}</td><td>{row.date}</td>
                <td>{row.quantity} {row.unit === "hour" ? "hours" : row.unit}</td>
                <td>{row.rate === null ? <StatusBadge status="warning">No rate</StatusBadge> : `${dollars(row.rate)} per ${row.unit}`}</td>
                <td>{cents(row.costCents)}</td>
                <td><ActionButton kind="quiet" aria-label={`Remove ${row.code} on ${row.date}`} disabled={busy}
                  onClick={() => void act(async () => { await props.client.removeEquipmentHours(row.id); return "Equipment hours removed."; })}>Remove</ActionButton></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="damage-actions">
          <ActionButton kind="secondary" onClick={() => saveFile(new Blob([laborSummaryCsv(s)], { type: "text/csv" }), `${fileBase}-force-account-labor.csv`)}>
            Download labor summary
          </ActionButton>
          <ActionButton kind="secondary" onClick={() => saveFile(new Blob([equipmentSummaryCsv(s)], { type: "text/csv" }), `${fileBase}-force-account-equipment.csv`)}>
            Download equipment summary
          </ActionButton>
        </div>
      </> : null}

      <form className="damage-fa-form" aria-label="Record equipment hours" onSubmit={(event) => { event.preventDefault(); void recordHours(); }}>
        <h3 className="damage-subhead">Record equipment hours</h3>
        <div className="damage-fa-grid">
          <EnumSelect label="Pool resource" values={["", ...(resources.data ?? []).map((r) => r.id)]} value={hours.resourceId}
            onChange={(resourceId) => setHours({ ...hours, resourceId })}
            labels={{ "": "Not from the pool", ...Object.fromEntries((resources.data ?? []).map((r) => [r.id, r.name])) }} />
          <EnumSelect label="Equipment rate code" values={["", ...schedule.map((r) => r.code)]} value={hours.rateCode}
            onChange={(rateCode) => setHours({ ...hours, rateCode })}
            labels={{ "": schedule.length ? "Choose a code" : "Import a rate schedule first",
              ...Object.fromEntries(schedule.map((r) => [r.code, `${r.code} ${r.equipment}${r.capacity ? `, ${r.capacity}` : ""}: ${dollars(r.rate)} per ${r.unit}`])) }} />
          <EnumSelect label="Operator" values={["", ...people.keys()]} value={hours.operatorPersonId}
            onChange={(operatorPersonId) => setHours({ ...hours, operatorPersonId })}
            labels={{ "": "No operator named", ...Object.fromEntries(people) }} />
          <label className="damage-field">Date used
            <input type="date" value={hours.usedOn} onChange={(event) => setHours({ ...hours, usedOn: event.target.value })} />
          </label>
          <TextField label="Hours used" value={hours.quantity} onChange={(quantity) => setHours({ ...hours, quantity })} />
          <TextField label="Note" value={hours.note} onChange={(note) => setHours({ ...hours, note })} />
        </div>
        <div className="damage-actions">
          <ActionButton type="submit" kind="primary" loading={busy} loadingLabel="Recording…">Record hours</ActionButton>
        </div>
      </form>

      <form className="damage-fa-form" aria-label="Roll into a line item" onSubmit={(event) => { event.preventDefault(); void rollUp(); }}>
        <h3 className="damage-subhead">Roll into a Public Assistance line item</h3>
        <p className="d21-muted">The line item's estimated cost becomes the force account total, and it keeps the summary it came from.</p>
        <div className="damage-actions">
          <EnumSelect label="Line item" values={["", ...lineItems.map((item) => item.id)]} value={paItemId} onChange={setPaItemId}
            labels={{ "": lineItems.length ? "Choose a line item" : "Record a line item under Public Assistance first",
              ...Object.fromEntries(lineItems.map((item) => [item.id, `${item.applicant}, ${PA_CATEGORY_LABELS[item.category] ?? item.category}: ${item.description || "no description"}`])) }} />
          <ActionButton type="submit" kind="primary" loading={busy} loadingLabel="Rolling up…">Roll into line item</ActionButton>
        </div>
      </form>

      {rates.data ? (
        <section className="damage-fa-form" aria-label="Labor rates">
          <h3 className="damage-subhead">Labor rates</h3>
          {labor.length ? (
            <ul className="damage-fa-rates">
              {labor.map((r) => (
                <li key={r.personId}>
                  <strong>{r.personName}</strong>, {r.jobTitle}: {dollars(r.hourlyRate)} an hour
                  {r.overtimeRate ? `, ${dollars(r.overtimeRate)} overtime` : ""}, fringe {r.fringePercent}%, overtime after {r.overtimeAfterHours} hours
                  {props.isAdmin ? <> <ActionButton kind="quiet" aria-label={`Edit the labor rate for ${r.personName}`} onClick={() => openRate(r.personId, r)}>Edit</ActionButton></> : null}
                </li>
              ))}
            </ul>
          ) : <p className="d21-muted">No labor rates yet.</p>}
          {props.isAdmin && s?.unratedPeople.length ? (
            <p>Set a rate for:{" "}
              {s.unratedPeople.map((p) => (
                <ActionButton key={p.personId} kind="secondary" aria-label={`Set a labor rate for ${p.personName}`} onClick={() => openRate(p.personId, undefined)}>
                  {p.personName}
                </ActionButton>
              ))}
            </p>
          ) : null}
          {rate ? (
            <form aria-label={`Labor rate for ${people.get(rate.personId) ?? "the person"}`} onSubmit={(event) => { event.preventDefault(); void saveRate(); }}>
              <div className="damage-fa-grid">
                <TextField label="Job title" value={rate.jobTitle} onChange={(jobTitle) => setRate({ ...rate, jobTitle })} />
                <TextField label="Hourly rate (dollars)" value={rate.hourlyRate} onChange={(hourlyRate) => setRate({ ...rate, hourlyRate })} />
                <TextField label="Overtime rate (dollars, optional)" value={rate.overtimeRate} onChange={(overtimeRate) => setRate({ ...rate, overtimeRate })} />
                <TextField label="Fringe (percent)" value={rate.fringePercent} onChange={(fringePercent) => setRate({ ...rate, fringePercent })} />
                <TextField label="Overtime fringe (percent, optional)" value={rate.overtimeFringePercent} onChange={(overtimeFringePercent) => setRate({ ...rate, overtimeFringePercent })} />
                <TextField label="Overtime after (hours a day)" value={rate.overtimeAfterHours} onChange={(overtimeAfterHours) => setRate({ ...rate, overtimeAfterHours })} />
              </div>
              <div className="damage-actions">
                <ActionButton type="submit" kind="primary" loading={busy} loadingLabel="Saving…">Save labor rate</ActionButton>
                <ActionButton kind="quiet" onClick={() => setRate(null)}>Cancel</ActionButton>
              </div>
            </form>
          ) : null}
        </section>
      ) : null}

      {props.isAdmin ? (
        <form className="damage-fa-form" aria-label="Import equipment rates" onSubmit={(event) => { event.preventDefault(); void importRates(); }}>
          <h3 className="damage-subhead">Equipment rate schedule</h3>
          <p className="d21-muted">
            {schedule.length ? `${schedule.length} rates, from ${[...new Set(schedule.map((r) => r.edition))].join(" and ")}.` : "No rates yet."}{" "}
            Import FEMA's Schedule of Equipment Rates as a CSV file with its Cost Code, Equipment, Specifications, Capacity or Size,
            HP, Notes, Unit and rate columns, or local rates under the same headings. A code already here is replaced.
          </p>
          <div className="damage-fa-grid">
            <label className="damage-field">Rate schedule (CSV)
              <input type="file" accept=".csv,text/csv" onChange={(event) => setRateFile(event.target.files?.[0] ?? null)} />
            </label>
            <TextField label="Edition" value={edition} onChange={setEdition} />
            <EnumSelect label="Source" values={["fema", "local"]} value={source} onChange={(value) => setSource(value as "fema" | "local")}
              labels={{ fema: "FEMA schedule", local: "Local rates" }} />
          </div>
          <div className="damage-actions">
            <ActionButton type="submit" kind="primary" loading={busy} loadingLabel="Importing…">Import rates</ActionButton>
          </div>
        </form>
      ) : null}
      {error ? <p className="d21-error" role="alert">{error}</p> : null}
      {notice ? <p className="damage-notice" role="status">{notice}</p> : null}
    </Panel>
  );
}
