// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FieldDef } from "@openeoc/shared";
import { Theme } from "../components.js";
import type { DraftScope, ScopedDraftStore } from "../form-drafts.js";
import { mergeDraft, SchemaForm } from "../forms.js";

afterEach(cleanup);

const fields: readonly FieldDef[] = [
  { key: "summary", label: "Summary", type: "text", required: true, read: "any", write: "member" },
  { key: "urgent", label: "Urgent", type: "boolean", required: false, read: "any", write: "member" },
  { key: "priority", label: "Priority", type: "enum", values: ["routine", "urgent"], required: true, condition: { field: "urgent", op: "eq", value: true }, read: "any", write: "member" },
  { key: "quantity", label: "Quantity", type: "number", required: true, read: "any", write: "member" },
  { key: "unit_cost", label: "Unit cost", type: "number", required: false, read: "any", write: "member" },
  { key: "total", label: "Total", type: "number", required: false, calculation: { op: "multiply", inputs: ["quantity", "unit_cost"] }, read: "any", write: "member" },
];

const scope: DraftScope = {
  personId: "person-a",
  incidentId: "incident-a",
  formId: "request",
  recordId: null,
  schema: "v1",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function store(overrides: Partial<ScopedDraftStore> = {}): ScopedDraftStore {
  return {
    async load() { return null; },
    async save(_scope, values) { return { values, savedAt: "2026-09-21T12:00:00.000Z" }; },
    async clear() { return undefined; },
    ...overrides,
  };
}

function fillRequired(getByLabelText: (text: string) => HTMLElement) {
  fireEvent.change(getByLabelText("Summary"), { target: { value: "Generator request" } });
  fireEvent.change(getByLabelText("Quantity"), { target: { value: "4" } });
}

describe("shared-schema form validation", () => {
  it("focuses a linked error summary and allows correction without re-entry", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = render(<Theme name="light"><SchemaForm fields={fields} onSubmit={onSubmit} /></Theme>);
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    const summary = await view.findByText("Correct 2 form errors");
    expect(summary.closest("[tabindex='-1']")).toBe(document.activeElement);
    const errorLink = view.getByRole("link", { name: /Summary:/ });
    expect(errorLink.getAttribute("href")).toContain("summary");
    expect(errorLink.textContent).toContain("Enter Summary");
    expect(errorLink.textContent).not.toMatch(/expected|undefined/i);
    window.location.hash = "#/boards";
    fireEvent.click(errorLink);
    expect(window.location.hash).toBe("#/boards");
    expect(document.activeElement).toBe(view.getByLabelText("Summary"));
    const summaryControl = view.getByLabelText("Summary");
    fireEvent.change(summaryControl, { target: { value: "Generator request" } });
    expect(await view.findByText("Correct 1 form error")).not.toBeNull();
    expect(document.activeElement).toBe(summaryControl);
    fireEvent.change(view.getByLabelText("Quantity"), { target: { value: "4" } });
    expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("Generator request");
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ summary: "Generator request", quantity: 4 })));
  });

  it("shows a field the record's state locks, disabled, with the reason, and still submits its value", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = render(<Theme name="light"><SchemaForm fields={fields} initialValues={{ summary: "Generator request", quantity: 4 }}
      readOnly={{ fields: new Set(["quantity"]), reason: "Read-only while the record is Submitted." }} onSubmit={onSubmit} /></Theme>);
    const quantity = view.getByLabelText("Quantity") as HTMLInputElement;
    expect(quantity.disabled).toBe(true);
    const note = view.getByText("Read-only while the record is Submitted.");
    expect(quantity.getAttribute("aria-describedby")).toBe(note.id);
    expect((view.getByLabelText("Summary") as HTMLTextAreaElement).disabled).toBe(false);
    fireEvent.change(view.getByLabelText("Summary"), { target: { value: "Two generators" } });
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ summary: "Two generators", quantity: 4 })));
  });

  it("shows and requires a conditional control only when its shared condition matches", async () => {
    const view = render(<Theme name="light"><SchemaForm fields={fields} onSubmit={async () => undefined} /></Theme>);
    expect(view.queryByLabelText("Priority")).toBeNull();
    fireEvent.click(view.getByLabelText("Urgent"));
    expect(view.getByLabelText("Priority")).not.toBeNull();
    fillRequired(view.getByLabelText);
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    expect(await view.findByRole("link", { name: /Priority:/ })).not.toBeNull();
    fireEvent.change(view.getByLabelText("Priority"), { target: { value: "urgent" } });
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(view.getByText(/^Received by the server at /)).not.toBeNull());
  });
});

describe("draft hydration and submission truth", () => {
  it("keeps a colleague's change the draft left alone and names a field both changed", () => {
    const merged = mergeDraft(fields, { summary: "mine", quantity: 3 }, { summary: "start", quantity: 3 }, { summary: "theirs", quantity: 5 });
    expect(merged.values).toEqual({ summary: "mine", quantity: 5 });
    expect(merged.conflicts).toEqual(["Summary: yours mine, now on the server theirs"]);
  });

  it("hydrates a scoped draft without saving defaults over it", async () => {
    const load = deferred<{ values: Readonly<Record<string, unknown>>; savedAt: string } | null>();
    const save = vi.fn(async (_scope: DraftScope, values: Readonly<Record<string, unknown>>) => ({ values, savedAt: "2026-09-21T12:00:00.000Z" }));
    const draftStore = store({ load: () => load.promise, save });
    const view = render(<Theme name="light"><SchemaForm fields={fields} initialValues={{ summary: "default" }} draftStore={draftStore} draftScope={scope} onSubmit={async () => undefined} /></Theme>);
    expect(view.getByText("Loading saved draft…")).not.toBeNull();
    expect(save).not.toHaveBeenCalled();
    await act(async () => load.resolve({ values: { summary: "restored", quantity: 9 }, savedAt: "2026-09-21T11:00:00.000Z" }));
    await waitFor(() => expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("restored"));
    expect((view.getByLabelText("Quantity") as HTMLInputElement).value).toBe("9");
    expect(save).not.toHaveBeenCalled();
  });

  it("resets before hydrating a different scope", async () => {
    const draftStore = store({
      async load(nextScope) {
        return nextScope.incidentId === "incident-a"
          ? { values: { summary: "incident A", quantity: 1 }, savedAt: "2026-09-21T10:00:00.000Z" }
          : { values: { summary: "incident B", quantity: 2 }, savedAt: "2026-09-21T10:05:00.000Z" };
      },
    });
    const view = render(<Theme name="light"><SchemaForm fields={fields} draftStore={draftStore} draftScope={scope} onSubmit={async () => undefined} /></Theme>);
    await waitFor(() => expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("incident A"));
    view.rerender(<Theme name="light"><SchemaForm fields={fields} initialValues={{ summary: "new context" }} draftStore={draftStore} draftScope={{ ...scope, incidentId: "incident-b" }} onSubmit={async () => undefined} /></Theme>);
    expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("new context");
    await waitFor(() => expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("incident B"));
  });

  it("preserves values and draft after a rejected submission", async () => {
    const save = vi.fn(async (_scope: DraftScope, values: Readonly<Record<string, unknown>>) => ({ values, savedAt: "2026-09-21T12:00:00.000Z" }));
    const clear = vi.fn(async () => undefined);
    const view = render(<Theme name="dark"><SchemaForm fields={fields} draftStore={store({ save, clear })} draftScope={scope} onSubmit={async () => { throw new Error("Service unavailable"); }} /></Theme>);
    await waitFor(() => expect(view.queryByText("Loading saved draft…")).toBeNull());
    fillRequired(view.getByLabelText);
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    expect(await view.findByText(/^Not sent: Service unavailable. Your work is kept on this device./)).not.toBeNull();
    expect(view.getByRole("alert").textContent).toContain("Service unavailable");
    expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("Generator request");
    expect(clear).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    expect(view.queryByText(/^Received by the server at /)).toBeNull();
  });

  it("shows success and clears draft only after submission resolves", async () => {
    const pending = deferred<void>();
    const clear = vi.fn(async () => undefined);
    const view = render(<Theme name="light"><SchemaForm fields={fields} draftStore={store({ clear })} draftScope={scope} onSubmit={() => pending.promise} /></Theme>);
    await waitFor(() => expect(view.queryByText("Loading saved draft…")).toBeNull());
    fillRequired(view.getByLabelText);
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    expect(view.queryByText(/^Received by the server at /)).toBeNull();
    expect(clear).not.toHaveBeenCalled();
    await act(async () => pending.resolve());
    await waitFor(() => expect(view.getByText(/^Received by the server at /)).not.toBeNull());
    expect(clear).toHaveBeenCalledOnce();
  });

  it("ignores a completed submission after the form moves to another scope", async () => {
    const pending = deferred<void>();
    const onSubmit = vi.fn(() => pending.promise);
    const view = render(<Theme name="light"><SchemaForm fields={fields} draftScope={scope} onSubmit={onSubmit} /></Theme>);
    fillRequired(view.getByLabelText);
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    expect(onSubmit).toHaveBeenCalledOnce();
    view.rerender(<Theme name="light"><SchemaForm fields={fields} initialValues={{ summary: "Incident B", quantity: 2 }} draftScope={{ ...scope, incidentId: "incident-b" }} onSubmit={onSubmit} /></Theme>);
    await waitFor(() => expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("Incident B"));
    await act(async () => pending.resolve());
    expect(view.queryByText(/^Received by the server at /)).toBeNull();
    expect(view.getByText("No unsaved changes")).not.toBeNull();
    expect((view.getByRole("button", { name: "Save record" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("reports draft storage failures without losing current values", async () => {
    const view = render(<Theme name="light"><SchemaForm fields={fields} draftStore={store({ save: async () => { throw new Error("Storage quota unavailable"); } })} draftScope={scope} onSubmit={async () => undefined} /></Theme>);
    await waitFor(() => expect(view.queryByText("Loading saved draft…")).toBeNull());
    fireEvent.change(view.getByLabelText("Summary"), { target: { value: "Retained locally in state" } });
    expect(await view.findByText("Storage quota unavailable")).not.toBeNull();
    expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("Retained locally in state");
  });
});

describe("unsupported adapters", () => {
  it("reports reference, geometry, and attachment controls unavailable", () => {
    const adapterFields: readonly FieldDef[] = [
      { key: "person", label: "Person", type: "person_ref", required: false, read: "member", write: "member" },
      { key: "place", label: "Place", type: "geometry", geometryKind: "point", required: false, read: "any", write: "member" },
      { key: "file", label: "File", type: "attachment", required: false, read: "member", write: "member" },
    ];
    const view = render(<Theme name="light"><SchemaForm fields={adapterFields} onSubmit={async () => undefined} /></Theme>);
    expect(view.getByText("Reference choices are unavailable in this context.")).not.toBeNull();
    expect(view.getByText("Geometry editing is unavailable in this context.")).not.toBeNull();
    expect(view.getByText("Attachment upload is unavailable in this context.")).not.toBeNull();
    expect(view.queryByLabelText("Person")).toBeNull();
  });

  it("blocks submit during upload and ignores an upload completed after a scope change", async () => {
    const pending = deferred<string>();
    const upload = vi.fn(() => pending.promise);
    const onSubmit = vi.fn(async () => undefined);
    const attachmentFields: readonly FieldDef[] = [
      { key: "file", label: "File", type: "attachment", required: false, read: "member", write: "member" },
    ];
    const view = render(<Theme name="light"><SchemaForm fields={attachmentFields} draftScope={scope} onUpload={upload} onSubmit={onSubmit} /></Theme>);
    fireEvent.change(view.getByLabelText("File"), { target: { files: [new File(["proof"], "proof.txt")] } });
    expect(await view.findByText("Uploading…")).not.toBeNull();
    expect((view.getByRole("button", { name: "Save record" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<Theme name="light"><SchemaForm fields={attachmentFields} draftScope={{ ...scope, incidentId: "incident-b" }} onUpload={upload} onSubmit={onSubmit} /></Theme>);
    await waitFor(() => expect((view.getByRole("button", { name: "Save record" }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => pending.resolve("attachment-a"));
    expect(view.queryByText("Attached")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({}));
  });

  it("retains a concurrent field edit when a Strict Mode upload completes", async () => {
    const pending = deferred<string>();
    const onSubmit = vi.fn(async () => undefined);
    const uploadFields: readonly FieldDef[] = [
      { key: "summary", label: "Summary", type: "text", required: false, read: "any", write: "member" },
      { key: "file", label: "File", type: "attachment", required: false, read: "member", write: "member" },
    ];
    const view = render(<StrictMode><Theme name="light"><SchemaForm fields={uploadFields} onUpload={() => pending.promise} onSubmit={onSubmit} /></Theme></StrictMode>);
    fireEvent.change(view.getByLabelText("File"), { target: { files: [new File(["proof"], "proof.txt")] } });
    expect(await view.findByText("Uploading…")).not.toBeNull();
    fireEvent.change(view.getByLabelText("Summary"), { target: { value: "Edited while uploading" } });
    await act(async () => pending.resolve("00000000-0000-4000-8000-000000000001"));
    await waitFor(() => expect(view.getByText("Attached")).not.toBeNull());
    expect((view.getByLabelText("Summary") as HTMLTextAreaElement).value).toBe("Edited while uploading");
    fireEvent.click(view.getByRole("button", { name: "Save record" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ summary: "Edited while uploading", file: "00000000-0000-4000-8000-000000000001" }));
  });
});
