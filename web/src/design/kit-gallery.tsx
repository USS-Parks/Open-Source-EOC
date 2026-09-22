import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "./components.js";
import {
  ActionCard,
  ConditionCard,
  KpiCard,
  RecordCard,
  SummaryCard,
} from "./cards.js";
import {
  ActionButton,
  Menu,
  ProgressIndicator,
  Tabs,
  Tooltip,
} from "./controls.js";
import {
  ConditionBadge,
  CountBadge,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./feedback.js";
import type { ThemeName, OperationalState } from "./tokens.js";
import "./kit-gallery.css";

const lifelines: readonly {
  title: string;
  state: OperationalState;
  stateLabel: string;
  mark: string;
  summary: string;
  source: string;
  assessed: string;
}[] = [
  { title: "Safety & Security", state: "normal", stateLabel: "Stable", mark: "SS", summary: "Patrol coverage maintained", source: "CA OES – Law Enforcement", assessed: "09:20 PDT" },
  { title: "Food, Hydration, Shelter", state: "watch", stateLabel: "Stabilizing", mark: "FH", summary: "8 shelters supporting 312 people", source: "CA OES – Human Services", assessed: "09:15 PDT" },
  { title: "Health & Medical", state: "normal", stateLabel: "Stable", mark: "HM", summary: "Emergency services available", source: "CA Dept. of Public Health", assessed: "09:25 PDT" },
  { title: "Energy", state: "critical", stateLabel: "Disrupted", mark: "EN", summary: "Two substations offline; backup generation supports priority facilities", source: "CA Energy Commission", assessed: "09:35 PDT" },
  { title: "Communications", state: "watch", stateLabel: "Stabilizing", mark: "CO", summary: "Backup links in use", source: "CA OES – Communications", assessed: "09:28 PDT" },
  { title: "Transportation", state: "critical", stateLabel: "Disrupted", mark: "TR", summary: "Three access routes closed", source: "Caltrans", assessed: "09:18 PDT" },
  { title: "Hazardous Materials", state: "unknown", stateLabel: "Unknown", mark: "HZ", summary: "Assessment pending", source: "Cal EPA – HMD", assessed: "09:18 PDT" },
  { title: "Water Systems", state: "watch", stateLabel: "Stabilizing", mark: "WS", summary: "Treatment on backup power", source: "State Water Resources Control Board", assessed: "09:22 PDT" },
];

interface KitReviewProps {
  readonly initialTheme?: ThemeName;
}

export function KitReview({ initialTheme = "light" }: KitReviewProps) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  const [tab, setTab] = useState("lifelines");
  const [activity, setActivity] = useState("No review action selected");
  const [saving, setSaving] = useState(false);

  function saveAssessment() {
    setSaving(true);
    setActivity("Assessment save demonstrated");
  }

  return (
    <Theme name={theme}>
      <main className="kit-review" data-review-theme={theme}>
        <header className="kit-reviewbar">
          <div><strong>Shared component review</strong><small>Synthetic examples · no records are changed</small></div>
          <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            Use {theme === "light" ? "dark" : "light"} theme
          </button>
        </header>

        <div className="kit-review-body">
          <header className="kit-review-heading">
            <div><h1>Incident overview</h1><p>Compact component contract aligned to the canonical visual references</p></div>
            <div className="kit-review-heading-actions">
              <ActionButton kind="primary" onClick={() => setActivity("Create report selected")}>Create report</ActionButton>
              <ActionButton onClick={() => setActivity("Briefing view selected")}>Briefing view</ActionButton>
            </div>
          </header>

          <section className="kit-review-kpis" aria-label="Key incident measures">
            <KpiCard label="Open requests" value={{ kind: "value", value: 24 }} detail="6 urgent" leading={<span className="kit-review-leading" aria-hidden="true">!</span>} action={{ label: "Open", onClick: () => setActivity("Open requests selected") }} />
            <KpiCard label="Active shelters" value={{ kind: "value", value: 8 }} detail="312 occupants" leading={<span className="kit-review-leading" aria-hidden="true">S</span>} action={{ label: "Open", onClick: () => setActivity("Active shelters selected") }} />
            <KpiCard label="Unverified reports" value={{ kind: "zero" }} detail="Reported value; not a condition" leading={<span className="kit-review-leading" aria-hidden="true">0</span>} />
            <KpiCard label="Damage estimate" value={{ kind: "unknown" }} detail="Assessment has not reported" leading={<span className="kit-review-leading" aria-hidden="true">?</span>} />
          </section>

          <Tabs
            id="kit-review"
            label="Component examples"
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "lifelines", label: "Condition cards" },
              { id: "records", label: "Record and action cards" },
              { id: "feedback", label: "Feedback states" },
            ]}
          />

          {tab === "lifelines" ? (
            <section id="kit-review-lifelines-panel" role="tabpanel" aria-labelledby="kit-review-lifelines-tab" className="kit-review-workspace">
              <div className="kit-review-main">
                <section className="kit-review-panel" aria-labelledby="condition-card-heading">
                  <header><h2 id="condition-card-heading">Community Lifelines</h2><span className="kit-review-panel-note">8 synthetic assessments</span></header>
                  <div className="kit-review-lifelines">
                    {lifelines.map((item) => (
                      <ConditionCard
                        key={item.title}
                        title={item.title}
                        state={item.state}
                        stateLabel={item.stateLabel}
                        leading={<span aria-hidden="true">{item.mark}</span>}
                        summary={item.summary}
                        selected={item.title === "Energy"}
                        metadata={[
                          { label: "Source", value: item.source },
                          { label: "Assessed", value: item.assessed },
                        ]}
                        action={{ label: `Review ${item.title}`, onClick: () => setActivity(`${item.title} selected`) }}
                      />
                    ))}
                  </div>
                </section>
              </div>
              <aside className="kit-review-panel kit-review-drawer" aria-label="Selected condition detail">
                <div><h2>Energy</h2><ConditionBadge state="critical" label="Disrupted" /></div>
                <p>Two substations offline. Backup generation supports priority facilities.</p>
                <SummaryCard
                  title="Assessment summary"
                  items={[
                    { label: "Source", value: "CA Energy Commission" },
                    { label: "Next update", value: "10:30 PDT" },
                    { label: "Linked actions", value: <CountBadge value={2} label="Linked actions" /> },
                  ]}
                />
                <ProgressIndicator label="Assessment completeness" value={72} />
                <div className="kit-review-drawer-actions">
                  <ActionButton kind="primary" loading={saving} loadingLabel="Saving assessment…" onClick={saveAssessment}>Update assessment</ActionButton>
                  <ActionButton onClick={() => setActivity("Assessment history selected")}>View history</ActionButton>
                </div>
              </aside>
            </section>
          ) : null}

          {tab === "records" ? (
            <section id="kit-review-records-panel" role="tabpanel" aria-labelledby="kit-review-records-tab" className="kit-review-main">
              <ActionCard
                title="Generator support for Wendy’s Shelter"
                summary="Long action summaries wrap without hiding ownership, status, or the explicit primary action."
                secondaryAction={{ label: "Review details", onClick: () => setActivity("Details selected") }}
                primaryAction={{ label: "Assign request", onClick: () => setActivity("Assign request selected") }}
              />
              <div className="kit-review-records">
                <RecordCard eyebrow="REQ-1042" title="Deliver additional shelter supplies with an intentionally long record name" fields={[{ label: "Owner", value: "American Red Cross" }, { label: "Due", value: "Today 18:00" }]} actionLabel="Open request" onOpen={() => setActivity("Request opened")} selected />
                <SummaryCard title="Shift summary" items={[{ label: "Open", value: 24, detail: "6 urgent" }, { label: "Assigned", value: 18 }, { label: "Closed", value: 0, detail: "reported zero" }]} footer={<ConditionBadge state="stale" label="Updated 18 minutes ago" />} />
              </div>
              <div className="kit-review-controls">
                <Menu label="More actions" items={[{ id: "export", label: "Export summary", onSelect: () => setActivity("Export summary selected") }, { id: "archive", label: "Archive unavailable", disabled: true, onSelect: () => undefined }]} />
                <Tooltip text="Shows the last confirmed synchronization time"><ActionButton>Sync details</ActionButton></Tooltip>
                <ProgressIndicator label="Background synchronization" />
              </div>
            </section>
          ) : null}

          {tab === "feedback" ? (
            <section id="kit-review-feedback-panel" role="tabpanel" aria-labelledby="kit-review-feedback-tab" className="kit-review-feedback">
              <LoadingState label="Loading field reports" lines={4} />
              <EmptyState title="No assignments yet" description="No assignments match this incident, period, and filter." action={<ActionButton kind="primary" onClick={() => setActivity("Create assignment selected")}>Create assignment</ActionButton>} />
              <ErrorState title="Reports could not be loaded" message="The local service did not respond. Existing records remain unchanged." action={<ActionButton onClick={() => setActivity("Retry selected")}>Retry</ActionButton>} />
            </section>
          ) : null}

          <p className="kit-review-status" aria-live="polite">{activity}</p>
        </div>
      </main>
    </Theme>
  );
}

export function mountKitReview(element: Element) {
  createRoot(element).render(<KitReview />);
}
