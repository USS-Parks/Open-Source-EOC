import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { FieldDef, FormLayout } from "@openeoc/shared";
import { Theme } from "../src/design/components.js";
import { ActionButton } from "../src/design/controls.js";
import { createMetadataDraftStore, type DraftScope } from "../src/design/form-drafts.js";
import { SchemaForm, type GeometryFieldContext } from "../src/design/forms.js";
import { Drawer, ModalDialog } from "../src/design/overlays.js";
import type { ThemeName } from "../src/design/tokens.js";
import "./form-gallery.css";

const fields: readonly FieldDef[] = [
  { key: "summary", label: "Request summary", type: "text", required: true, maxLength: 240, read: "any", write: "member" },
  { key: "urgent", label: "Urgent request", type: "boolean", required: false, read: "any", write: "member" },
  { key: "priority", label: "Priority", type: "enum", values: ["routine", "urgent", "immediate"], required: true, condition: { field: "urgent", op: "eq", value: true }, read: "any", write: "member" },
  { key: "quantity", label: "Quantity", type: "number", required: true, read: "any", write: "member" },
  { key: "unit_cost", label: "Estimated unit cost", type: "number", required: false, read: "any", write: "member" },
  { key: "estimated_total", label: "Estimated total", type: "number", required: false, calculation: { op: "multiply", inputs: ["quantity", "unit_cost"] }, read: "any", write: "member" },
  { key: "needed_at", label: "Needed by", type: "datetime", required: true, read: "any", write: "member" },
  { key: "requester", label: "Requester", type: "person_ref", required: true, read: "member", write: "member" },
  { key: "related_request", label: "Related request", type: "record_ref", required: false, targetBoardKey: "resource_requests", labelField: "summary", read: "member", write: "member" },
  { key: "location", label: "Delivery location", type: "geometry", geometryKind: "point", required: false, read: "any", write: "member" },
  { key: "attachment", label: "Supporting file", type: "attachment", required: false, read: "member", write: "member" },
];

const layout: FormLayout = {
  sections: [
    { key: "request", title: "Request", fields: ["summary", "urgent", "priority", "quantity", "unit_cost", "estimated_total"] },
    { key: "coordination", title: "Coordination", fields: ["needed_at", "requester", "related_request"] },
    { key: "location_files", title: "Location and files", fields: ["location", "attachment"] },
  ],
};

const draftScope: DraftScope = {
  personId: "person-jordan-diaz",
  incidentId: "incident-north-coast-storm",
  formId: "resource-request",
  recordId: null,
  schema: "resource-request-v3",
};

interface FormReviewProps { readonly initialTheme?: ThemeName }

export function FormReview({ initialTheme = "light" }: FormReviewProps) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [rejectSubmit, setRejectSubmit] = useState(true);
  const [formEpoch, setFormEpoch] = useState(0);
  const [activity, setActivity] = useState("No form action completed");
  const draftStore = useMemo(() => {
    const metadata = new Map<string, unknown>();
    return createMetadataDraftStore({
      async getMeta<T>(key: string) { return (metadata.get(key) as T | undefined) ?? null; },
      async setMeta(key: string, value: unknown) { metadata.set(key, value); },
    });
  }, []);

  async function submit(values: Record<string, unknown>) {
    await Promise.resolve();
    if (rejectSubmit) throw new Error("Synthetic service rejection");
    setActivity(`Saved request: ${String(values.summary)}`);
  }

  function renderGeometry(context: GeometryFieldContext) {
    const value = context.value as { type?: string; coordinates?: readonly number[] } | undefined;
    const longitude = value?.coordinates?.[0];
    const latitude = value?.coordinates?.[1];
    function update(nextLongitude: number | undefined, nextLatitude: number | undefined) {
      if (nextLongitude === undefined || nextLatitude === undefined) context.onChange(undefined);
      else context.onChange({ type: "Point", coordinates: [nextLongitude, nextLatitude] });
    }
    return (
      <fieldset className="form-review-geometry">
        <legend>{context.field.label}</legend>
        <label>Longitude<input type="number" value={longitude ?? ""} disabled={context.disabled} onChange={(event) => update(event.target.value ? Number(event.target.value) : undefined, latitude)} /></label>
        <label>Latitude<input type="number" value={latitude ?? ""} disabled={context.disabled} onChange={(event) => update(longitude, event.target.value ? Number(event.target.value) : undefined)} /></label>
      </fieldset>
    );
  }

  return (
    <Theme name={theme}>
      <main className="form-review" data-review-theme={theme}>
        <header className="form-review-command">
          <div><strong>Open Source EOC</strong><span>North Coast Storm · OP 03</span></div>
          <button type="button" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>Use {theme === "light" ? "dark" : "light"} theme</button>
        </header>
        <div className="form-review-body">
          <header className="form-review-heading">
            <div><p>Operations / Resource requests</p><h1>Recoverable form and overlay review</h1></div>
            <ActionButton kind="primary" onClick={() => setDrawerOpen(true)}>New request</ActionButton>
          </header>
          <section className="form-review-layout">
            <div className="form-review-panel">
              <h2>Request workspace</h2>
              <p>This synthetic review preserves values through validation, a rejected submission, drawer close, and scoped draft restore.</p>
              <div className="form-review-actions">
                <ActionButton onClick={() => setDrawerOpen(true)}>Open request drawer</ActionButton>
                <ActionButton onClick={() => setDialogOpen(true)}>Open confirmation dialog</ActionButton>
                <label><input type="checkbox" checked={rejectSubmit} onChange={(event) => setRejectSubmit(event.target.checked)} /> Reject synthetic submit</label>
              </div>
              <p className="form-review-activity" aria-live="polite">{activity}</p>
            </div>
            <aside className="form-review-panel">
              <h2>Behavior contract</h2>
              <ul><li>Shared schema validation</li><li>Scoped serialized drafts</li><li>Linked error summary</li><li>Focus trap and restore</li><li>Explicit unsaved confirmation</li></ul>
            </aside>
          </section>
        </div>

        <Drawer
          open={drawerOpen}
          title="New resource request"
          unsaved={dirty}
          onClose={() => setDrawerOpen(false)}
          onDiscard={async () => {
            await draftStore.clear(draftScope);
            setFormEpoch((value) => value + 1);
            setDirty(false);
          }}
          footer={dirty ? <ActionButton onClick={() => setDrawerOpen(false)}>Close and keep draft</ActionButton> : undefined}
        >
          <SchemaForm
            key={formEpoch}
            fields={fields}
            layout={layout}
            initialValues={{ needed_at: "2026-09-21T18:00:00.000Z" }}
            referenceOptions={{ requester: [{ value: "11111111-1111-4111-8111-111111111111", label: "Jordan Diaz · Planning" }] }}
            renderGeometry={renderGeometry}
            onUpload={async () => "22222222-2222-4222-8222-222222222222"}
            draftStore={draftStore}
            draftScope={draftScope}
            onDirtyChange={setDirty}
            onSubmit={submit}
            submitLabel="Submit request"
          />
        </Drawer>

        <ModalDialog open={dialogOpen} title="Publish operational update" unsaved onClose={() => setDialogOpen(false)} onDiscard={() => setActivity("Dialog changes discarded")}>
          <p>Publishing makes this synthetic update visible to participating organizations.</p>
          <label className="form-review-dialog-field">Update title<input type="text" defaultValue="Operational update" /></label>
        </ModalDialog>
      </main>
    </Theme>
  );
}

export function mountFormReview(element: Element) {
  createRoot(element).render(<FormReview />);
}
