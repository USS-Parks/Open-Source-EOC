import { useId, useMemo, useState } from "react";
import {
  allEnums,
  BoardTemplateSchema,
  DashboardTemplateSchema,
  FIELD_TYPES,
  FormDefinitionSchema,
  LocalFieldSchema,
  READ_LEVELS,
  referenceLabelKeys,
  templateDiff,
  WRITE_LEVELS,
  GEOMETRY_KINDS,
  type BoardWorkflow,
  type BoardTemplate,
  type FieldDef,
  type FormLayout,
  type RecordAccess,
  type ViewDef,
} from "@openeoc/shared";
import { SOLUTION_PARTS, type ApiClient, type SolutionImportSummary } from "../app/api/client.js";
import { useAsync } from "../app/data/hooks.js";
import { ActionButton, Tabs } from "../design/controls.js";
import { Button, EnumSelect, Panel, TextField } from "../design/components.js";
import { BoardView } from "./BoardView.js";
import { RecordForm } from "./RecordForm.js";
import { RecordAccessEditor } from "./record-access.js";
import { ConditionRow, ViewRefineControls, blankDraft, conditionDraft, draftCondition, type DraftCondition } from "./ViewRefine.js";
import "./designer.css";

export interface DesignerPositionOption {
  readonly key: string;
  readonly title: string;
}

/**
 * The no-code board designer (INV-6). Everything an administrator can do
 * here is a structured control over the template model; there is no markup
 * input, no script input, and no escape hatch by construction. Saving
 * produces the next template version; the diff is shown before save.
 * Given a client and jurisdiction, an Import tab also takes board templates,
 * forms and dashboard templates from files; given a client and the board
 * being customized, a Local fields tab adds fields to that board alone.
 */
export function Designer(props: {
  base?: BoardTemplate;
  positions?: readonly DesignerPositionOption[];
  onSave: (template: BoardTemplate) => void | Promise<void>;
  saveLabel?: string;
  client?: ApiClient;
  jurisdictionId?: string;
  boardId?: string;
}) {
  const importer = props.client && props.jurisdictionId
    ? { client: props.client, jurisdictionId: props.jurisdictionId } : null;
  const localBoard = props.client && props.boardId ? { client: props.client, boardId: props.boardId } : null;
  const [key, setKey] = useState(props.base?.key ?? "");
  const [title, setTitle] = useState(props.base?.title ?? "");
  const [description, setDescription] = useState(props.base?.description ?? "");
  const [fields, setFields] = useState<FieldDef[]>(props.base ? [...props.base.fields] : []);
  const [views, setViews] = useState<ViewDef[]>(props.base ? [...props.base.views] : []);
  const [inputLayout, setInputLayout] = useState<FormLayout | undefined>(props.base?.inputLayout);
  const [detailLayout, setDetailLayout] = useState<FormLayout | undefined>(props.base?.detailLayout);
  const [workflow, setWorkflow] = useState<BoardWorkflow | undefined>(props.base?.workflow);
  const [recordAccess, setRecordAccess] = useState<RecordAccess | undefined>(props.base?.recordAccess);
  const [tab, setTab] = useState("fields");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const draft = (): unknown => ({
    key,
    version: (props.base?.version ?? 0) + 1,
    title,
    description,
    fields,
    views,
    ...(inputLayout ? { inputLayout } : {}),
    ...(detailLayout ? { detailLayout } : {}),
    ...(workflow ? { workflow } : {}),
    ...(recordAccess ? { recordAccess } : {}),
  });

  async function save() {
    const parsed = BoardTemplateSchema.safeParse(draft());
    if (!parsed.success) {
      setError(describeIssues(parsed.error.issues, "board"));
      setTab("preview");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await props.onSave(parsed.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Template publication failed.");
    } finally {
      setSaving(false);
    }
  }

  const parsedDraft = useMemo(() => BoardTemplateSchema.safeParse(draft()),
    [description, detailLayout, fields, inputLayout, key, recordAccess, title, views, workflow]);
  const diff =
    props.base && parsedDraft.success ? templateDiff(props.base, parsedDraft.data) : null;

  return (
    <div className="board-designer">
      <Panel title="Board">
        <div className="board-designer__grid board-designer__grid--3">
          {props.base ? <p className="board-designer__identity"><span>Board key</span><code>{key}</code></p>
            : <TextField label="Board key" value={key} onChange={setKey} />}
          <TextField label="Board title" value={title} onChange={setTitle} />
          <TextField label="Description" value={description} onChange={setDescription} />
        </div>
      </Panel>

      <Tabs id="board-designer" label="Board configuration" value={tab} onChange={setTab}
        tabs={[{ id: "fields", label: "Fields" }, { id: "layouts", label: "Layouts" },
          { id: "views", label: "Views" }, { id: "routing", label: "Routing" },
          { id: "access", label: "Record access" },
          { id: "preview", label: "Review & preview" },
          ...(localBoard ? [{ id: "local", label: "Local fields" }] : []),
          ...(importer ? [{ id: "import", label: "Import" }] : [])]} />

      <div role="tabpanel" id={`board-designer-${tab}-panel`} aria-labelledby={`board-designer-${tab}-tab`} className="board-designer__panel">
      {tab === "fields" ? <Panel title="Fields">
        <ul className="board-designer__field-list">
          {fields.map((f, i) => (
            <li key={f.key}>
              <ExistingFieldEditor field={f}
                onChange={(field) => setFields(fields.map((item, j) => j === i ? field : item))}
                onRemove={() => setFields(fields.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
        <FieldEditor fields={fields} onAdd={(f) => setFields([...fields, f])} />
      </Panel> : null}

      {tab === "views" ? <Panel title="Views">
        <ul className="board-designer__field-list">
          {views.map((v, i) => (
            <li key={v.key}>
              <ExistingViewEditor view={v} fields={fields}
                onChange={(view) => setViews(views.map((item, j) => j === i ? view : item))}
                onRemove={() => setViews(views.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
        <ViewEditor fieldKeys={fields.map((f) => f.key)} onAdd={(v) => setViews([...views, v])} />
      </Panel> : null}

      {tab === "layouts" ? <div className="board-designer__split">
        <LayoutEditor title="Input layout" fields={fields} value={inputLayout} onChange={setInputLayout} />
        <LayoutEditor title="Detail layout" fields={fields} value={detailLayout} onChange={setDetailLayout} />
      </div> : null}

      {tab === "routing" ? <WorkflowEditor workflow={workflow} fields={fields}
        positions={props.positions ?? []} onChange={setWorkflow} /> : null}

      {tab === "preview" ? <DesignerPreview template={parsedDraft.success ? parsedDraft.data : null}
        error={parsedDraft.success ? null : describeIssues(parsedDraft.error.issues, "board")} diff={diff} /> : null}

      {tab === "access" ? <RecordAccessEditor value={recordAccess} hasWorkflow={Boolean(workflow)}
        onChange={setRecordAccess} /> : null}

      {tab === "local" && localBoard ? <LocalFields {...localBoard} /> : null}

      {tab === "import" && importer ? <DefinitionImport {...importer} /> : null}
      </div>

      {error ? (
        <p role="alert" className="board-designer__error">
          {error}
        </p>
      ) : null}
      <div className="board-designer__footer">
        <p>Publishing creates immutable version {(props.base?.version ?? 0) + 1}. Existing boards update separately.</p>
        <ActionButton kind="primary" loading={saving} disabled={saving}
          onClick={() => void save()}>{props.saveLabel ?? `Publish version ${(props.base?.version ?? 0) + 1}`}</ActionButton>
      </div>
    </div>
  );
}

function ExistingViewEditor(props: {
  view: ViewDef;
  fields: readonly FieldDef[];
  onChange: (view: ViewDef) => void;
  onRemove: () => void;
}) {
  const view = props.view;
  const updateFilter = (index: number, patch: Partial<ViewDef["filter"][number]>) => props.onChange({
    ...view,
    filter: view.filter.map((filter, itemIndex) => itemIndex === index ? { ...filter, ...patch } : filter),
  });
  return <details className="board-designer__field">
    <summary><span>{view.title}</span><code>{view.key}: {view.columns.length} columns</code></summary>
    <Input label={`${view.key} view title`} value={view.title}
      onChange={(title) => props.onChange({ ...view, title })} />
    <CheckGroup label={`${view.key} view columns`} values={view.columns}
      options={props.fields.map((field) => ({ value: field.key, label: field.label }))}
      onChange={(columns) => props.onChange({ ...view, columns })} />
    <ViewRefineControls fields={props.fields} forView
      value={{ where: view.where ?? [], sorts: view.sorts ?? (view.sort ? [view.sort] : []), groupBy: view.groupBy ?? null, archived: "exclude" }}
      onApply={(next) => {
        // The view keeps its own conditions, ordered sort keys and grouping; a single legacy sort folds into the sort keys.
        const { sort: _sort, sorts: _sorts, where: _where, groupBy: _groupBy, ...rest } = view;
        props.onChange({ ...rest, ...(next.where.length ? { where: [...next.where] } : {}),
          ...(next.sorts.length ? { sorts: [...next.sorts] } : {}), ...(next.groupBy ? { groupBy: next.groupBy } : {}) });
      }} />
    <div className="board-designer__stack">
      {view.filter.map((filter, index) => <div className="board-designer__rule" key={`${filter.field}-${index}`}>
        <Select label={`${view.key} filter ${index + 1} field`} value={filter.field}
          options={props.fields.map((field) => ({ value: field.key, label: field.label }))}
          onChange={(field) => updateFilter(index, { field, value: "" })} />
        <Select label={`${view.key} filter ${index + 1} operator`} value={filter.op}
          options={[{ value: "eq", label: "Equals" }, { value: "neq", label: "Does not equal" },
            { value: "in", label: "Is one of" }]}
          onChange={(op) => updateFilter(index, { op: op as "eq" | "neq" | "in" })} />
        <Input label={`${view.key} filter ${index + 1} value`} value={displayFilterValue(filter.value)}
          onChange={(raw) => updateFilter(index, { value: parseFilterValue(
            props.fields.find((field) => field.key === filter.field), filter.op, raw) })} />
        <ActionButton kind="danger" onClick={() => props.onChange({ ...view,
          filter: view.filter.filter((_, itemIndex) => itemIndex !== index) })}>Remove filter</ActionButton>
      </div>)}
      <div className="board-designer__field-actions">
        <ActionButton disabled={props.fields.length === 0} onClick={() => props.onChange({ ...view,
          filter: [...view.filter, { field: props.fields[0]?.key ?? "", op: "eq", value: "" }] })}>Add filter</ActionButton>
        <ActionButton kind="danger" onClick={props.onRemove}>Remove view</ActionButton>
      </div>
    </div>
  </details>;
}

function ExistingFieldEditor(props: {
  field: FieldDef;
  onChange: (field: FieldDef) => void;
  onRemove: () => void;
}) {
  const field = props.field;
  return <details className="board-designer__field">
    <summary><span>{field.label}</span><code>{field.key}: {field.type}</code></summary>
    <div className="board-designer__grid board-designer__grid--3">
      <Input label={`${field.key} label`} value={field.label}
        onChange={(label) => props.onChange({ ...field, label })} />
      <Select label={`${field.key} readable by`} value={field.read}
        options={READ_LEVELS.map((value) => ({ value, label: value }))}
        onChange={(read) => props.onChange({ ...field, read: read as FieldDef["read"] })} />
      <Select label={`${field.key} writable by`} value={field.write}
        options={WRITE_LEVELS.map((value) => ({ value, label: value }))}
        onChange={(write) => props.onChange({ ...field, write: write as FieldDef["write"] })} />
    </div>
    {field.type === "record_ref" ? <LabelFieldsInput label={`${field.key} label fields`}
      value={referenceLabelKeys(field)} onChange={(keys) => props.onChange(withLabelKeys(field, keys))} /> : null}
    <div className="board-designer__field-actions">
      <Check label={`${field.key} required`} checked={field.required}
        onChange={(required) => props.onChange({ ...field, required })} />
      <ActionButton kind="danger" onClick={props.onRemove}>Remove field</ActionButton>
    </div>
    <p className="board-designer__field-note">
      The field key and type stay stable for existing records. Conditional, calculated, and reference settings are included in the review preview.
    </p>
  </details>;
}

function FieldEditor(props: { fields: readonly FieldDef[]; onAdd: (field: FieldDef) => void }) {
  const defaultEnumId = allEnums()[0]?.id ?? "";
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<string>("text");
  const [enumId, setEnumId] = useState(defaultEnumId);
  const [required, setRequired] = useState(false);
  const [read, setRead] = useState<string>("any");
  const [write, setWrite] = useState<string>("member");
  const [geometryKind, setGeometryKind] = useState<string>("any");
  const [targetBoardKey, setTargetBoardKey] = useState("");
  const [labelKeys, setLabelKeys] = useState<string[]>([]);
  const [conditionEnabled, setConditionEnabled] = useState(false);
  const [conditionField, setConditionField] = useState("");
  const [conditionOp, setConditionOp] = useState<string>("eq");
  const [conditionValue, setConditionValue] = useState("");
  const [calculationEnabled, setCalculationEnabled] = useState(false);
  const [calculationOp, setCalculationOp] = useState<string>("sum");
  const [calculationInputs, setCalculationInputs] = useState<string[]>([]);

  function add() {
    const conditionSource = props.fields.find((field) => field.key === conditionField);
    const configuredConditionValue = conditionSource?.type === "number"
      ? Number(conditionValue)
      : conditionSource?.type === "boolean"
        ? conditionValue === "true"
        : conditionValue;
    const field = {
      key,
      label,
      type,
      required,
      read,
      write,
      ...(type === "enum" && enumId ? { enumId } : {}),
      ...(type === "geometry" ? { geometryKind } : {}),
      ...(type === "record_ref" ? withLabelKeys({ targetBoardKey }, labelKeys) : {}),
      ...(conditionEnabled && conditionField ? {
        condition: { field: conditionField, op: conditionOp, value: configuredConditionValue },
      } : {}),
      ...(type === "number" && calculationEnabled ? {
        calculation: { op: calculationOp, inputs: calculationInputs },
      } : {}),
    };
    props.onAdd(field as FieldDef);
    setKey("");
    setLabel("");
    setEnumId(defaultEnumId);
    setRequired(false);
    setTargetBoardKey("");
    setLabelKeys([]);
    setConditionEnabled(false);
    setConditionField("");
    setConditionValue("");
    setCalculationEnabled(false);
    setCalculationInputs([]);
  }

  return (
    <fieldset className="board-designer__fieldset">
      <legend>Add field</legend>
      <div className="board-designer__narrow">
        <TextField label="Field key" value={key} onChange={setKey} />
        <TextField label="Field label" value={label} onChange={setLabel} />
        <EnumSelect label="Field type" values={FIELD_TYPES} value={type} onChange={setType} />
        {type === "enum" ? (
          <EnumSelect
            label="Enumeration"
            values={allEnums().map((e) => e.id)}
            value={enumId}
            onChange={setEnumId}
          />
        ) : null}
        {type === "geometry" ? (
          <EnumSelect label="Geometry kind" values={GEOMETRY_KINDS} value={geometryKind}
            onChange={setGeometryKind} />
        ) : null}
        {type === "record_ref" ? <>
          <TextField label="Target template key" value={targetBoardKey} onChange={setTargetBoardKey} />
          <LabelFieldsInput label="Target label fields" value={labelKeys} onChange={setLabelKeys} />
        </> : null}
        <label className="eoc-inline">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Required
        </label>
        <EnumSelect label="Readable by" values={READ_LEVELS} value={read} onChange={setRead} />
        <EnumSelect label="Writable by" values={WRITE_LEVELS} value={write} onChange={setWrite} />
        <label className="board-designer__check">
          <input type="checkbox" checked={conditionEnabled} disabled={props.fields.length === 0}
            onChange={(event) => {
              setConditionEnabled(event.target.checked);
              if (event.target.checked && !conditionField) setConditionField(props.fields[0]?.key ?? "");
            }} />
          Show only when a condition matches
        </label>
        {conditionEnabled ? <div className="board-designer__grid board-designer__grid--3">
          <EnumSelect label="Condition field" values={props.fields.map((field) => field.key)}
            value={conditionField} onChange={setConditionField} />
          <EnumSelect label="Condition operator" values={["eq", "neq", "gt", "gte", "lt", "lte"]}
            value={conditionOp} onChange={setConditionOp} />
          <TextField label="Condition value" value={conditionValue} onChange={setConditionValue} />
        </div> : null}
        {type === "number" ? <>
          <label className="board-designer__check">
            <input type="checkbox" checked={calculationEnabled}
              disabled={!props.fields.some((field) => field.type === "number" && !field.calculation)}
              onChange={(event) => setCalculationEnabled(event.target.checked)} />
            Calculate from number fields
          </label>
          {calculationEnabled ? <div className="board-designer__stack">
            <EnumSelect label="Calculation" values={["sum", "subtract", "multiply", "divide"]}
              value={calculationOp} onChange={setCalculationOp} />
            <fieldset className="board-designer__checks"><legend>Calculation inputs</legend>
              {props.fields.filter((field) => field.type === "number" && !field.calculation).map((field) =>
                <label key={field.key} className="board-designer__check">
                  <input type="checkbox" checked={calculationInputs.includes(field.key)}
                    onChange={(event) => setCalculationInputs(event.target.checked
                      ? [...calculationInputs, field.key]
                      : calculationInputs.filter((value) => value !== field.key))} />
                  {field.label}
                </label>)}
            </fieldset>
          </div> : null}
        </> : null}
        <div>
          <Button onClick={add}>Add field</Button>
        </div>
      </div>
    </fieldset>
  );
}

function ViewEditor(props: { fieldKeys: readonly string[]; onAdd: (view: ViewDef) => void }) {
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [columns, setColumns] = useState<string[]>([]);

  function toggleColumn(field: string) {
    setColumns((c) => (c.includes(field) ? c.filter((x) => x !== field) : [...c, field]));
  }

  function add() {
    props.onAdd({ key, title, kind: "list", columns, filter: [] } as ViewDef);
    setKey("");
    setTitle("");
    setColumns([]);
  }

  return (
    <fieldset className="board-designer__fieldset">
      <legend>Add view</legend>
      <div className="board-designer__narrow">
        <TextField label="View key" value={key} onChange={setKey} />
        <TextField label="View title" value={title} onChange={setTitle} />
        <div role="group" aria-label="View columns">
          {props.fieldKeys.map((f) => (
            <label key={f} className="board-designer__column">
              <input
                type="checkbox"
                checked={columns.includes(f)}
                onChange={() => toggleColumn(f)}
              />
              {f}
            </label>
          ))}
        </div>
        <div>
          <Button onClick={add}>Add view</Button>
        </div>
      </div>
    </fieldset>
  );
}

function LayoutEditor(props: {
  title: string;
  fields: readonly FieldDef[];
  value: FormLayout | undefined;
  onChange: (value: FormLayout | undefined) => void;
}) {
  const sections = props.value?.sections ?? [];
  return <Panel title={props.title}>
    <p>Unassigned fields remain available under Additional details.</p>
    <div className="board-designer__stack">
      {sections.map((section, index) => {
        const usedElsewhere = new Set(sections.flatMap((item, itemIndex) => itemIndex === index ? [] : item.fields));
        const update = (next: typeof section) => props.onChange({
          sections: sections.map((item, itemIndex) => itemIndex === index ? next : item),
        });
        return <article className="board-designer__card" key={index}>
          <Input label={`${props.title} section ${index + 1} key`} value={section.key}
            onChange={(key) => update({ ...section, key })} />
          <Input label={`${props.title} section ${index + 1} title`} value={section.title}
            onChange={(title) => update({ ...section, title })} />
          <CheckGroup label={`${section.title} fields`} values={section.fields}
            options={props.fields.map((field) => ({ value: field.key, label: field.label,
              disabled: usedElsewhere.has(field.key) }))}
            onChange={(fields) => update({ ...section, fields })} />
          <ActionButton kind="danger" onClick={() => {
            const next = sections.filter((_, itemIndex) => itemIndex !== index);
            props.onChange(next.length ? { sections: next } : undefined);
          }}>Remove section</ActionButton>
        </article>;
      })}
      <ActionButton disabled={props.fields.length === 0} onClick={() => props.onChange({
        sections: [...sections, { key: uniqueKey("section", sections.map((section) => section.key)),
          title: "New section", fields: props.fields[0] ? [props.fields[0].key] : [] }],
      })}>Add section</ActionButton>
    </div>
  </Panel>;
}

function WorkflowEditor(props: {
  workflow: BoardWorkflow | undefined;
  fields: readonly FieldDef[];
  positions: readonly DesignerPositionOption[];
  onChange: (workflow: BoardWorkflow | undefined) => void;
}) {
  if (!props.workflow) return <Panel title="Workflow routing">
    <p>Records currently have no configured transitions, assignments, approvals, due rules, or escalations.</p>
    <ActionButton kind="primary" onClick={() => props.onChange(starterWorkflow())}>Enable routing</ActionButton>
  </Panel>;
  const workflow = props.workflow;
  const setState = (index: number, patch: Partial<BoardWorkflow["states"][number]>) => props.onChange({
    ...workflow, states: workflow.states.map((state, itemIndex) => itemIndex === index ? { ...state, ...patch } : state),
  });
  return <div className="board-designer__stack">
    <Panel title="Workflow states">
      <Select label="Initial state" value={workflow.initialState}
        options={workflow.states.map((state) => ({ value: state.key, label: state.label }))}
        onChange={(initialState) => props.onChange({ ...workflow, initialState })} />
      <div className="board-designer__stack">
        {workflow.states.map((state, index) => <div className="board-designer__rule" key={index}>
          <Input label={`State ${index + 1} key`} value={state.key} onChange={(key) => setState(index, { key })} />
          <Input label={`State ${index + 1} label`} value={state.label} onChange={(label) => setState(index, { label })} />
          <Check label="Terminal state" checked={state.terminal} onChange={(terminal) => setState(index, { terminal })} />
          <CheckGroup label={`Read-only while ${state.label}`} values={state.readOnlyFields ?? []}
            options={props.fields.filter((field) => !field.calculation).map((field) => ({ value: field.key, label: field.label }))}
            onChange={(keys) => props.onChange({ ...workflow, states: workflow.states.map((item, itemIndex) => {
              if (itemIndex !== index) return item;
              const { readOnlyFields: _dropped, ...rest } = item;
              return keys.length ? { ...rest, readOnlyFields: keys } : rest;
            }) })} />
          <ActionButton kind="danger" disabled={workflow.states.length < 2}
            onClick={() => props.onChange({ ...workflow,
              states: workflow.states.filter((_, itemIndex) => itemIndex !== index) })}>Remove</ActionButton>
        </div>)}
        <ActionButton onClick={() => props.onChange({ ...workflow, states: [...workflow.states, {
          key: uniqueKey("state", workflow.states.map((state) => state.key)), label: "New state", terminal: false,
        }] })}>Add state</ActionButton>
      </div>
    </Panel>
    <div className="board-designer__section-heading"><div><h3>Transitions</h3>
      <p>Authority is rechecked by the workflow runtime when a transition is requested.</p></div>
      <ActionButton disabled={workflow.states.length < 2} onClick={() => props.onChange({ ...workflow,
        transitions: [...workflow.transitions, starterTransition(workflow)] })}>Add transition</ActionButton></div>
    {workflow.transitions.map((transition, index) => <TransitionEditor key={index}
      index={index} transition={transition} workflow={workflow} fields={props.fields} positions={props.positions}
      onChange={(next) => props.onChange({ ...workflow,
        transitions: workflow.transitions.map((item, itemIndex) => itemIndex === index ? next : item) })}
      onRemove={() => props.onChange({ ...workflow,
        transitions: workflow.transitions.filter((_, itemIndex) => itemIndex !== index) })} />)}
    <ActionButton kind="danger" onClick={() => props.onChange(undefined)}>Remove workflow</ActionButton>
  </div>;
}

type Transition = BoardWorkflow["transitions"][number];

function TransitionEditor(props: {
  index: number;
  transition: Transition;
  workflow: BoardWorkflow;
  fields: readonly FieldDef[];
  positions: readonly DesignerPositionOption[];
  onChange: (transition: Transition) => void;
  onRemove: () => void;
}) {
  const transition = props.transition;
  const set = (patch: Partial<Transition>) => props.onChange({ ...transition, ...patch });
  const states = props.workflow.states.map((state) => ({ value: state.key, label: state.label }));
  const dueKind = transition.due?.kind ?? "none";
  return <Panel title={transition.label || `Transition ${props.index + 1}`}>
    <div className="board-designer__grid board-designer__grid--2">
      <Input label={`Transition ${props.index + 1} key`} value={transition.key} onChange={(key) => set({ key })} />
      <Input label={`Transition ${props.index + 1} label`} value={transition.label} onChange={(label) => set({ label })} />
      <Select label="From state" value={transition.from} options={states} onChange={(from) => set({ from })} />
      <Select label="To state" value={transition.to} options={states} onChange={(to) => set({ to })} />
    </div>
    <CheckGroup label="Allowed actors" values={transition.allowedActors}
      options={[{ value: "writer", label: "Board writer" },
        { value: "jurisdiction_admin", label: "Jurisdiction administrator" },
        { value: "assigned_position", label: "Assigned position" },
        { value: "incident_coordinator", label: "Incident coordinator" }]}
      onChange={(allowedActors) => set({ allowedActors: allowedActors as Transition["allowedActors"] })} />
    <AssignmentEditor label="Assign during this transition" value={transition.assignment}
      onChange={(assignment) => set({ assignment })} />
    <div className="board-designer__grid board-designer__grid--3">
      <Select label="Due rule" value={dueKind}
        options={[{ value: "none", label: "No due time" }, { value: "relative", label: "Relative time" },
          { value: "record_field", label: "Date/time field" }]}
        onChange={(kind) => set({ due: kind === "relative"
          ? { kind: "relative", minutes: 60, anchor: "transitioned" }
          : kind === "record_field"
            ? { kind: "record_field", field: props.fields.find((field) => field.type === "datetime")?.key ?? "" }
            : undefined })} />
      {transition.due?.kind === "relative" ? <>
        <NumberInput label="Due after minutes" value={transition.due.minutes}
          onChange={(minutes) => set({ due: { kind: "relative", minutes: minutes ?? 1,
            anchor: transition.due?.kind === "relative" ? transition.due.anchor : "transitioned" } })} />
        <Select label="Due anchor" value={transition.due.anchor}
          options={[{ value: "created", label: "Record creation" }, { value: "transitioned", label: "Transition time" }]}
          onChange={(anchor) => set({ due: { kind: "relative",
            minutes: transition.due?.kind === "relative" ? transition.due.minutes : 60,
            anchor: anchor as "created" | "transitioned" } })} />
      </> : null}
      {transition.due?.kind === "record_field" ? <Select label="Due date field" value={transition.due.field}
        options={props.fields.filter((field) => field.type === "datetime").map((field) => ({ value: field.key, label: field.label }))}
        onChange={(field) => set({ due: { kind: "record_field", field } })} /> : null}
    </div>
    <GuardEditor n={props.index + 1} fields={props.fields} value={transition.guard}
      onChange={(guard) => {
        const { guard: _dropped, ...rest } = transition;
        props.onChange(guard ? { ...rest, guard } : rest);
      }} />
    <ApprovalEditor value={transition.approvals} positions={props.positions}
      onChange={(approvals) => set({ approvals })} />
    <EscalationEditor value={transition.escalations} onChange={(escalations) => set({ escalations })} />
    <ActionButton kind="danger" onClick={props.onRemove}>Remove transition</ActionButton>
  </Panel>;
}

/**
 * A transition's guard: conditions on the record, all or any of which must
 * hold, and what to say when they do not. A condition still being typed is
 * left out of the saved guard until it is complete, and says so.
 */
function GuardEditor(props: {
  n: number;
  fields: readonly FieldDef[];
  value: Transition["guard"];
  onChange: (guard: Transition["guard"]) => void;
}) {
  const fields = props.fields.filter((field) => field.type !== "geometry");
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const [drafts, setDrafts] = useState<DraftCondition[]>(() => (props.value?.conditions ?? []).map(conditionDraft));
  const match = props.value?.match ?? "all";
  const message = props.value?.message ?? "";
  const emit = (next: DraftCondition[], nextMatch: "all" | "any", nextMessage: string) => {
    setDrafts(next);
    const conditions = next.flatMap((draft) => draftCondition(draft, byKey.get(draft.field)) ?? []);
    props.onChange(conditions.length ? {
      match: nextMatch, conditions, ...(nextMessage.trim() ? { message: nextMessage.trim() } : {}),
    } : undefined);
  };
  const incomplete = drafts.flatMap((draft, index) => draftCondition(draft, byKey.get(draft.field)) ? [] : [index + 1]);
  return <div className="board-designer__nested" role="group" aria-label={`Guard for transition ${props.n}`}>
    <Check label="Guard this transition with conditions on the record" checked={drafts.length > 0} disabled={fields.length === 0}
      onChange={(on) => emit(on ? [{ ...blankDraft(fields[0]!), op: "is_not_empty" }] : [], match, message)} />
    {drafts.length ? <>
      <Select label="The transition needs" value={match}
        options={[{ value: "all", label: "Every condition to hold" }, { value: "any", label: "Any condition to hold" }]}
        onChange={(next) => emit(drafts, next as "all" | "any", message)} />
      {drafts.map((draft, index) => <ConditionRow key={index} n={index + 1} draft={draft} fields={fields}
        onChange={(next) => emit(drafts.map((item, itemIndex) => itemIndex === index ? next : item), match, message)}
        onRemove={() => emit(drafts.filter((_, itemIndex) => itemIndex !== index), match, message)} />)}
      <div><ActionButton disabled={drafts.length >= 16}
        onClick={() => emit([...drafts, { ...blankDraft(fields[0]!), op: "is_not_empty" }], match, message)}>Add condition</ActionButton></div>
      <Input label="Said when the guard refuses (optional)" value={message} onChange={(next) => emit(drafts, match, next)} />
      {incomplete.length ? <p role="status">Condition {incomplete.join(", ")} is left out of the guard until its value is complete.</p> : null}
    </> : null}
  </div>;
}

function AssignmentEditor(props: {
  label: string;
  value: Transition["assignment"];
  onChange: (value: Transition["assignment"]) => void;
}) {
  return <div className="board-designer__nested">
    <Check label={props.label} checked={Boolean(props.value)}
      onChange={(enabled) => props.onChange(enabled ? { required: true, allowedTargets: ["position"] } : undefined)} />
    {props.value ? <>
      <Check label="Assignment required" checked={props.value.required}
        onChange={(required) => props.onChange({ ...props.value!, required })} />
      <CheckGroup label="Allowed assignment targets" values={props.value.allowedTargets}
        options={[{ value: "position", label: "Local position" },
          { value: "incident_participant", label: "Authorized incident participant" }]}
        onChange={(allowedTargets) => props.onChange({ ...props.value!,
          allowedTargets: allowedTargets as ("position" | "incident_participant")[] })} />
    </> : null}
  </div>;
}

function ApprovalEditor(props: {
  value: Transition["approvals"];
  positions: readonly DesignerPositionOption[];
  onChange: (value: Transition["approvals"]) => void;
}) {
  const update = (index: number, next: Transition["approvals"][number]) =>
    props.onChange(props.value.map((item, itemIndex) => itemIndex === index ? next : item));
  return <div className="board-designer__nested board-designer__stack">
    <div className="board-designer__section-heading"><h4>Approvals</h4>
      <ActionButton onClick={() => props.onChange([...props.value, {
        key: uniqueKey("approval", props.value.map((item) => item.key)), label: "Approval",
        approver: { kind: "jurisdiction_admin" }, count: 1, allowSelfApproval: false,
      }])}>Add approval</ActionButton></div>
    {props.value.map((approval, index) => <div className="board-designer__rule" key={index}>
      <Input label={`Approval ${index + 1} key`} value={approval.key} onChange={(key) => update(index, { ...approval, key })} />
      <Input label={`Approval ${index + 1} label`} value={approval.label} onChange={(label) => update(index, { ...approval, label })} />
      <Select label="Approver" value={approval.approver.kind}
        options={[{ value: "jurisdiction_admin", label: "Jurisdiction administrator" },
          { value: "incident_coordinator", label: "Incident coordinator" },
          ...(props.positions.length ? [{ value: "position_key", label: "Position" }] : [])]}
        onChange={(kind) => update(index, { ...approval, approver: kind === "position_key"
          ? { kind: "position_key", positionKey: props.positions[0]!.key }
          : kind === "incident_coordinator" ? { kind: "incident_coordinator" } : { kind: "jurisdiction_admin" } })} />
      {approval.approver.kind === "position_key" ? <Select label="Approver position"
        value={approval.approver.positionKey}
        options={props.positions.map((position) => ({ value: position.key, label: position.title }))}
        onChange={(positionKey) => update(index, { ...approval, approver: { kind: "position_key", positionKey } })} /> : null}
      <NumberInput label="Approvals required" value={approval.count} min={1} max={20}
        onChange={(count) => update(index, { ...approval, count: count ?? 1 })} />
      <Check label="Allow self approval" checked={approval.allowSelfApproval}
        onChange={(allowSelfApproval) => update(index, { ...approval, allowSelfApproval })} />
      <ActionButton kind="danger" onClick={() => props.onChange(props.value.filter((_, itemIndex) => itemIndex !== index))}>
        Remove approval
      </ActionButton>
    </div>)}
  </div>;
}

function EscalationEditor(props: {
  value: Transition["escalations"];
  onChange: (value: Transition["escalations"]) => void;
}) {
  const update = (index: number, next: Transition["escalations"][number]) =>
    props.onChange(props.value.map((item, itemIndex) => itemIndex === index ? next : item));
  return <div className="board-designer__nested board-designer__stack">
    <div className="board-designer__section-heading"><h4>Escalations</h4>
      <ActionButton onClick={() => props.onChange([...props.value, {
        key: uniqueKey("escalation", props.value.map((item) => item.key)), afterMinutes: 60, maxOccurrences: 1,
      }])}>Add escalation</ActionButton></div>
    {props.value.map((rule, index) => <div className="board-designer__rule" key={index}>
      <Input label={`Escalation ${index + 1} key`} value={rule.key} onChange={(key) => update(index, { ...rule, key })} />
      <NumberInput label="After minutes" value={rule.afterMinutes} onChange={(afterMinutes) => update(index,
        { ...rule, afterMinutes: afterMinutes ?? 1 })} />
      <NumberInput label="Maximum occurrences" value={rule.maxOccurrences} min={1} max={20}
        onChange={(maxOccurrences) => update(index, { ...rule, maxOccurrences: maxOccurrences ?? 1,
          ...((maxOccurrences ?? 1) > 1 && !rule.repeatEveryMinutes ? { repeatEveryMinutes: 60 } : {}) })} />
      {rule.maxOccurrences > 1 ? <NumberInput label="Repeat every minutes" value={rule.repeatEveryMinutes}
        onChange={(repeatEveryMinutes) => update(index, { ...rule, repeatEveryMinutes })} /> : null}
      <AssignmentEditor label="Reassign when escalated" value={rule.assignment}
        onChange={(assignment) => update(index, { ...rule, assignment })} />
      <ActionButton kind="danger" onClick={() => props.onChange(props.value.filter((_, itemIndex) => itemIndex !== index))}>
        Remove escalation
      </ActionButton>
    </div>)}
  </div>;
}

function DesignerPreview(props: {
  template: BoardTemplate | null;
  error: string | null;
  diff: ReturnType<typeof templateDiff> | null;
}) {
  const [mode, setMode] = useState("input");
  const [message, setMessage] = useState<string | null>(null);
  if (!props.template) return <Panel title="Review"><p>{props.error}</p></Panel>;
  const template = props.template;
  const record = syntheticRecord(template.fields);
  return <div className="board-designer__stack">
    <Panel title="Version review">
      {props.diff ? <p data-testid="diff">added: {props.diff.addedFields.join(", ") || "none"}; removed: {props.diff.removedFields.join(", ") || "none"}; changed: {props.diff.changedFields.join(", ") || "none"}</p>
        : <p>New template with {template.fields.length} fields and {template.views.length} views.</p>}
      <p>{template.workflow ? `${template.workflow.states.length} states and ${template.workflow.transitions.length} transitions configured.` : "No workflow routing configured."}</p>
    </Panel>
    <Panel title="Operator preview">
      <p>Preview data is synthetic and never saved.</p>
      <Tabs id="board-preview" label="Preview mode" value={mode} onChange={setMode}
        tabs={[{ id: "input", label: "Input" }, { id: "list", label: "List" }, { id: "detail", label: "Detail" }]} />
      <div className="board-designer__preview" role="tabpanel" id={`board-preview-${mode}-panel`} aria-labelledby={`board-preview-${mode}-tab`}>
        {mode === "input" ? <RecordForm fields={template.fields}
          {...(template.inputLayout ? { layout: template.inputLayout } : {})}
          submitLabel="Validate preview" onSubmit={async () => setMessage("Preview values are valid. Nothing was saved.")} /> : null}
        {mode === "list" ? <BoardView template={template} viewKey={template.views[0]!.key}
          records={[{ id: "preview", ...record }]} /> : null}
        {mode === "detail" ? <DetailPreview template={template} record={record} /> : null}
      </div>
      {message ? <p role="status">{message}</p> : null}
    </Panel>
  </div>;
}

function DetailPreview(props: { template: BoardTemplate; record: Record<string, unknown> }) {
  const sections = props.template.detailLayout?.sections ?? [{ key: "details", title: "Details",
    fields: props.template.fields.map((field) => field.key) }];
  const fieldMap = new Map(props.template.fields.map((field) => [field.key, field]));
  return <div>{sections.map((section) => <section key={section.key}><h4>{section.title}</h4>
    <dl className="board-designer__detail">{section.fields.map((key) => <div key={key}>
      <dt>{fieldMap.get(key)?.label ?? key}</dt><dd>{formatValue(props.record[key])}</dd>
    </div>)}</dl></section>)}</div>;
}

type ImportKind = "template" | "form" | "dashboard" | "package";

/** A solution package import in sentences: what it created, what was already here, and what the instance kept as its own. */
export function packageSummary(summary: SolutionImportSummary): string {
  const created = SOLUTION_PARTS.flatMap(([part, name]) => summary.parts[part].created.length
    ? [`${name} ${summary.parts[part].created.join(", ")}`] : []);
  const held = SOLUTION_PARTS.reduce((n, [part]) => n + summary.parts[part].held.length, 0);
  const kept = SOLUTION_PARTS.flatMap(([part]) => summary.parts[part].kept);
  return [
    `Package ${summary.name} ${summary.version} from ${summary.publisher}, signed with key ${summary.keyFingerprint.slice(0, 16)}.`,
    created.length ? `Created ${created.join("; ")}.` : "Nothing new.",
    ...(held ? [`${held} ${held === 1 ? "item was" : "items were"} already here.`] : []),
    ...(kept.length ? [`Kept this instance's own incident template ${kept.join(", ")}; edit it to take the package's.`] : []),
  ].join(" ");
}

/**
 * Imports from files through the existing routes. JSON is checked against the
 * shared schema first so a malformed file names its fields; the server's own
 * refusal (an existing version, missing authority, an unreadable workbook) is
 * shown as it answers.
 */
function DefinitionImport(props: { client: ApiClient; jurisdictionId: string }) {
  const [imported, setImported] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The instance's record of signed packages; read by instance administrators, so anyone else sees none.
  const packages = useAsync(() => props.client.listSolutionPackages(), [props.client]);

  async function pick(kind: ImportKind, input: HTMLInputElement) {
    const file = input.files?.[0];
    // Cleared so the same file can be chosen again after it is corrected.
    input.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const line = await importDefinition(props.client, props.jurisdictionId, kind, file);
      setImported((list) => [...list, line]);
      if (line.startsWith("Package ")) packages.reload();
    } catch (reason) {
      setError(`${file.name}: ${reason instanceof Error ? reason.message : "the import failed."}`);
    } finally {
      setBusy(false);
    }
  }

  const picker = (kind: ImportKind, label: string, accept: string) =>
    <label className="board-designer__control"><span>{label}</span>
      {/* A file input's own minimum width would otherwise overflow its column. */}
      <input type="file" accept={accept} disabled={busy} className="board-designer__file"
        onChange={(event) => void pick(kind, event.currentTarget)} /></label>;
  return <Panel title="Import definitions">
    <div className="board-designer__stack">
      <p>A board template is its JSON definition or a signed template package. A form is an XLSForm workbook,
        whose file name becomes the form key, or form definition JSON. A dashboard template is its JSON
        definition, as its export gives it. Each import adds a version and changes no existing board.</p>
      <p>A signed solution package carries board, incident, dashboard, report and rule templates and forms in one
        file, signed by a publisher this instance trusts. Its forms join the selected jurisdiction; the rest
        join the instance. Nothing already here is replaced, and a package that conflicts with what is here
        imports nothing.</p>
      <div className="board-designer__grid board-designer__grid--3">
        {picker("template", "Board template file", ".json,application/json")}
        {picker("form", "Form file", ".xlsx,.json,application/json")}
        {picker("dashboard", "Dashboard template file", ".json,application/json")}
        {picker("package", "Signed solution package", ".json,application/json")}
      </div>
      {busy ? <p role="status">Importing…</p> : null}
      {error ? <p role="alert" className="board-designer__error">{error}</p> : null}
      {imported.length ? <section>
        <h4>Imported</h4>
        <ul aria-label="Imported definitions">
          {imported.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      </section> : null}
      {packages.data?.length ? <section>
        <h4>Signed packages on this instance</h4>
        <ul aria-label="Signed packages on this instance">
          {packages.data.map((pkg) => <li key={pkg.id}>
            {pkg.name} {pkg.version} from {pkg.publisher}, key {pkg.keyFingerprint.slice(0, 16)}: imported
            {" "}<time dateTime={pkg.importedAt}>{new Date(pkg.importedAt).toLocaleString()}</time> by {pkg.importedBy}
          </li>)}
        </ul>
      </section> : null}
    </div>
  </Panel>;
}

async function importDefinition(client: ApiClient, jurisdictionId: string, kind: ImportKind, file: File): Promise<string> {
  if (kind === "form" && /\.xlsx$/i.test(file.name)) {
    const key = file.name.replace(/\.xlsx$/i, "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^[^a-z]+/, "");
    const result = await client.importXlsForm(jurisdictionId, { key, xlsxBase64: await toBase64(file) });
    return `Form ${result.key}, version ${result.version}`;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    throw new Error("the file is not valid JSON.");
  }
  const format = (raw as { format?: unknown } | null)?.format;
  if (format === "openeoc-package-v2") {
    return packageSummary(await client.importSolutionPackage(jurisdictionId, raw as Record<string, unknown>));
  }
  if (kind === "package") throw new Error("the file is not a signed solution package (format openeoc-package-v2).");
  if (kind === "template" && format === "openeoc-templates-v1") {
    const count = await client.importTemplatePackage(raw as Record<string, unknown>);
    return `Template package ${file.name}, ${count} new ${count === 1 ? "version" : "versions"}`;
  }
  if (kind === "template") {
    const template = BoardTemplateSchema.safeParse(raw);
    if (!template.success) throw new Error(describeIssues(template.error.issues, "template"));
    const result = await client.publishTemplate(template.data);
    return `Board template ${template.data.title} (${result.key}), version ${result.version}`;
  }
  if (kind === "form") {
    const form = FormDefinitionSchema.safeParse(raw);
    if (!form.success) throw new Error(describeIssues(form.error.issues, "form"));
    const result = await client.importForm(jurisdictionId, form.data);
    return `Form ${form.data.title} (${result.key}), version ${result.version}`;
  }
  const dashboard = DashboardTemplateSchema.safeParse(raw);
  if (!dashboard.success) throw new Error(describeIssues(dashboard.error.issues, "dashboard template"));
  const result = await client.importDashboardTemplate(dashboard.data);
  return `Dashboard template ${dashboard.data.title} (${result.key}), version ${result.version}`;
}

const LOCAL_TYPES = FIELD_TYPES.filter((type) => type !== "record_ref");
const levelOptions = (levels: readonly string[]) => levels.map((value) => ({ value, label: value }));

/**
 * Local fields: `x_` fields an administrator adds to one board at once,
 * outside any template version. They are never required, and a later
 * template version adding a field of the same name replaces them.
 */
function LocalFields(props: { client: ApiClient; boardId: string }) {
  const board = useAsync(() => props.client.getBoard(props.boardId), [props.boardId]);
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<string>("text");
  const [values, setValues] = useState("");
  const [geometryKind, setGeometryKind] = useState<string>("any");
  const [read, setRead] = useState<string>("any");
  const [write, setWrite] = useState<string>("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const trimmed = key.trim();
  const fullKey = trimmed && !trimmed.startsWith("x_") ? `x_${trimmed}` : trimmed;
  const locals = (board.data?.fields ?? []).filter((field) => field.key.startsWith("x_"));

  async function add() {
    setError(null);
    setAdded(null);
    const parsed = LocalFieldSchema.safeParse({
      key: fullKey, label, type, required: false, read, write,
      ...(type === "enum" ? { values: values.split(",").map((value) => value.trim()).filter(Boolean) } : {}),
      ...(type === "geometry" ? { geometryKind } : {}),
    });
    if (!parsed.success) {
      setError(describeIssues(parsed.error.issues, "local field"));
      return;
    }
    setBusy(true);
    try {
      await props.client.addLocalField(props.boardId, parsed.data);
      setAdded(parsed.data.key);
      setKey(""); setLabel(""); setValues("");
      board.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The local field was not added.");
    } finally {
      setBusy(false);
    }
  }

  return <Panel title="Local fields">
    <div className="board-designer__stack">
      <p>A local field is added to this board now, without publishing a template version. Its key starts
        with <code>x_</code>, it is never required, and a later template version that adds a field of the same
        name replaces it. Record rules, conditions, calculations and references need a template version.</p>
      {board.error ? <p role="alert">{board.error}</p> : null}
      {locals.length ? <ul aria-label="Local fields on this board">
        {locals.map((field) => <li key={field.key}><strong>{field.label}</strong> <code>{field.key}: {field.type}</code></li>)}
      </ul> : board.data ? <p>This board has no local fields.</p> : null}
      <div className="board-designer__grid board-designer__grid--3">
        <Input label="Local field key" value={key} onChange={setKey} />
        <Input label="Local field label" value={label} onChange={setLabel} />
        <Select label="Local field type" value={type} options={levelOptions(LOCAL_TYPES)} onChange={setType} />
        {type === "enum" ? <Input label="Allowed values, separated by commas" value={values} onChange={setValues} /> : null}
        {type === "geometry" ? <Select label="Local geometry kind" value={geometryKind}
          options={levelOptions(GEOMETRY_KINDS)} onChange={setGeometryKind} /> : null}
        <Select label="Local field readable by" value={read} options={levelOptions(READ_LEVELS)} onChange={setRead} />
        <Select label="Local field writable by" value={write} options={levelOptions(WRITE_LEVELS)} onChange={setWrite} />
      </div>
      {fullKey ? <p>Saved as <code>{fullKey}</code>.</p> : null}
      {error ? <p role="alert" className="board-designer__error">{error}</p> : null}
      {added ? <p role="status">Added {added} to this board.</p> : null}
      <div><ActionButton kind="primary" loading={busy} disabled={busy} onClick={() => void add()}>Add local field</ActionButton></div>
    </div>
  </Panel>;
}

/** Target field keys for a reference label, typed as a comma list; up to four, in display order. */
function LabelFieldsInput(props: { label: string; value: readonly string[]; onChange: (keys: string[]) => void }) {
  const hintId = useId();
  const [raw, setRaw] = useState(props.value.join(", "));
  const parse = (text: string) => text.split(",").map((item) => item.trim()).filter(Boolean);
  // A change from outside, such as the reset after adding a field, replaces the typed text.
  const shown = parse(raw).join(",") === props.value.join(",") ? raw : props.value.join(", ");
  return <div className="board-designer__stack">
    <label className="board-designer__control"><span>{props.label}</span>
      <input value={shown} aria-describedby={hintId} onChange={(event) => {
        setRaw(event.target.value);
        props.onChange(parse(event.target.value));
      }} />
    </label>
    <small id={hintId} className="board-designer__field-note">
      Up to four target field keys, in display order, separated by commas. The label joins their values with &quot; / &quot;.
    </small>
  </div>;
}

/** A reference's label keys as a template stores them: one as `labelField`, several as `labelFields`. */
function withLabelKeys<T extends object>(field: T, keys: readonly string[]): T {
  const rest = { ...field } as T & { labelField?: string; labelFields?: string[] };
  delete rest.labelField;
  delete rest.labelFields;
  if (keys.length === 1) return { ...rest, labelField: keys[0]! };
  return keys.length ? { ...rest, labelFields: [...keys] } : rest;
}

async function toBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function describeIssues(issues: readonly { path: readonly PropertyKey[]; message: string }[], subject: string): string {
  return issues.map((issue) => `${issue.path.map(String).join(".") || subject}: ${issue.message}`).join("; ");
}

function Input(props: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="board-designer__control"><span>{props.label}</span>
    <input value={props.value} onChange={(event) => props.onChange(event.target.value)} />
  </label>;
}

function NumberInput(props: {
  label: string; value: number | undefined; min?: number; max?: number;
  onChange: (value: number | undefined) => void;
}) {
  return <label className="board-designer__control"><span>{props.label}</span>
    <input type="number" min={props.min ?? 1} max={props.max} value={props.value ?? ""}
      onChange={(event) => props.onChange(event.target.value ? Number(event.target.value) : undefined)} />
  </label>;
}

function Select(props: {
  label: string; value: string; options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return <label className="board-designer__control"><span>{props.label}</span>
    <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
      {props.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}

function Check(props: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="board-designer__check"><input type="checkbox" checked={props.checked}
    disabled={props.disabled} onChange={(event) => props.onChange(event.target.checked)} />{props.label}</label>;
}

function CheckGroup(props: {
  label: string; values: readonly string[];
  options: readonly { value: string; label: string; disabled?: boolean }[];
  onChange: (values: string[]) => void;
}) {
  return <fieldset className="board-designer__checks"><legend>{props.label}</legend>
    {props.options.map((option) => <Check key={option.value} label={option.label}
      checked={props.values.includes(option.value)} disabled={option.disabled ?? false}
      onChange={(checked) => props.onChange(checked ? [...props.values, option.value]
        : props.values.filter((value) => value !== option.value))} />)}
  </fieldset>;
}

function starterWorkflow(): BoardWorkflow {
  return { initialState: "new",
    states: [{ key: "new", label: "New", terminal: false }, { key: "complete", label: "Complete", terminal: true }],
    transitions: [{ key: "complete", label: "Complete", from: "new", to: "complete",
      allowedActors: ["writer"], approvals: [], escalations: [] }] };
}

function starterTransition(workflow: BoardWorkflow): Transition {
  const from = workflow.states.find((state) => !state.terminal) ?? workflow.states[0]!;
  const to = workflow.states.find((state) => state.key !== from.key) ?? workflow.states[0]!;
  return { key: uniqueKey("transition", workflow.transitions.map((item) => item.key)), label: "New transition",
    from: from.key, to: to.key, allowedActors: ["writer"], approvals: [], escalations: [] };
}

function uniqueKey(base: string, keys: readonly string[]) {
  let candidate = base;
  let suffix = 2;
  while (keys.includes(candidate)) candidate = `${base}_${suffix++}`;
  return candidate;
}

function syntheticRecord(fields: readonly FieldDef[]): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.calculation) continue;
    if (field.type === "text") record[field.key] = "Example";
    else if (field.type === "number") record[field.key] = 12;
    else if (field.type === "boolean") record[field.key] = true;
    else if (field.type === "datetime") record[field.key] = "2026-09-21T12:00:00Z";
    else if (field.type === "enum") record[field.key] = field.values?.[0]
      ?? allEnums().find((item) => item.id === field.enumId)?.values[0] ?? "Unknown";
    else record[field.key] = "Configured value";
  }
  return record;
}

function formatValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "Unavailable";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return "Configured value";
  return String(value);
}

function displayFilterValue(value: ViewDef["filter"][number]["value"]): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function parseFilterValue(field: FieldDef | undefined, op: "eq" | "neq" | "in", raw: string) {
  if (op === "in") return raw.split(",").map((value) => value.trim()).filter(Boolean);
  if (field?.type === "number") {
    const value = Number(raw);
    return Number.isFinite(value) ? value : raw;
  }
  if (field?.type === "boolean") return raw === "true";
  return raw;
}
