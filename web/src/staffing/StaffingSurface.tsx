import { useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EnumSelect } from "../design/components.js";
import { ActionButton, Tabs } from "../design/controls.js";
import { ConditionBadge, EmptyState, ErrorState, LoadingState } from "../design/feedback.js";
import { QrCode } from "../design/qr.js";
import { readAllPages, type ApiClient } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import {
  ICS_211,
  type BadgeEntry,
  canReadQrCodes,
  groupBadgeCode,
  ics211Rows,
  icsDateTime,
  instant,
  methodLabel,
  normalizeBadgeCode,
  readQrCode,
  type OnDutyEntry,
  type StaffingSummary,
} from "./model.js";
import "./staffing.css";

type View = "duty" | "ics211" | "badges" | "shifts";
const VIEWS: ReadonlyArray<{ id: View; label: string }> = [
  { id: "duty", label: "Check-in and on duty" },
  { id: "ics211", label: "ICS-211 check-in list" },
  { id: "badges", label: "Badges" },
  { id: "shifts", label: "Shifts" },
];

/**
 * Printed copies go through a body-level sheet: the console shell scrolls
 * inside fixed-height panes, so printing it in place would clip a long list.
 */
function PrintSheet(props: { children: ReactNode }) {
  return createPortal(<div className="eoc-staffing-print-sheet">{props.children}</div>, document.body);
}

function Ics211(props: { rows: ReturnType<typeof ics211Rows>; incidentName: string | null }) {
  return <section className="eoc-ics211" aria-label={`${ICS_211.id} ${ICS_211.title}`}>
    <header>
      <h2>{ICS_211.id} {ICS_211.title}</h2>
      <dl>
        <div><dt>Incident name</dt><dd>{props.incidentName ?? "No incident selected"}</dd></div>
        <div><dt>Prepared</dt><dd>{icsDateTime(new Date().toISOString())}</dd></div>
        <div><dt>Checked in</dt><dd>{props.rows.length}</dd></div>
      </dl>
    </header>
    <table className="eoc-table">
      <thead><tr><th>No.</th><th>Name</th><th>Agency</th><th>Incident assignment</th><th>Check-in date</th><th>Check-in time</th><th>Checked out</th><th>Method</th></tr></thead>
      <tbody>{props.rows.map((row) => <tr key={row.id}>
        <td>{row.number}</td><td>{row.name}</td><td>{row.agency}</td><td>{row.assignment}</td><td>{row.date}</td><td>{row.time}</td><td>{row.checkOut}</td><td>{row.method}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

function BadgeList(props: { badges: readonly BadgeEntry[]; busy: boolean; onRevoke: (badge: BadgeEntry) => void }) {
  if (props.badges.length === 0) return <EmptyState title="No badges issued" description="Issued badges are listed here, and a lost one can be revoked." />;
  return <div className="eoc-staffing-scroll"><table className="eoc-table">
    <thead><tr><th>Holder</th><th>Printed position</th><th>Issued</th><th>Status</th><th>Action</th></tr></thead>
    <tbody>{props.badges.map((badge) => <tr key={badge.id}>
      <td>{badge.personName}</td><td>{badge.label ?? "None"}</td>
      <td><time dateTime={badge.issuedAt}>{icsDateTime(badge.issuedAt)}</time></td>
      <td>{badge.revokedAt ? <>Revoked <time dateTime={badge.revokedAt}>{icsDateTime(badge.revokedAt)}</time></> : "Active"}</td>
      <td>{badge.revokedAt ? null : <ActionButton kind="quiet" disabled={props.busy}
        onClick={() => props.onRevoke(badge)}>Revoke badge for {badge.personName}</ActionButton>}</td>
    </tr>)}</tbody>
  </table></div>;
}

/** A badge: the QR code holds the badge code as printed beside it, so a scanner or a typist enters the same thing. */
function Badge(props: { name: string; position: string; code: string }) {
  return <article className="eoc-staffing-badge" aria-label={`Badge for ${props.name}`}>
    <p className="eoc-staffing-eyebrow">Staff badge</p>
    <h2>{props.name}</h2>
    <p className="eoc-staffing-badge-position">{props.position}</p>
    <div className="eoc-staffing-badge-scan">
      <QrCode value={props.code} label={`QR code of the badge code for ${props.name}`} className="eoc-staffing-badge-qr" />
      <div>
        <p className="eoc-staffing-eyebrow">Badge code</p>
        <p className="eoc-staffing-badge-code">{groupBadgeCode(props.code)}</p>
      </div>
    </div>
  </article>;
}

/**
 * Staffing for the jurisdiction: check people in and out of positions by name
 * or badge code, see who is on duty and which positions sit vacant, print the
 * ICS-211 check-in list, issue badges, and schedule shifts.
 */
export function StaffingSurface(props: {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly personId: string | null;
  readonly incidentId: string | null;
  readonly incidentName: string | null;
  readonly isAdmin: boolean;
  readonly canWrite: boolean;
}) {
  const { client, jurisdictionId: j, personId: me } = props;
  const [view, setView] = useState<View>("duty");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [positionId, setPositionId] = useState("");
  const [checkInPerson, setCheckInPerson] = useState(me ?? "");
  const [badgeCode, setBadgeCode] = useState("");
  const [badgePerson, setBadgePerson] = useState("");
  const [badgePosition, setBadgePosition] = useState("");
  const [issued, setIssued] = useState<{ id: string; name: string; position: string; code: string } | null>(null);
  const [shiftPosition, setShiftPosition] = useState("");
  const [shiftPerson, setShiftPerson] = useState("");
  const [shiftStart, setShiftStart] = useState("");
  const [shiftEnd, setShiftEnd] = useState("");

  const summary = useAsync(() => client.staffingSummary(j), [client, j]);
  // The ICS-211 prints every check-in, so it reads them all, and only when shown.
  const history = useAsync(() => view === "ics211"
    ? readAllPages((page) => client.checkinHistory(j, props.incidentId, page).then((r) => ({ items: r.checkins, nextCursor: r.nextCursor })))
    : Promise.resolve(null), [client, j, props.incidentId, view]);
  const badges = useAsync(() => view === "badges" && props.isAdmin ? client.listBadges(j) : Promise.resolve(null),
    [client, j, view, props.isAdmin]);
  const positions = useAsync(() => client.listPositions(j), [client, j]);
  // Only an administrator can list the jurisdiction's people; everyone else
  // checks in and schedules themselves, or checks in a badge holder.
  const members = useAsync(() => props.isAdmin
    ? readAllPages((page) => client.listMembers(j, page).then((r) => ({ items: r.members, nextCursor: r.nextCursor })))
    : Promise.resolve([]), [client, j, props.isAdmin]);

  // Pages read with "Load more" extend the first page they were read after;
  // a reload after any change starts again from the first page.
  const [more, setMore] = useState<{ base: StaffingSummary; onDuty: readonly OnDutyEntry[]; nextCursor: string | null } | null>(null);
  const loaded = summary.data && more?.base === summary.data ? more
    : summary.data ? { base: summary.data, onDuty: summary.data.onDuty, nextCursor: summary.data.nextCursor } : null;
  const onDuty = loaded?.onDuty ?? [];

  const people = (members.data ?? []).filter((member) => !member.disabled);
  const nameOf = (id: string) => people.find((member) => member.personId === id)?.displayName;
  const who = (id: string) => (id === me ? "You" : nameOf(id) ?? "The badge holder");
  const titleOf = (id: string) => positions.data?.find((position) => position.id === id)?.title ?? "the position";
  const incident = props.incidentId ? { incidentId: props.incidentId } : {};

  const positionValues = ["", ...(positions.data ?? []).map((position) => position.id)];
  const positionLabels = Object.fromEntries([["", "Choose a position"], ...(positions.data ?? []).map((p) => [p.id, p.title])]);
  const others = people.filter((member) => member.personId !== me);
  const selfAndOthers = [...(me ? [me] : []), ...others.map((member) => member.personId)];
  const personLabels = Object.fromEntries([["", "Unassigned"], ...(me ? [[me, "Myself"]] : []), ...others.map((m) => [m.personId, m.displayName])]);
  const required = { selectProps: { required: true } };

  const act = async (work: () => Promise<string>, reload = true) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      setNotice(await work());
      if (reload) summary.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  };
  const loadMore = () => act(async () => {
    if (!loaded?.nextCursor) return "Every check-in is loaded.";
    const next = await client.staffingSummary(j, { cursor: loaded.nextCursor });
    const all = [...loaded.onDuty, ...next.onDuty];
    setMore({ base: loaded.base, onDuty: all, nextCursor: next.nextCursor });
    return `${all.length} check-ins loaded.`;
  }, false);

  const checkIn = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const code = normalizeBadgeCode(badgeCode);
      const position = titleOf(positionId);
      const result = code
        ? await client.scanCheckIn(j, { badgeToken: code, positionId, ...incident })
        : { ...await client.checkIn(j, { personId: checkInPerson, positionId, ...incident }), personId: checkInPerson };
      setBadgeCode("");
      return result.deduplicated
        ? `${who(result.personId)} ${result.personId === me ? "were" : "was"} already checked in as ${position}.`
        : `${who(result.personId)} checked in as ${position}.`;
    });
  };
  const checkOut = (entry: OnDutyEntry) => act(async () => {
    await client.checkOut(entry.checkinId);
    return `${entry.personName} checked out of ${entry.positionTitle}.`;
  });
  const issueBadge = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const name = nameOf(badgePerson) ?? "Staff member";
      const position = titleOf(badgePosition);
      const { id, token } = await client.issueBadge(j, { personId: badgePerson, label: position });
      setIssued({ id, name, position, code: token });
      badges.reload();
      return `Badge issued to ${name}. Print it now; the code is not shown again.`;
    }, false);
  };
  const revoke = (badge: BadgeEntry) => act(async () => {
    await client.revokeBadge(badge.id);
    // A revoked badge is not left on screen to print.
    if (issued?.id === badge.id) setIssued(null);
    badges.reload();
    return `Badge for ${badge.personName} revoked. Its code no longer checks anyone in.`;
  }, false);
  const scheduleShift = (event: FormEvent) => {
    event.preventDefault();
    void act(async () => {
      const startsAt = instant(shiftStart);
      const endsAt = instant(shiftEnd);
      if (!startsAt || !endsAt) throw new Error("Enter when the shift starts and ends.");
      await client.createShift(j, { positionId: shiftPosition, startsAt, endsAt, ...(shiftPerson ? { personId: shiftPerson } : {}), ...incident });
      setShiftStart(""); setShiftEnd("");
      return `Shift scheduled for ${titleOf(shiftPosition)}.`;
    });
  };
  const scan = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    void readQrCode(file)
      .then((code) => (code ? setBadgeCode(code) : setError("No badge code was found in that image. Type the code instead.")))
      .catch(() => setError("That image could not be read. Type the badge code instead."));
  };

  const listState = (content: ReactNode) => summary.loading && !summary.data ? <LoadingState label="Loading staffing…" />
    : summary.error && !summary.data ? <ErrorState title="Staffing unavailable" message={summary.error}
      action={<ActionButton onClick={summary.reload}>Retry</ActionButton>} />
      : content;
  const loadMoreButton = loaded?.nextCursor
    ? <ActionButton kind="secondary" loading={busy} onClick={() => void loadMore()}>Load more check-ins</ActionButton> : null;
  const rows = ics211Rows(history.data ?? []);

  const panels: Record<View, () => ReactNode> = {
    duty: () => <>
      {props.canWrite ? <form className="eoc-staffing-form" onSubmit={checkIn} aria-label="Check in">
        <h2>Check in</h2>
        <div className="eoc-staffing-fields">
          <EnumSelect label="Position" values={positionValues} value={positionId} onChange={setPositionId} labels={positionLabels} {...required} />
          {props.isAdmin && !badgeCode ? <EnumSelect label="Person" values={selfAndOthers} value={checkInPerson} onChange={setCheckInPerson} labels={personLabels} /> : null}
          <label>Badge code, optional<input value={badgeCode} autoComplete="off" spellCheck={false}
            onChange={(event) => setBadgeCode(event.target.value)} /></label>
          {canReadQrCodes() ? <label className="eoc-staffing-camera">Scan badge QR code<input type="file" accept="image/*" capture="environment"
            disabled={busy} onChange={(event) => scan(event.target.files?.[0])} /></label> : null}
        </div>
        <p className="eoc-staffing-hint">With a badge code, its holder is checked in. Without one, {props.isAdmin ? "the chosen person" : "you"} {props.isAdmin ? "is" : "are"} checked in.</p>
        <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Checking in…" disabled={!positionId}>
          {badgeCode.trim() ? "Check in badge holder" : "Check in"}</ActionButton>
      </form> : null}
      <section className="eoc-staffing-block" aria-labelledby="staffing-on-duty">
        <h2 id="staffing-on-duty">On duty</h2>
        {listState(onDuty.length === 0 ? <EmptyState title="No one is checked in" description="Check-ins appear here until the person checks out." />
          : <div className="eoc-staffing-scroll"><table className="eoc-table">
            <thead><tr><th>Name</th><th>Position</th><th>Checked in</th><th>Method</th>{props.canWrite ? <th>Action</th> : null}</tr></thead>
            <tbody>{onDuty.map((entry) => <tr key={entry.checkinId}>
              <td>{entry.personName}</td><td>{entry.positionTitle}</td>
              <td><time dateTime={entry.since}>{icsDateTime(entry.since)}</time></td><td>{methodLabel(entry.method)}</td>
              {props.canWrite ? <td><ActionButton kind="quiet" disabled={busy} onClick={() => void checkOut(entry)}>Check out</ActionButton></td> : null}
            </tr>)}</tbody>
          </table></div>)}
        {loadMoreButton}
      </section>
      <section className="eoc-staffing-block" aria-labelledby="staffing-vacant">
        <h2 id="staffing-vacant">Vacant positions</h2>
        {listState(summary.data?.vacantPositions.length === 0
          ? <EmptyState title="No vacant positions" description="Every position has someone checked in." />
          : <ul className="eoc-staffing-vacancies">{summary.data?.vacantPositions.map((position) => <li key={position.id}>
            <ConditionBadge state="watch" label="Vacant" /><strong>{position.title}</strong></li>)}</ul>)}
      </section>
    </>,
    ics211: () => <>
      {history.loading && !history.data ? <LoadingState label="Loading check-ins…" />
        : history.error && !history.data ? <ErrorState title="Check-ins unavailable" message={history.error}
          action={<ActionButton onClick={history.reload}>Retry</ActionButton>} />
          : <>
            <Ics211 rows={rows} incidentName={props.incidentName} />
            <PrintSheet><Ics211 rows={rows} incidentName={props.incidentName} /></PrintSheet>
          </>}
      <div className="eoc-staffing-actions">
        <ActionButton kind="primary" disabled={!history.data} onClick={() => window.print()}>Print ICS-211</ActionButton>
      </div>
    </>,
    badges: () => props.isAdmin ? <>
      <form className="eoc-staffing-form" onSubmit={issueBadge} aria-label="Issue a badge">
        <h2>Issue a badge</h2>
        <div className="eoc-staffing-fields">
          <EnumSelect label="Person" values={["", ...people.map((m) => m.personId)]} value={badgePerson} onChange={setBadgePerson}
            labels={{ ...personLabels, "": "Choose a person", ...(me ? { [me]: nameOf(me) ?? "Myself" } : {}) }} {...required} />
          <EnumSelect label="Position printed on the badge" values={positionValues} value={badgePosition} onChange={setBadgePosition} labels={positionLabels} {...required} />
        </div>
        <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Issuing…" disabled={!badgePerson || !badgePosition}>Issue badge</ActionButton>
      </form>
      {issued ? <section className="eoc-staffing-block" aria-label="Issued badge">
        <Badge name={issued.name} position={issued.position} code={issued.code} />
        <PrintSheet><Badge name={issued.name} position={issued.position} code={issued.code} /></PrintSheet>
        <p className="eoc-staffing-hint">This code is shown only once, so print the badge now. At check-in, scan its QR code or type the printed code into Badge code. A new badge does not cancel an earlier one; revoke it below.</p>
        <div className="eoc-staffing-actions"><ActionButton kind="primary" onClick={() => window.print()}>Print badge</ActionButton></div>
      </section> : null}
      <section className="eoc-staffing-block" aria-labelledby="staffing-badges">
        <h2 id="staffing-badges">Issued badges</h2>
        {badges.loading && !badges.data ? <LoadingState label="Loading badges…" />
          : badges.error && !badges.data ? <ErrorState title="Badges unavailable" message={badges.error}
            action={<ActionButton onClick={badges.reload}>Retry</ActionButton>} />
            : <BadgeList badges={badges.data ?? []} busy={busy} onRevoke={(badge) => void revoke(badge)} />}
      </section>
    </> : <EmptyState title="Badges are issued by an administrator" description="Ask a jurisdiction administrator for a badge. You can still check in by name." />,
    shifts: () => <>
      {props.canWrite ? <form className="eoc-staffing-form" onSubmit={scheduleShift} aria-label="Schedule a shift">
        <h2>Schedule a shift</h2>
        <div className="eoc-staffing-fields">
          <EnumSelect label="Position" values={positionValues} value={shiftPosition} onChange={setShiftPosition} labels={positionLabels} {...required} />
          <EnumSelect label="Assigned to" values={["", ...selfAndOthers]} value={shiftPerson} onChange={setShiftPerson} labels={personLabels} />
          <label>Starts<input type="datetime-local" required value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} /></label>
          <label>Ends<input type="datetime-local" required value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} /></label>
        </div>
        <ActionButton kind="primary" type="submit" loading={busy} loadingLabel="Scheduling…" disabled={!shiftPosition}>Schedule shift</ActionButton>
      </form> : null}
      <section className="eoc-staffing-block" aria-labelledby="staffing-shifts">
        <h2 id="staffing-shifts">Upcoming shifts</h2>
        {listState(summary.data?.upcomingShifts.length === 0
          ? <EmptyState title="No upcoming shifts" description="Scheduled shifts appear here until they end." />
          : <div className="eoc-staffing-scroll"><table className="eoc-table">
            <thead><tr><th>Position</th><th>Assigned to</th><th>Starts</th><th>Ends</th></tr></thead>
            <tbody>{summary.data?.upcomingShifts.map((shift) => <tr key={shift.id}>
              <td>{shift.positionTitle}</td><td>{shift.personName ?? "Unassigned"}</td>
              <td><time dateTime={shift.startsAt}>{icsDateTime(shift.startsAt)}</time></td>
              <td><time dateTime={shift.endsAt}>{icsDateTime(shift.endsAt)}</time></td>
            </tr>)}</tbody>
          </table></div>)}
      </section>
    </>,
  };

  return <section className="eoc-staffing" aria-label="Staffing">
    <header className="eoc-staffing-header">
      <p className="eoc-staffing-eyebrow">{props.incidentName ?? "Whole jurisdiction"}</p>
      <h2 className="eoc-visually-hidden">Staffing</h2>
      <p>Who is checked in to which position, where the gaps are, and who is scheduled next. Times are local, 24-hour.</p>
    </header>
    <Tabs id="staffing-view" label="Staffing view" value={view} onChange={(next) => setView(next as View)} tabs={VIEWS} />
    {notice ? <p className="eoc-staffing-notice" role="status">{notice}</p> : null}
    {error ? <p className="eoc-staffing-notice is-error" role="alert">{error}</p> : null}
    {VIEWS.map(({ id }) => <section key={id} className="eoc-staffing-panel" role="tabpanel" id={`staffing-view-${id}-panel`}
      aria-labelledby={`staffing-view-${id}-tab`} hidden={view !== id}>{view === id ? panels[id]() : null}</section>)}
  </section>;
}
