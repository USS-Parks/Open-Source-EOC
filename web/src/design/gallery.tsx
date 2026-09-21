import { useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { LIFELINE_STATUS } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField, Theme } from "./components.js";
import {
  AppFrame,
  BoardList,
  BoardTable,
  MapPanel,
  NotificationTray,
} from "./layout.js";
import type { ThemeName } from "./tokens.js";

/**
 * Component gallery: every design-system piece rendered together. Serves as
 * the living style reference and the fixture the a11y and keyboard tests
 * render. Run interactively with vite during development.
 */
export function Gallery(props: { theme: ThemeName }) {
  const [name, setName] = useState("");
  const [lifelineStatus, setLifelineStatus] = useState("stable");
  return (
    <Theme name={props.theme}>
      <AppFrame title={`Design gallery (${props.theme})`}>
        <Panel title="Status badges">
          <StatusBadge status="info">info</StatusBadge>{" "}
          <StatusBadge status="warning">warning</StatusBadge>{" "}
          <StatusBadge status="critical">critical</StatusBadge>{" "}
          <StatusBadge status="success">success</StatusBadge>{" "}
          <StatusBadge status="unknown">unknown</StatusBadge>
        </Panel>
        <Panel title="Controls">
          <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
            <TextField label="Point of contact" value={name} onChange={setName} />
            <EnumSelect
              label="Lifeline status"
              values={LIFELINE_STATUS.values}
              value={lifelineStatus}
              onChange={setLifelineStatus}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Button kind="primary">Save</Button>
              <Button>Cancel</Button>
              <Button kind="danger">Close incident</Button>
            </div>
          </div>
        </Panel>
        <Panel title="Boards">
          <BoardList
            boards={[
              { id: "sig", name: "Significant Events", status: "critical" },
              { id: "shelters", name: "Shelters", status: "success" },
              { id: "roads", name: "Road Closures" },
            ]}
            onOpen={() => undefined}
          />
        </Panel>
        <Panel title="Display view">
          <BoardTable
            caption="Shelter status"
            columns={["Shelter", "Occupancy", "Status"]}
            rows={[
              ["Hoopa High Gym", "112 / 150", <StatusBadge key="a" status="success">open</StatusBadge>],
              ["Weitchpec Firehouse", "0 / 40", <StatusBadge key="b" status="unknown">unknown</StatusBadge>],
            ]}
          />
        </Panel>
        <MapPanel label="Common operating picture placeholder" />
        <NotificationTray
          items={[
            { id: "1", status: "critical", text: "Road closure reported on SR-96" },
            { id: "2", status: "info", text: "Situation report 4 published" },
          ]}
        />
      </AppFrame>
    </Theme>
  );
}

type ReviewScreen = "overview" | "map" | "lifelines" | "board" | "resource" | "iap";

const REVIEW_SCREENS: readonly { id: ReviewScreen; label: string }[] = [
  { id: "overview", label: "Overview reference" },
  { id: "map", label: "Map" },
  { id: "lifelines", label: "ESFs & Lifelines" },
  { id: "board", label: "Dense board" },
  { id: "resource", label: "Resource drawer" },
  { id: "iap", label: "IAP Planning" },
];

/**
 * Composition review-only compositions. These use synthetic records and local inline
 * artwork. They do not call the application API or claim implemented behavior.
 */
export function CompositionReview() {
  const [theme, setTheme] = useState<ThemeName>("light");
  const [screen, setScreen] = useState<ReviewScreen>("map");
  const [narrow, setNarrow] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [compactNav, setCompactNav] = useState(false);

  const composition = (() => {
    switch (screen) {
      case "overview": return <OverviewReference />;
      case "map": return <MapComposition />;
      case "lifelines": return <LifelineComposition />;
      case "board": return <BoardComposition />;
      case "resource": return <ResourceComposition />;
      case "iap": return <IapComposition />;
    }
  })();

  return (
    <Theme name={theme}>
      <style>{COMPOSITION_REVIEW_STYLES}</style>
      <div className="composition-review" data-review-theme={theme}>
        <header className="composition-reviewbar">
          <div>
            <strong>Composition review</strong>
            <span> Synthetic data. Review controls only.</span>
          </div>
          <div className="composition-review-controls" aria-label="Composition controls">
            <label>
              Screen
              <select value={screen} onChange={(event) => setScreen(event.target.value as ReviewScreen)}>
                {REVIEW_SCREENS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <button type="button" aria-pressed={theme === "dark"} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "Use light theme" : "Use dark theme"}
            </button>
            <button type="button" aria-pressed={narrow} onClick={() => setNarrow(!narrow)}>
              {narrow ? "Use wide canvas" : "Preview 390 px"}
            </button>
          </div>
        </header>
        <div className="composition-stage" style={{ maxWidth: narrow ? 390 : undefined }} data-width={narrow ? "narrow" : "wide"}>
          <ReviewShell
            active={screen === "overview" ? "Overview" : screen === "lifelines" ? "ESFs & Lifelines" : screen === "board" ? "Boards" : screen === "resource" ? "Resources" : screen === "iap" ? "IAP" : "Map"}
            navOpen={navOpen}
            onToggleNav={() => setNavOpen(!navOpen)}
            compactNav={compactNav}
            onToggleCompactNav={() => setCompactNav(!compactNav)}
          >
            {composition}
          </ReviewShell>
        </div>
      </div>
    </Theme>
  );
}

export function mountCompositionReview(element: Element) {
  createRoot(element).render(<CompositionReview />);
}

const NAV_GROUPS = [
  { name: "Situation", items: ["Overview", "Map", "ESFs & Lifelines", "SITREP"] },
  { name: "Operations", items: ["Boards", "Resources", "Tasks", "Field Reports", "Smart Forms", "Tracking"] },
  { name: "Planning", items: ["Operational Periods", "ICS Forms", "IAP", "AAR"] },
  { name: "Coordination", items: ["Participants", "Messages", "JIC", "Files"] },
  { name: "Data and administration", items: ["Incident Setup", "Datasets", "Feeds", "Templates", "Settings"] },
] as const;

function ReviewShell(props: {
  active: string;
  navOpen: boolean;
  onToggleNav: () => void;
  compactNav: boolean;
  onToggleCompactNav: () => void;
  children: ReactNode;
}) {
  return (
    <div className="composition-shell">
      <a className="composition-skip" href="#composition-workspace">Skip to composition</a>
      <header className="composition-command">
        <button className="composition-nav-toggle" type="button" aria-controls="composition-navigation" aria-expanded={props.navOpen} onClick={props.onToggleNav}>
          All sections
        </button>
        <div className="composition-brand"><ReviewIcon name="mark" /><span>Open Source EOC</span></div>
        <div className="composition-context"><strong>North Coast Storm</strong><span>Exercise</span></div>
        <div className="composition-command-item"><strong>OP 03</strong><span>0600-1800 PDT</span></div>
        <div className="composition-command-item"><strong>Planning Section</strong><span>Acting position</span></div>
        <div className="composition-sync"><span aria-hidden="true" /> Synced 09:42</div>
        <span className="composition-handling" aria-label="Handling marking: FOUO">FOUO</span>
        <button className="composition-command-button" type="button" aria-label="Notifications, 3 unread">3 notifications</button>
        <div className="composition-account">Jordan Lee</div>
      </header>
      <div className={`composition-shell-body ${props.compactNav ? "has-compact-rail" : ""}`}>
        <nav id="composition-navigation" className={`composition-rail ${props.navOpen ? "is-open" : ""} ${props.compactNav ? "is-compact" : ""}`} aria-label="Sections">
          <button className="composition-rail-toggle" type="button" aria-pressed={props.compactNav} onClick={props.onToggleCompactNav}>
            {props.compactNav ? "Expand navigation" : "Compact navigation"}
          </button>
          {NAV_GROUPS.map((group) => (
            <section key={group.name} aria-labelledby={`composition-${group.name.replaceAll(" ", "-")}`}>
              <h2 id={`composition-${group.name.replaceAll(" ", "-")}`}>{group.name}</h2>
              {group.items.map((item) => (
                <button key={item} type="button" aria-current={item === props.active ? "page" : undefined}>
                  <ReviewIcon name={navIcon(item)} /> <span>{item}</span>
                </button>
              ))}
            </section>
          ))}
        </nav>
        <main id="composition-workspace" className="composition-workspace">
          {props.children}
          <footer className="composition-footer">DESIGN REVIEW · SYNTHETIC DATA · NOT DELIVERED UI</footer>
        </main>
      </div>
    </div>
  );
}

function navIcon(item: string) {
  if (item === "Map") return "map";
  if (item === "ESFs & Lifelines") return "network";
  if (item === "Resources") return "box";
  if (item === "IAP" || item === "ICS Forms") return "document";
  if (item === "Boards" || item === "Overview") return "grid";
  return "circle";
}

function ReviewIcon(props: { name: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  let content: ReactNode;
  switch (props.name) {
    case "mark": content = <><circle cx="12" cy="12" r="8" {...common} /><path d="M12 1v6m0 10v6M1 12h6m10 0h6" {...common} /><circle cx="12" cy="12" r="2.5" {...common} /></>; break;
    case "map": content = <path d="m3 5 5-2 8 3 5-2v15l-5 2-8-3-5 2V5Zm5-2v15m8-12v15" {...common} />; break;
    case "network": content = <><circle cx="12" cy="5" r="2" {...common} /><circle cx="5" cy="18" r="2" {...common} /><circle cx="19" cy="18" r="2" {...common} /><path d="m11 7-5 9m7-9 5 9M7 18h10" {...common} /></>; break;
    case "box": content = <><path d="m4 8 8-4 8 4-8 4-8-4Zm0 0v9l8 4 8-4V8M12 12v9" {...common} /></>; break;
    case "document": content = <><path d="M6 3h8l4 4v14H6V3Z" {...common} /><path d="M14 3v5h4M9 12h6m-6 4h6" {...common} /></>; break;
    case "grid": content = <><rect x="3" y="3" width="7" height="7" rx="1" {...common} /><rect x="14" y="3" width="7" height="7" rx="1" {...common} /><rect x="3" y="14" width="7" height="7" rx="1" {...common} /><rect x="14" y="14" width="7" height="7" rx="1" {...common} /></>; break;
    default: content = <circle cx="12" cy="12" r="7" {...common} />;
  }
  return <svg className="composition-icon" viewBox="0 0 24 24" aria-hidden="true">{content}</svg>;
}

function PageHeader(props: { eyebrow: string; title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <header className="composition-page-header">
      <div><span className="composition-eyebrow">{props.eyebrow}</span><h1>{props.title}</h1><p>{props.subtitle}</p></div>
      {props.actions ? <div className="composition-actions">{props.actions}</div> : null}
    </header>
  );
}

function ConditionBadge(props: { condition: "stable" | "stabilizing" | "disrupted" | "unknown"; children?: ReactNode }) {
  return <span className={`composition-condition is-${props.condition}`}><span aria-hidden="true" />{props.children ?? props.condition}</span>;
}

function StateText(props: { state: "current" | "stale" | "unavailable" | "zero"; children: ReactNode }) {
  return <span className={`composition-state is-${props.state}`}><span aria-hidden="true" />{props.children}</span>;
}

function OverviewReference() {
  return (
    <div className="composition-page">
      <div className="composition-overview-wide">
        <PageHeader eyebrow="Situation / Overview" title="Overview uses the supplied concepts" subtitle="Complete light and dark references are inventoried rather than rebuilt in this coded gallery." />
        <section className="composition-reference-grid" aria-label="Supplied Overview references">
          <article className="composition-reference-card">
            <div className="composition-reference-thumb is-light"><span>LIGHT</span><strong>Incident overview</strong><small>Map · Lifelines · Priority work</small></div>
            <h2>Light Overview</h2>
            <p><code>ChatGPT Image Sep 21, 2026, 06_10_07 AM.png</code></p>
            <p>Warm neutral canvas, navy shell, compact KPI row, large COP, eight Lifeline rows, priority work, and recent activity.</p>
          </article>
          <article className="composition-reference-card">
            <div className="composition-reference-thumb is-dark"><span>DARK</span><strong>Incident overview</strong><small>Map · Lifelines · Priority work</small></div>
            <h2>Dark Overview</h2>
            <p><code>ChatGPT Image Sep 21, 2026, 06_10_22 AM.png</code></p>
            <p>Same information architecture and records in layered slate surfaces with restrained borders and readable semantic conditions.</p>
          </article>
        </section>
        <section className="composition-review-note">
          <strong>Navigation reference note</strong>
          <p>The supplied images predate D02. Their standalone Help footer is omitted. All five groups remain discoverable through the rail and All sections control.</p>
        </section>
      </div>
      <section className="composition-narrow-overview" aria-label="Narrow Incident overview proposal">
        <PageHeader eyebrow="Situation / Overview" title="Incident overview" subtitle="North Coast Storm · OP 03 · Updated 09:42 PDT" />
        <div className="composition-kpi-row">
          <article><span>Open requests</span><strong>24</strong><small>6 urgent</small></article>
          <article><span>Active shelters</span><strong>8</strong><small>312 occupants</small></article>
          <article><span>Field reports</span><strong>46</strong><small>9 unverified</small></article>
          <article><span>Tasks due</span><strong>12</strong><small>This period</small></article>
        </div>
        <article className="composition-narrow-map-summary">
          <div><span className="composition-eyebrow">Common operating picture</span><h2>3 closures · 8 shelters</h2><p>Exercise extent centered on Eureka and Humboldt Bay.</p></div>
          <button type="button">Open Map</button>
        </article>
        <section className="composition-narrow-lifelines"><h2>Community Lifelines</h2><div><span>Energy</span><ConditionBadge condition="disrupted">Disrupted</ConditionBadge></div><div><span>Transportation</span><ConditionBadge condition="disrupted">Disrupted</ConditionBadge></div><div><span>Hazardous Materials</span><ConditionBadge condition="unknown">Unknown</ConditionBadge></div><button type="button">Open all eight Lifelines</button></section>
        <section className="composition-narrow-priority"><h2>Priority work</h2><article><strong>Generator support</strong><span>Logistics · Due 12:00</span><StatusBadge status="critical">Urgent</StatusBadge></article><article><strong>CA-255 access check</strong><span>Humboldt County · Due 14:00</span><StatusBadge status="warning">In progress</StatusBadge></article></section>
      </section>
    </div>
  );
}

function MapComposition() {
  return (
    <div className="composition-page">
      <PageHeader
        eyebrow="Situation / Map"
        title="Common operating picture"
        subtitle="North Coast Storm · OP 03 · Updated 09:42 PDT"
        actions={<><button type="button" className="composition-secondary">Saved view: Planning</button><button type="button" className="composition-primary">Add field report</button></>}
      />
      <div className="composition-map-layout">
        <aside className="composition-layer-panel" aria-label="Map layers">
          <h2>Layers</h2>
          <label><input type="checkbox" defaultChecked /> Incident boundary</label>
          <label><input type="checkbox" defaultChecked /> Road closures <StateText state="current">current</StateText></label>
          <label><input type="checkbox" defaultChecked /> Shelters <StateText state="current">8 open</StateText></label>
          <label><input type="checkbox" defaultChecked /> Field reports <StateText state="zero">0 verified</StateText></label>
          <label><input type="checkbox" /> Flood sensor <StateText state="stale">stale 18m</StateText></label>
          <label><input type="checkbox" disabled /> Parcel exposure <StateText state="unavailable">unavailable</StateText></label>
          <div className="composition-map-legend"><strong>Legend</strong><span><i className="boundary" /> Exercise extent</span><span><i className="closure" /> Closed road</span><span><i className="facility" /> Facility</span></div>
        </aside>
        <MockMap />
        <aside className="composition-drawer" aria-label="Selected field report">
          <div className="composition-drawer-heading"><div><span className="composition-eyebrow">Field report · FR-2048</span><h2>Culvert washout</h2></div><button type="button" aria-label="Close selected field report">×</button></div>
          <StateText state="current">Received 09:37 PDT</StateText>
          <dl className="composition-detail-list"><div><dt>Location</dt><dd>Bald Hills Road, mile 6.2</dd></div><div><dt>Source</dt><dd>Taylor Kim · Field observer</dd></div><div><dt>Category</dt><dd>Damage</dd></div><div><dt>Confidence</dt><dd>Photo and coordinates supplied</dd></div></dl>
          <p className="composition-callout"><strong>Observed impact</strong> One travel lane undermined. Geographic exposure alone does not set a Lifeline condition.</p>
          <div className="composition-related"><strong>Related work</strong><button type="button">TASK-204 · Inspect crossing</button><button type="button">REQ-1027 · Traffic control</button></div>
        </aside>
      </div>
    </div>
  );
}

function MockMap() {
  return (
    <figure className="composition-map" aria-label="Synthetic North Coast incident map proposal">
      <svg viewBox="0 0 820 620" role="img" aria-labelledby="composition-map-title composition-map-description">
        <title id="composition-map-title">North Coast Storm exercise map</title>
        <desc id="composition-map-description">Synthetic review artwork showing an incident boundary, roads, shelters, closures, facilities, and a selected field report.</desc>
        <rect width="820" height="620" className="water" />
        <path d="M250 0 310 70 295 120 345 160 320 210 370 260 350 325 390 380 360 440 420 510 405 620H820V0Z" className="land" />
        <path d="M300 18 330 82 315 130 360 172 338 224 386 272 365 333 404 390 379 446 439 520 425 610" className="coast" />
        <path d="M342 40 400 112 388 188 445 248 430 325 490 390 472 480 540 580M325 156 470 145 620 210 770 185M360 300 510 280 680 345 810 330M390 445 540 430 700 500" className="road" />
        <path d="M305 86 414 58 548 90 660 170 700 290 663 420 570 535 430 560 340 470 294 340 278 205Z" className="extent" />
        <path d="M386 272 430 325 472 370" className="closed-road" />
        <g className="marker shelter"><circle cx="430" cy="205" r="13" /><path d="m422 205 8-7 8 7v9h-16Z" /></g>
        <g className="marker shelter"><circle cx="555" cy="410" r="13" /><path d="m547 410 8-7 8 7v9h-16Z" /></g>
        <g className="marker facility"><circle cx="520" cy="270" r="14" /><path d="M520 262v16m-8-8h16" /></g>
        <g className="marker closure"><circle cx="410" cy="298" r="13" /><path d="M402 298h16" /></g>
        <g className="marker report"><circle cx="472" cy="370" r="17" /><path d="m472 358 4 9 10 1-8 6 3 10-9-5-9 5 3-10-8-6 10-1Z" /></g>
        <text x="440" y="248">Eureka</text><text x="382" y="125">Trinidad</text><text x="505" y="475">Fortuna</text>
      </svg>
      <figcaption>Review-only inline map artwork. Symbols are generic proposals and are not represented as NAPSG symbols.</figcaption>
      <div className="composition-map-tools"><button type="button">Search</button><button type="button">Measure</button><button type="button">Coordinate entry</button></div>
    </figure>
  );
}

const LIFELINES = [
  { name: "Safety & Security", condition: "stable", summary: "Patrol coverage maintained", source: "CA OES · Law Enforcement", time: "09:20" },
  { name: "Food, Hydration, Shelter", condition: "stabilizing", summary: "8 shelters supporting 312 people", source: "CA OES · Human Services", time: "09:15" },
  { name: "Health & Medical", condition: "stable", summary: "Emergency services available", source: "CA Dept. of Public Health", time: "09:25" },
  { name: "Energy", condition: "disrupted", summary: "Two substations offline", source: "CA Energy Commission", time: "09:35" },
  { name: "Communications", condition: "stabilizing", summary: "Backup links in use", source: "Cal OES · Communications", time: "09:28" },
  { name: "Transportation", condition: "disrupted", summary: "Three access routes closed", source: "Caltrans", time: "09:18" },
  { name: "Hazardous Materials", condition: "unknown", summary: "Assessment pending", source: "Cal EPA · HMD", time: "09:18" },
  { name: "Water Systems", condition: "stabilizing", summary: "Treatment on backup power", source: "State Water Resources Control Board", time: "09:22" },
] as const;

function LifelineComposition() {
  return (
    <div className="composition-page">
      <PageHeader
        eyebrow="Situation / ESFs & Lifelines"
        title="ESFs & Lifelines"
        subtitle="Essential service conditions and coordinated response · OP 03"
        actions={<><button type="button" className="composition-secondary">Compare periods</button><button type="button" className="composition-primary">New assessment</button></>}
      />
      <nav className="composition-tabs" aria-label="ESF and Lifeline views"><button type="button" aria-current="page">Community Lifelines</button><button type="button">ESF coordination</button><button type="button">Dependencies</button><button type="button">Assessment history</button></nav>
      <div className="composition-filterbar"><label>Incident area<select defaultValue="all"><option value="all">Entire incident area</option></select></label><label>Period<select defaultValue="op3"><option value="op3">OP 03 · 0600-1800</option></select></label><label>Condition<select defaultValue="all"><option value="all">All conditions</option></select></label><StateText state="current">Assessed through 09:35 PDT</StateText></div>
      <div className="composition-lifeline-layout">
        <div>
          <section className="composition-lifeline-grid" aria-label="Community Lifeline conditions">
            {LIFELINES.map((item) => (
              <article key={item.name} className={`composition-lifeline-card ${item.name === "Energy" ? "is-selected" : ""}`}>
                <div className="composition-lifeline-title"><ReviewIcon name={item.name === "Energy" ? "network" : "circle"} /><h2>{item.name}</h2></div>
                <ConditionBadge condition={item.condition}>{item.condition[0]!.toUpperCase() + item.condition.slice(1)}</ConditionBadge>
                <p>{item.summary}</p>
                <dl><div><dt>Source</dt><dd>{item.source}</dd></div><div><dt>Assessed</dt><dd>{item.time} PDT</dd></div></dl>
              </article>
            ))}
          </section>
          <section className="composition-esf-table">
            <div><h2>Related ESF coordination</h2><span>California framework · activation is not condition</span></div>
            <div className="composition-board-scroll"><table><thead><tr><th scope="col">Function</th><th scope="col">Activation</th><th scope="col">Coordinator</th><th scope="col">Open missions</th></tr></thead><tbody><tr><td>CA ESF 12 · Utilities</td><td><span className="composition-neutral-chip">Active</span></td><td>Utility liaison</td><td>4</td></tr><tr><td>CA ESF 1 · Transportation</td><td><span className="composition-neutral-chip">Active</span></td><td>Transport liaison</td><td>3</td></tr><tr><td>CA ESF 8 · Public Health</td><td><span className="composition-neutral-chip is-muted">Unactivated</span></td><td>Not assigned</td><td>0</td></tr></tbody></table></div>
          </section>
        </div>
        <aside className="composition-drawer" aria-label="Energy Lifeline detail">
          <div className="composition-drawer-heading"><div><span className="composition-eyebrow">Community Lifeline</span><h2>Energy</h2></div><button type="button" aria-label="Close Energy detail">×</button></div>
          <ConditionBadge condition="disrupted">Disrupted</ConditionBadge>
          <p className="composition-meta">Assessed 09:35 PDT · Utility liaison</p>
          <p className="composition-impact">Two substations offline. Backup generation supports priority facilities.</p>
          <dl className="composition-detail-list"><div><dt>Affected components</dt><dd>Electricity · Fuel</dd></div><div><dt>Stabilization objective</dt><dd>Restore power to critical facilities</dd></div><div><dt>Next update</dt><dd>10:30 PDT</dd></div><div><dt>Evidence</dt><dd>Utility incident report · qualified</dd></div></dl>
          <div className="composition-related"><strong>Linked actions (2)</strong><button type="button">Generator request <span>In progress</span></button><button type="button">Inspect substation <span>Assigned</span></button></div>
          <p className="composition-callout"><strong>Exposure note</strong> Facilities inside the exercise extent are not automatically marked disrupted.</p>
          <button type="button" className="composition-primary composition-block">Update assessment</button>
        </aside>
      </div>
    </div>
  );
}

function BoardComposition() {
  const [showNarrowDetail, setShowNarrowDetail] = useState(false);
  const rows: readonly (readonly ReactNode[])[] = [
    [<strong key="a">REQ-1042</strong>, "Generator support for Wendy's Shelter", "Logistics", <StatusBadge key="s" status="critical">Urgent</StatusBadge>, "Today 12:00", <StateText key="f" state="current">Updated 09:36</StateText>],
    [<strong key="a">REQ-1037</strong>, "Check access on CA-255", "Humboldt County", <StatusBadge key="s" status="warning">In progress</StatusBadge>, "Today 14:00", <StateText key="f" state="stale">Stale 22m</StateText>],
    [<strong key="a">REQ-1048</strong>, "Deliver additional shelter supplies", "American Red Cross", <StatusBadge key="s" status="unknown">Not started</StatusBadge>, "Today 18:00", <StateText key="f" state="current">Updated 09:31</StateText>],
    [<strong key="a">REQ-1051</strong>, "Portable lighting for staging", "Unassigned", <StatusBadge key="s" status="info">Triaged</StatusBadge>, "Tomorrow 08:00", <StateText key="f" state="unavailable">ETA unavailable</StateText>],
    [<strong key="a">REQ-1054</strong>, "Traffic cones for Fieldbrook", "Caltrans", <StatusBadge key="s" status="success">Filled</StatusBadge>, "Complete", <StateText key="f" state="zero">0 open actions</StateText>],
  ];
  return (
    <div className="composition-page">
      <PageHeader eyebrow="Operations / Boards" title="Resource requests" subtitle="48 records · Incident scope · Saved view: Priority work" actions={<><button type="button" className="composition-secondary">Columns</button><button type="button" className="composition-primary">New request</button></>} />
      <div className="composition-filterbar composition-board-filters"><label>Search<input type="search" placeholder="ID, item, owner" /></label><label>Status<select defaultValue="open"><option value="open">Open lifecycle states</option></select></label><label>Priority<select defaultValue="all"><option value="all">All priorities</option></select></label><label>Due<select defaultValue="period"><option value="period">This operational period</option></select></label></div>
      <button className="composition-narrow-detail-toggle" type="button" aria-pressed={showNarrowDetail} onClick={() => setShowNarrowDetail(!showNarrowDetail)}>
        {showNarrowDetail ? "Back to request list" : "Preview selected request"}
      </button>
      <div className={`composition-board-layout ${showNarrowDetail ? "show-detail" : ""}`}>
        <section className="composition-board-panel" aria-label="Resource request board">
          <div className="composition-table-summary"><span><strong>5</strong> shown</span><span><strong>2</strong> selected</span><span>Sorted by due time</span><button type="button">Save view</button></div>
          <div className="composition-board-scroll"><BoardTable caption="Priority resource requests" columns={["ID", "Request", "Owner", "Status", "Due (PDT)", "Freshness"]} rows={rows} /></div>
          <div className="composition-table-footer"><span>Showing 1-5 of 48</span><button type="button">Previous</button><button type="button">Next</button></div>
        </section>
        <aside className="composition-drawer" aria-label="Selected resource request">
          <div className="composition-drawer-heading"><div><span className="composition-eyebrow">REQ-1042</span><h2>Generator support</h2></div><button type="button" aria-label="Close resource detail">×</button></div>
          <StatusBadge status="critical">Urgent · In progress</StatusBadge>
          <dl className="composition-detail-list"><div><dt>Requesting organization</dt><dd>Wendy's Shelter</dd></div><div><dt>Owner</dt><dd>Logistics · M. Alvarez</dd></div><div><dt>Due</dt><dd>Today 12:00 PDT</dd></div><div><dt>Next action</dt><dd>Confirm delivery window</dd></div></dl>
          <div className="composition-related"><strong>Related</strong><button type="button">Map · Wendy's Shelter</button><button type="button">TASK-211 · Delivery coordination</button><button type="button">2 attachments</button></div>
          <button type="button" className="composition-primary composition-block">Advance request</button>
        </aside>
      </div>
    </div>
  );
}

function ResourceComposition() {
  const [item, setItem] = useState("Sandbags");
  const [quantity, setQuantity] = useState("500");
  const [priority, setPriority] = useState("immediate");
  return (
    <div className="composition-page">
      <PageHeader eyebrow="Operations / Resources" title="Resource coordination" subtitle="Requests, assignments, supplying organizations, and disposition" actions={<button type="button" className="composition-secondary">View board</button>} />
      <div className="composition-resource-layout">
        <section className="composition-resource-backdrop" aria-label="Resource request context">
          <div className="composition-kpi-row"><article><span>Open</span><strong>24</strong><small>6 urgent</small></article><article><span>Triaged</span><strong>9</strong><small>3 awaiting owner</small></article><article><span>Filled</span><strong>18</strong><small>This period</small></article></div>
          <h2>Priority queue</h2>
          <div className="composition-queue-row"><span>REQ-1042</span><strong>Generator support</strong><StatusBadge status="critical">Urgent</StatusBadge></div>
          <div className="composition-queue-row"><span>REQ-1037</span><strong>CA-255 access check</strong><StatusBadge status="warning">In progress</StatusBadge></div>
          <div className="composition-queue-row"><span>REQ-1048</span><strong>Shelter supplies</strong><StatusBadge status="unknown">Not started</StatusBadge></div>
        </section>
        <aside className="composition-form-drawer" aria-label="New resource request form">
          <div className="composition-drawer-heading"><div><span className="composition-eyebrow">New resource request</span><h2>Request details</h2></div><button type="button" aria-label="Close new resource request">×</button></div>
          <StateText state="current">Draft retained locally · 09:41 PDT</StateText>
          <form onSubmit={(event) => event.preventDefault()}>
            <TextField label="Item or service" value={item} onChange={setItem} required />
            <TextField label="Quantity" value={quantity} onChange={setQuantity} required />
            <EnumSelect label="Priority" values={["routine", "urgent", "immediate"]} value={priority} onChange={setPriority} labels={{ routine: "Routine", urgent: "Urgent", immediate: "Immediate" }} />
            <label className="composition-field">Needed by<input type="datetime-local" defaultValue="2026-09-21T12:00" /></label>
            <label className="composition-field">Delivery location<select defaultValue="staging"><option value="staging">Eureka staging area</option></select></label>
            <label className="composition-field">Operational need<textarea defaultValue="Protect the Highway 101 access route before the next rain band." /></label>
            <fieldset><legend>Supporting context</legend><label><input type="checkbox" defaultChecked /> Link TASK-204 route protection</label><label><input type="checkbox" /> Add map location</label></fieldset>
            <p className="composition-callout"><strong>Review-only control</strong> Submit does not write data or establish authorization.</p>
            <div className="composition-form-actions"><Button>Save draft</Button><Button kind="primary" type="submit">Review request</Button></div>
          </form>
        </aside>
      </div>
    </div>
  );
}

function IapComposition() {
  const forms = [
    { id: "ICS 201", name: "Incident briefing", state: "Complete", status: "success" },
    { id: "ICS 202", name: "Incident objectives", state: "In review", status: "info" },
    { id: "ICS 203", name: "Organization assignment list", state: "Complete", status: "success" },
    { id: "ICS 204", name: "Assignment list", state: "Working", status: "warning" },
    { id: "ICS 205", name: "Communications plan", state: "Not started", status: "unknown" },
    { id: "ICS 206", name: "Medical plan", state: "Complete", status: "success" },
    { id: "Map", name: "Incident map", state: "Stale source", status: "critical" },
  ] as const;
  return (
    <div className="composition-page">
      <PageHeader
        eyebrow="Planning / IAP"
        title="Incident Action Plan"
        subtitle="OP 03 · Working revision 4 · Prepared by Planning Section"
        actions={<><button type="button" className="composition-secondary">Preview packet</button><button type="button" className="composition-primary">Submit for approval</button></>}
      />
      <div className="composition-iap-status"><StateText state="current">Draft saved 09:41 PDT</StateText><span><strong>6 of 7</strong> required items ready</span><span>Revision 4 has not been published</span></div>
      <div className="composition-planning-layout">
        <aside className="composition-plan-outline" aria-label="IAP outline">
          <h2>Packet outline</h2>
          {forms.map((form, index) => <button key={form.id} type="button" aria-current={form.id === "ICS 204" ? "step" : undefined}><span>{index + 1}</span><span><strong>{form.id}</strong><small>{form.name}</small></span><StatusBadge status={form.status}>{form.state}</StatusBadge></button>)}
        </aside>
        <article className="composition-editor" aria-label="ICS 204 assignment editor">
          <header><div><span className="composition-eyebrow">ICS 204 · Assignment list</span><h2>Road access group</h2></div><ConditionBadge condition="stabilizing">Working</ConditionBadge></header>
          <div className="composition-editor-grid"><div><span>Branch</span><strong>Infrastructure</strong></div><div><span>Supervisor</span><strong>D. Nguyen</strong></div><div><span>Period</span><strong>OP 03</strong></div><div><span>Last edit</span><strong>J. Carter · 09:41</strong></div></div>
          <section><h3>Operational objective</h3><p>Maintain one emergency access route between Eureka and Trinidad through 1800 PDT.</p></section>
          <section><h3>Assignments</h3><ol><li><strong>Inspect Maple Creek crossing</strong><span>Caltrans District 1 · Due 11:00</span></li><li><strong>Stage traffic control at Fieldbrook</strong><span>Roads Division · Due 11:30</span></li><li><strong>Report closure changes to Planning</strong><span>Field observer · Every 30 minutes</span></li></ol></section>
          <section className="composition-source-panel"><h3>Source records</h3><div><StateText state="current">TASK-204 current</StateText><span>Route assessment</span></div><div><StateText state="stale">Map source stale 18m</StateText><span>Refresh before approval</span></div><div><StateText state="unavailable">Weather feed unavailable</StateText><span>Last good value retained and labeled</span></div></section>
          <div className="composition-editor-actions"><button type="button" className="composition-secondary">Save working revision</button><button type="button" className="composition-primary">Mark ready for review</button></div>
        </article>
        <aside className="composition-drawer" aria-label="IAP review context">
          <div className="composition-drawer-heading"><div><span className="composition-eyebrow">Review context</span><h2>Readiness</h2></div><button type="button" aria-label="Close review context">×</button></div>
          <div className="composition-readiness"><strong>86%</strong><span>6 of 7 ready</span><progress max="7" value="6">6 of 7</progress></div>
          <dl className="composition-detail-list"><div><dt>Working revision</dt><dd>4 · editable</dd></div><div><dt>Approved revision</dt><dd>3 · read only</dd></div><div><dt>Approval chain</dt><dd>Planning Chief → Incident Commander</dd></div><div><dt>Blocking issue</dt><dd>Incident map source is stale</dd></div></dl>
          <div className="composition-related"><strong>History</strong><button type="button">09:41 · Assignment updated · J. Carter</button><button type="button">09:32 · Objective approved · A. Rivera</button></div>
          <p className="composition-callout"><strong>Protected work</strong> Navigation preserves this working revision. Publishing is a separate, explicit action.</p>
        </aside>
      </div>
    </div>
  );
}

const COMPOSITION_REVIEW_STYLES = String.raw`
.composition-review {
  --composition-shell: #0b2a45;
  --composition-shell-raised: #123b5e;
  --composition-shell-text: #f5fbff;
  --composition-accent: #07889b;
  --composition-accent-soft: #d9f1f3;
  --composition-map-water: #b8dce9;
  --composition-map-land: #d9e2d0;
  min-height: 100vh;
  background: var(--eoc-bg);
  color: var(--eoc-text);
  font: 14px/1.4 var(--eoc-font);
}
.composition-review[data-review-theme="dark"] {
  --composition-shell: #071a2c;
  --composition-shell-raised: #0e304c;
  --composition-accent: #25b7c6;
  --composition-accent-soft: #123844;
  --composition-map-water: #102f46;
  --composition-map-land: #24382f;
}
.composition-review * { box-sizing: border-box; }
.composition-review button, .composition-review input, .composition-review select, .composition-review textarea { font: inherit; }
.composition-review button:focus-visible, .composition-review input:focus-visible, .composition-review select:focus-visible, .composition-review textarea:focus-visible, .composition-review a:focus-visible { outline: 3px solid var(--eoc-focus); outline-offset: 2px; }
.composition-reviewbar { min-height: 62px; padding: 10px 16px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; background: var(--eoc-surface); border-bottom: 1px solid var(--eoc-border); }
.composition-reviewbar span { color: var(--eoc-text-muted); }
.composition-review-controls { display: flex; align-items: end; gap: 8px; flex-wrap: wrap; }
.composition-review-controls label { display: grid; gap: 2px; color: var(--eoc-text-muted); font-size: 12px; }
.composition-review-controls select, .composition-review-controls button, .composition-secondary, .composition-primary { min-height: 40px; border: 1px solid var(--eoc-border); border-radius: 5px; padding: 7px 12px; background: var(--eoc-surface); color: var(--eoc-text); cursor: pointer; }
.composition-primary { background: var(--composition-accent); border-color: var(--composition-accent); color: #fff; font-weight: 700; }
.composition-block { width: 100%; margin-top: 16px; }
.composition-stage { container-type: inline-size; width: 100%; margin: 0 auto; background: var(--eoc-bg); box-shadow: var(--eoc-shadow-lg); }
.composition-shell { min-height: 838px; background: var(--eoc-bg); overflow: hidden; }
.composition-skip { position: fixed; left: -9999px; top: 8px; z-index: 100; padding: 8px; color: var(--eoc-text); background: var(--eoc-surface); }
.composition-skip:focus { left: 8px; }
.composition-command { min-height: 64px; padding: 8px 14px; display: grid; grid-template-columns: minmax(180px, 1.1fr) minmax(170px, 1fr) auto auto auto auto auto auto; gap: 12px; align-items: center; color: var(--composition-shell-text); background: var(--composition-shell); border-bottom: 1px solid rgba(255,255,255,.18); }
.composition-brand, .composition-context, .composition-command-item { display: flex; align-items: center; gap: 7px; min-width: 0; }
.composition-brand { font-size: 16px; font-weight: 800; letter-spacing: .01em; }
.composition-brand .composition-icon { width: 28px; height: 28px; color: #67e8f9; }
.composition-context, .composition-command-item { padding-left: 12px; border-left: 1px solid rgba(255,255,255,.2); }
.composition-context span, .composition-command-item span { color: #bdd0df; font-size: 11px; }
.composition-command-item { display: grid; gap: 0; }
.composition-sync { white-space: nowrap; }
.composition-sync > span { display: inline-block; width: 9px; height: 9px; margin-right: 5px; border-radius: 50%; background: #4ade80; }
.composition-handling { padding: 3px 7px; color: #ffd7d7; border: 1px solid #ff8d8d; border-radius: 3px; font-size: 11px; font-weight: 800; letter-spacing: .08em; }
.composition-command-button { min-height: 38px; color: var(--composition-shell-text); background: transparent; border: 1px solid rgba(255,255,255,.35); border-radius: 5px; padding: 5px 9px; }
.composition-account { white-space: nowrap; }
.composition-nav-toggle { display: none; min-height: 40px; color: var(--composition-shell-text); background: transparent; border: 1px solid rgba(255,255,255,.35); border-radius: 5px; }
.composition-shell-body { display: grid; grid-template-columns: 218px minmax(0, 1fr); min-height: 774px; }
.composition-shell-body.has-compact-rail { grid-template-columns: 64px minmax(0, 1fr); }
.composition-rail { padding: 10px 8px 20px; overflow: auto; color: var(--composition-shell-text); background: var(--composition-shell); }
.composition-rail-toggle { width: 100%; min-height: 38px; margin-bottom: 9px; padding: 5px; color: var(--composition-shell-text); background: transparent; border: 1px solid rgba(255,255,255,.3); border-radius: 4px; cursor: pointer; }
.composition-rail.is-compact h2, .composition-rail.is-compact button:not(.composition-rail-toggle) > span { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.composition-rail.is-compact button:not(.composition-rail-toggle) { justify-content: center; padding-inline: 5px; }
.composition-rail.is-compact .composition-rail-toggle { font-size: 0; }
.composition-rail.is-compact .composition-rail-toggle::after { content: "›"; font-size: 24px; line-height: 1; }
.composition-rail section + section { margin-top: 13px; }
.composition-rail h2 { margin: 0 10px 4px; color: #9fc2d9; font-size: 10px; letter-spacing: .11em; text-transform: uppercase; }
.composition-rail button { width: 100%; min-height: 38px; padding: 7px 9px; display: flex; align-items: center; gap: 9px; text-align: left; color: inherit; background: transparent; border: 0; border-left: 3px solid transparent; border-radius: 3px; cursor: pointer; }
.composition-rail button[aria-current] { background: var(--composition-shell-raised); border-left-color: #34d5e4; font-weight: 700; }
.composition-icon { width: 20px; height: 20px; flex: none; }
.composition-workspace { min-width: 0; display: flex; flex-direction: column; overflow: auto; }
.composition-page { flex: 1; padding: 18px; }
.composition-footer { padding: 7px 18px; color: var(--eoc-text-muted); border-top: 1px solid var(--eoc-border); font-size: 10px; letter-spacing: .08em; }
.composition-page-header { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.composition-page-header h1 { margin: 1px 0; font-size: clamp(22px, 2vw, 30px); letter-spacing: -.025em; }
.composition-page-header p { margin: 0; color: var(--eoc-text-muted); }
.composition-eyebrow { color: var(--composition-accent); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.composition-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.composition-reference-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.composition-reference-card, .composition-review-note, .composition-board-panel, .composition-resource-backdrop, .composition-editor, .composition-plan-outline, .composition-esf-table { padding: 14px; background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 7px; box-shadow: var(--eoc-shadow-sm); }
.composition-reference-card h2 { margin-bottom: 4px; }
.composition-reference-card p { color: var(--eoc-text-muted); }
.composition-reference-thumb { min-height: 230px; padding: 24px; display: flex; flex-direction: column; justify-content: center; gap: 10px; border-radius: 6px; color: #0b2740; background: #eff4f4; border: 16px solid #0b2a45; }
.composition-reference-thumb.is-dark { color: #f4f8fb; background: #17283b; border-color: #071a2c; }
.composition-reference-thumb span { align-self: start; padding: 2px 7px; border: 1px solid currentColor; border-radius: 3px; font-size: 10px; }
.composition-reference-thumb strong { font-size: 24px; }
.composition-review-note { margin-top: 16px; }
.composition-narrow-overview { display: none; }
.composition-narrow-map-summary, .composition-narrow-lifelines, .composition-narrow-priority { margin-top: 10px; padding: 12px; background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 6px; }
.composition-narrow-map-summary { min-height: 150px; display: flex; flex-direction: column; justify-content: end; background: linear-gradient(135deg, var(--composition-map-water) 0 34%, var(--composition-map-land) 34% 100%); }
.composition-narrow-map-summary p { max-width: 260px; }.composition-narrow-map-summary button, .composition-narrow-lifelines button { min-height: 40px; color: var(--composition-accent); background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 4px; }
.composition-narrow-lifelines h2, .composition-narrow-priority h2 { margin-top: 0; font-size: 16px; }
.composition-narrow-lifelines > div { min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 8px; border-top: 1px solid var(--eoc-border); }
.composition-narrow-priority article { display: grid; grid-template-columns: 1fr auto; gap: 3px 8px; padding: 9px 0; border-top: 1px solid var(--eoc-border); }.composition-narrow-priority article > span { color: var(--eoc-text-muted); font-size: 12px; }
.composition-map-layout { display: grid; grid-template-columns: 205px minmax(360px, 1fr) 310px; gap: 12px; align-items: stretch; }
.composition-layer-panel, .composition-drawer, .composition-form-drawer { min-width: 0; padding: 14px; background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 7px; box-shadow: var(--eoc-shadow-md); }
.composition-layer-panel h2, .composition-drawer h2, .composition-form-drawer h2 { margin: 0; font-size: 18px; }
.composition-layer-panel label { min-height: 38px; display: flex; align-items: center; gap: 7px; border-bottom: 1px solid var(--eoc-border); }
.composition-layer-panel input { width: 18px; height: 18px; }
.composition-map-legend { margin-top: 14px; display: grid; gap: 7px; }
.composition-map-legend span { display: flex; align-items: center; gap: 7px; }
.composition-map-legend i { width: 24px; height: 8px; display: inline-block; }
.composition-map-legend .boundary { border: 2px dashed var(--composition-accent); }
.composition-map-legend .closure { background: var(--eoc-status-critical); }
.composition-map-legend .facility { background: var(--eoc-status-success); }
.composition-map { position: relative; min-width: 0; min-height: 540px; margin: 0; overflow: hidden; background: var(--composition-map-water); border: 1px solid var(--eoc-border); border-radius: 7px; }
.composition-map svg { width: 100%; height: 100%; min-height: 500px; display: block; }
.composition-map .water { fill: var(--composition-map-water); }
.composition-map .land { fill: var(--composition-map-land); }
.composition-map .coast { fill: none; stroke: color-mix(in srgb, var(--eoc-text-muted) 65%, transparent); stroke-width: 4; }
.composition-map .road { fill: none; stroke: color-mix(in srgb, var(--eoc-text) 48%, transparent); stroke-width: 4; }
.composition-map .extent { fill: color-mix(in srgb, var(--composition-accent) 18%, transparent); stroke: var(--composition-accent); stroke-width: 4; stroke-dasharray: 11 8; }
.composition-map .closed-road { fill: none; stroke: var(--eoc-status-critical); stroke-width: 10; stroke-linecap: round; }
.composition-map text { fill: var(--eoc-text); font-weight: 700; font-size: 18px; paint-order: stroke; stroke: var(--eoc-surface); stroke-width: 4px; }
.composition-map .marker circle { fill: var(--eoc-surface); stroke-width: 5; }
.composition-map .marker path { fill: none; stroke: currentColor; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.composition-map .shelter { color: var(--eoc-status-success); }.composition-map .facility { color: var(--eoc-status-info); }.composition-map .closure { color: var(--eoc-status-critical); }.composition-map .report { color: var(--eoc-status-warning); }
.composition-map figcaption { position: absolute; left: 10px; bottom: 8px; max-width: calc(100% - 20px); padding: 4px 7px; color: var(--eoc-text); background: color-mix(in srgb, var(--eoc-surface) 88%, transparent); border-radius: 4px; font-size: 10px; }
.composition-map-tools { position: absolute; right: 10px; top: 10px; display: grid; gap: 5px; }
.composition-map-tools button { min-height: 36px; padding: 5px 8px; color: var(--eoc-text); background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 4px; }
.composition-drawer-heading { display: flex; align-items: start; justify-content: space-between; gap: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--eoc-border); }
.composition-drawer-heading button { width: 38px; height: 38px; color: var(--eoc-text); background: transparent; border: 0; font-size: 24px; }
.composition-detail-list { display: grid; gap: 0; margin: 14px 0; }
.composition-detail-list div { padding: 9px 0; border-bottom: 1px solid var(--eoc-border); }
.composition-detail-list dt { color: var(--eoc-text-muted); font-size: 11px; }
.composition-detail-list dd { margin: 2px 0 0; font-weight: 600; }
.composition-callout { padding: 10px; color: var(--eoc-text-muted); background: var(--eoc-surface-raised); border-left: 3px solid var(--eoc-status-info); }
.composition-related { display: grid; gap: 6px; margin-top: 14px; }
.composition-related button { min-height: 40px; display: flex; justify-content: space-between; gap: 8px; padding: 7px 9px; text-align: left; color: var(--eoc-text); background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 4px; }
.composition-condition { display: inline-flex; align-items: center; gap: 6px; color: var(--eoc-text); font-weight: 750; text-transform: capitalize; }
.composition-condition > span { width: 10px; height: 10px; border-radius: 50%; background: currentColor; }
.composition-condition.is-stable { color: var(--eoc-status-success); }.composition-condition.is-stabilizing { color: var(--eoc-status-warning); }.composition-condition.is-disrupted { color: var(--eoc-status-critical); }.composition-condition.is-unknown { color: var(--eoc-status-unknown); }
.composition-state { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; font-size: 12px; font-weight: 650; }
.composition-state > span { width: 8px; height: 8px; border-radius: 2px; background: currentColor; }
.composition-state.is-current { color: var(--eoc-status-success); }.composition-state.is-stale { color: var(--eoc-status-warning); }.composition-state.is-unavailable { color: var(--eoc-status-critical); }.composition-state.is-zero { color: var(--eoc-status-unknown); }
.composition-tabs { display: flex; gap: 4px; overflow: auto; border-bottom: 1px solid var(--eoc-border); }
.composition-tabs button { min-height: 42px; padding: 8px 12px; white-space: nowrap; color: var(--eoc-text); background: transparent; border: 0; border-bottom: 3px solid transparent; }
.composition-tabs button[aria-current] { color: var(--composition-accent); border-bottom-color: var(--composition-accent); font-weight: 750; }
.composition-filterbar { margin: 12px 0; padding: 9px; display: flex; align-items: end; gap: 9px; flex-wrap: wrap; background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 6px; }
.composition-filterbar label, .composition-field { display: grid; gap: 3px; color: var(--eoc-text-muted); font-size: 11px; }
.composition-filterbar input, .composition-filterbar select, .composition-field input, .composition-field select, .composition-field textarea { min-height: 40px; min-width: 145px; padding: 7px; color: var(--eoc-text); background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 4px; }
.composition-filterbar .composition-state { margin-left: auto; align-self: center; }
.composition-lifeline-layout { display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 12px; }
.composition-lifeline-grid { display: grid; grid-template-columns: repeat(4, minmax(160px, 1fr)); gap: 9px; }
.composition-lifeline-card { min-width: 0; padding: 12px; background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 6px; box-shadow: var(--eoc-shadow-sm); }
.composition-lifeline-card.is-selected { outline: 3px solid var(--composition-accent); outline-offset: -3px; }
.composition-lifeline-title { min-height: 44px; display: flex; align-items: center; gap: 7px; }
.composition-lifeline-title h2 { margin: 0; font-size: 14px; }
.composition-lifeline-card > p { min-height: 40px; margin: 10px 0; }
.composition-lifeline-card dl { margin: 0; padding-top: 8px; border-top: 1px solid var(--eoc-border); }
.composition-lifeline-card dl div { margin-top: 5px; }.composition-lifeline-card dt { color: var(--eoc-text-muted); font-size: 10px; }.composition-lifeline-card dd { margin: 0; font-size: 11px; }
.composition-esf-table { margin-top: 10px; }
.composition-esf-table > div:first-child { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }.composition-esf-table h2 { margin: 0; font-size: 16px; }.composition-esf-table span { color: var(--eoc-text-muted); }
.composition-esf-table table, .composition-board-scroll table { width: 100%; border-collapse: collapse; }
.composition-esf-table th, .composition-esf-table td, .composition-board-scroll th, .composition-board-scroll td { padding: 8px; text-align: left; border-bottom: 1px solid var(--eoc-border); }
.composition-neutral-chip { display: inline-block; padding: 2px 8px; color: var(--eoc-status-info) !important; background: var(--eoc-surface-raised); border: 1px solid var(--eoc-border); border-radius: 999px; }.composition-neutral-chip.is-muted { color: var(--eoc-text-muted) !important; }
.composition-meta { color: var(--eoc-text-muted); }.composition-impact { font-size: 16px; }
.composition-board-layout { display: grid; grid-template-columns: minmax(0, 1fr) 310px; gap: 12px; }
.composition-board-panel { min-width: 0; }
.composition-narrow-detail-toggle { display: none; width: 100%; min-height: 42px; margin-bottom: 8px; color: var(--composition-accent); background: var(--eoc-surface); border: 1px solid var(--composition-accent); border-radius: 4px; }
.composition-board-scroll { overflow: auto; }
.composition-board-scroll .eoc-table { width: 100%; min-width: 800px; border-collapse: collapse; }
.composition-board-scroll .eoc-table th, .composition-board-scroll .eoc-table td { padding: 10px 8px; text-align: left; border-bottom: 1px solid var(--eoc-border); vertical-align: top; }
.composition-table-summary, .composition-table-footer { min-height: 42px; display: flex; align-items: center; gap: 16px; color: var(--eoc-text-muted); border-bottom: 1px solid var(--eoc-border); }
.composition-table-summary button, .composition-table-footer button { margin-left: auto; color: var(--composition-accent); background: transparent; border: 0; }.composition-table-footer { border: 0; border-top: 1px solid var(--eoc-border); }.composition-table-footer button + button { margin-left: 0; }
.composition-resource-layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 420px); gap: 12px; }
.composition-kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }.composition-kpi-row article { padding: 12px; display: grid; background: var(--eoc-surface-raised); border: 1px solid var(--eoc-border); border-radius: 5px; }.composition-kpi-row strong { font-size: 24px; }.composition-kpi-row small { color: var(--eoc-text-muted); }
.composition-queue-row { min-height: 58px; display: grid; grid-template-columns: 85px 1fr auto; gap: 10px; align-items: center; border-top: 1px solid var(--eoc-border); }
.composition-form-drawer form { display: grid; gap: 12px; margin-top: 12px; }
.composition-field textarea { min-height: 80px; resize: vertical; }
.composition-form-drawer fieldset { display: grid; gap: 7px; border: 1px solid var(--eoc-border); border-radius: 5px; }.composition-form-drawer fieldset label { display: flex; gap: 7px; align-items: center; }
.composition-form-actions { display: flex; justify-content: end; gap: 8px; }
.composition-iap-status { min-height: 44px; margin-bottom: 10px; padding: 8px 12px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap; background: var(--eoc-surface); border: 1px solid var(--eoc-border); border-radius: 5px; }
.composition-planning-layout { display: grid; grid-template-columns: 245px minmax(420px, 1fr) 300px; gap: 12px; }
.composition-plan-outline h2 { margin-top: 0; }.composition-plan-outline > button { width: 100%; min-height: 60px; padding: 7px; display: grid; grid-template-columns: 25px 1fr auto; gap: 7px; align-items: center; text-align: left; color: var(--eoc-text); background: transparent; border: 0; border-top: 1px solid var(--eoc-border); }.composition-plan-outline > button[aria-current] { background: var(--composition-accent-soft); outline: 2px solid var(--composition-accent); }.composition-plan-outline small { display: block; color: var(--eoc-text-muted); }
.composition-editor > header { display: flex; justify-content: space-between; align-items: start; gap: 12px; border-bottom: 1px solid var(--eoc-border); }.composition-editor h2 { margin: 2px 0 10px; }.composition-editor h3 { margin-bottom: 5px; }.composition-editor section { padding-top: 8px; border-top: 1px solid var(--eoc-border); }
.composition-editor-grid { margin: 12px 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }.composition-editor-grid div { padding: 8px; background: var(--eoc-surface-raised); }.composition-editor-grid span { display: block; color: var(--eoc-text-muted); font-size: 10px; }
.composition-editor ol { margin: 0; padding-left: 24px; }.composition-editor li { padding: 8px 0; }.composition-editor li span { display: block; color: var(--eoc-text-muted); }
.composition-source-panel > div { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; }.composition-source-panel > div > span:last-child { color: var(--eoc-text-muted); }
.composition-editor-actions { margin-top: 14px; display: flex; justify-content: end; gap: 8px; }
.composition-readiness { margin: 14px 0; display: grid; gap: 5px; }.composition-readiness strong { font-size: 30px; }.composition-readiness progress { width: 100%; accent-color: var(--composition-accent); }
@container (max-width: 980px) {
  .composition-command { grid-template-columns: auto 1fr auto auto auto; }.composition-command-item { display: none; }.composition-account { display: none; }
  .composition-lifeline-grid { grid-template-columns: repeat(2, 1fr); }
  .composition-map-layout, .composition-planning-layout { grid-template-columns: 190px minmax(0, 1fr); }.composition-map-layout > .composition-drawer, .composition-planning-layout > .composition-drawer { grid-column: 1 / -1; }
}
@container (max-width: 640px) {
  .composition-command { position: relative; grid-template-columns: auto 1fr auto; padding: 7px 9px; }.composition-nav-toggle { display: block; }.composition-brand span, .composition-context, .composition-sync, .composition-command-button, .composition-account { display: none; }
  .composition-shell-body, .composition-shell-body.has-compact-rail { grid-template-columns: 1fr; }.composition-rail { display: none; position: absolute; z-index: 20; width: min(320px, 86cqw); max-height: 720px; box-shadow: var(--eoc-shadow-lg); }.composition-rail.is-open { display: block; }.composition-rail.is-compact h2, .composition-rail.is-compact button:not(.composition-rail-toggle) > span { position: static; width: auto; height: auto; margin: 0; overflow: visible; clip: auto; white-space: normal; }.composition-rail.is-compact button:not(.composition-rail-toggle) { justify-content: flex-start; }.composition-rail-toggle { display: none; }
  .composition-page { padding: 12px; }.composition-page-header { align-items: start; flex-direction: column; }.composition-actions { width: 100%; }.composition-actions button { flex: 1; }
  .composition-overview-wide { display: none; }.composition-narrow-overview { display: block; }.composition-kpi-row { grid-template-columns: repeat(2, 1fr); }
  .composition-reference-grid, .composition-map-layout, .composition-lifeline-layout, .composition-board-layout, .composition-resource-layout, .composition-planning-layout { grid-template-columns: 1fr; }
  .composition-layer-panel { display: none; }.composition-map { min-height: 420px; }.composition-map svg { min-height: 420px; }.composition-map-layout > .composition-drawer { grid-column: auto; }
  .composition-lifeline-layout > div { min-width: 0; }.composition-lifeline-grid { min-width: 0; grid-template-columns: minmax(0, 1fr); }.composition-lifeline-card { max-width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, max-content); gap: 5px; }.composition-lifeline-title { min-width: 0; }.composition-lifeline-title h2, .composition-lifeline-card > .composition-condition { overflow-wrap: anywhere; }.composition-lifeline-card > .composition-condition { min-width: 0; max-width: 100%; flex-wrap: wrap; justify-content: end; }.composition-lifeline-card > p, .composition-lifeline-card dl { grid-column: 1 / -1; min-height: 0; }
  .composition-filterbar { flex-wrap: nowrap; overflow: auto; }.composition-filterbar .composition-state { margin-left: 0; }.composition-board-filters label:nth-of-type(n+3) { display: none; }
  .composition-narrow-detail-toggle { display: block; }.composition-board-layout:not(.show-detail) .composition-drawer { display: none; }.composition-board-layout.show-detail .composition-board-panel { display: none; }.composition-board-panel { padding: 8px; }.composition-table-summary span:nth-child(n+3) { display: none; }
  .composition-resource-backdrop { display: none; }.composition-form-drawer { border-radius: 0; box-shadow: none; }.composition-form-actions { position: sticky; bottom: 0; padding: 8px 0; background: var(--eoc-surface); }
  .composition-plan-outline { display: flex; gap: 6px; overflow: auto; }.composition-plan-outline h2 { display: none; }.composition-plan-outline > button { min-width: 180px; border: 1px solid var(--eoc-border); }.composition-editor-grid { grid-template-columns: repeat(2, 1fr); }.composition-planning-layout > .composition-drawer { grid-column: auto; }
  .composition-iap-status span:last-child { display: none; }.composition-source-panel > div { align-items: start; flex-direction: column; }
}
@media (max-width: 640px) {
  .composition-reviewbar { align-items: stretch; flex-direction: column; padding: 8px; }
  .composition-review-controls { width: 100%; display: grid; grid-template-columns: 1fr; }
  .composition-review-controls label, .composition-review-controls select, .composition-review-controls button { width: 100%; }
}
`;
