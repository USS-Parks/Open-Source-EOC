import { useMemo, useState } from "react";
import {
  choicesFor,
  FORM_MEDIA_CONTENT_TYPES,
  MEDIA_QUESTION_TYPES,
  runForm,
  submission,
  type AnswerRecord,
  type Choice,
  type FormDefinition,
  type FormField,
  type FormNode,
  type SignatureValue,
} from "@openeoc/shared";
import { ActionButton } from "../design/controls.js";
import { SignatureInput } from "../design/signature.js";
import { MAX_ATTACHMENT_BYTES, type FieldAttachment } from "./field-submissions.js";
import { GeometryCapture } from "./GeometryCapture.js";

/** Read a barcode or QR code from a camera image where the browser has BarcodeDetector; null when it cannot. */
async function detectBarcode(file: File): Promise<string | null> {
  const api = globalThis as typeof globalThis & {
    BarcodeDetector?: new () => { detect(source: ImageBitmap): Promise<Array<{ rawValue?: string }>> };
  };
  if (!api.BarcodeDetector) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const [result] = await new api.BarcodeDetector().detect(bitmap);
    return result?.rawValue?.trim() || null;
  } finally {
    bitmap.close();
  }
}

/**
 * Photo and audio answers hold a local token until the report is queued;
 * this swaps each relevant one for its file's name and lists the files to
 * queue with the report, keyed by the question path they answer.
 */
export function mediaAttachments(
  definition: FormDefinition,
  answers: AnswerRecord,
  media: ReadonlyMap<string, File>,
): { readonly answers: AnswerRecord; readonly files: FieldAttachment[] } {
  const files: FieldAttachment[] = [];
  const walk = (nodes: readonly FormNode[], values: AnswerRecord, prefix: string): void => {
    for (const node of nodes) {
      if (node.kind === "group") walk(node.children, values, prefix);
      else if (node.kind === "repeat") {
        const entries = values[node.name];
        if (Array.isArray(entries)) entries.forEach((entry, index) =>
          walk(node.children, entry as AnswerRecord, `${prefix}${node.name}[${index}].`));
      } else if (node.kind === "field" && MEDIA_QUESTION_TYPES.has(node.type)) {
        const file = media.get(String(values[node.name]));
        if (file) {
          files.push({ question: `${prefix}${node.name}`, file });
          values[node.name] = file.name;
        }
      }
    }
  };
  const relevant = submission(definition, answers);
  walk(definition.nodes, relevant, "");
  return { answers: relevant, files };
}

interface ControlProps {
  readonly id: string;
  readonly field: FormField;
  readonly value: AnswerRecord[string];
  readonly choices: readonly Choice[];
  readonly error?: string | undefined;
  readonly media: ReadonlyMap<string, File>;
  readonly onMedia: (token: string, file: File) => void;
  readonly onChange: (value: AnswerRecord[string]) => void;
}

function MediaControl(props: ControlProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const kind = props.field.type === "audio" ? "audio" : "image";
  const label = props.field.label ?? props.field.name;
  const file = props.media.get(String(props.value ?? ""));
  return (
    <div className="eoc-field-media">
      <label htmlFor={props.id}>{label}{props.field.required ? " *" : ""}
        <input id={props.id} type="file" accept={`${kind}/*`} capture={kind === "image" ? "environment" : "user"}
          aria-describedby={props.error ? `${props.id}-error` : undefined} onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (!picked) return;
            const allowed: readonly string[] = FORM_MEDIA_CONTENT_TYPES[kind];
            if (!allowed.includes(picked.type)) {
              setProblem(`Choose ${kind === "image" ? "a PNG, JPEG or GIF image" : "an MP3, M4A, AAC, Ogg, WebM or WAV recording"}.`);
              return;
            }
            if (picked.size > MAX_ATTACHMENT_BYTES) {
              setProblem(`Choose a file of at most ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB.`);
              return;
            }
            const token = crypto.randomUUID();
            setProblem(null);
            props.onMedia(token, picked);
            props.onChange(token);
          }} />
      </label>
      <small>{file ? `Attached: ${file.name}. It uploads after the report synchronizes.`
        : kind === "image" ? "Take a photo or choose an image." : "Record or choose an audio file."}</small>
      {file ? <ActionButton kind="quiet" onClick={() => props.onChange(undefined)}>Remove {label}</ActionButton> : null}
      {problem ? <small role="alert">{problem}</small> : null}
      {props.error ? <small id={`${props.id}-error`} role="alert">{props.error}</small> : null}
    </div>
  );
}

/**
 * An image question with the signature appearance: drawn on a pad, kept on
 * the device with the report, and uploaded when the report synchronizes, as
 * a photo is.
 */
function SignatureCapture(props: ControlProps) {
  const label = props.field.label ?? props.field.name;
  const [signed, setSigned] = useState<SignatureValue | null>(null);
  const kept = props.media.has(String(props.value ?? ""));
  return (
    <div className="eoc-field-media">
      <SignatureInput id={props.id} label={`${label}${props.field.required ? " *" : ""}`} disabled={false}
        value={kept && signed ? signed : undefined} describedBy={props.error ? `${props.id}-error` : undefined}
        onUpload={async (drawn) => {
          const token = crypto.randomUUID();
          props.onMedia(token, drawn);
          return token;
        }}
        onChange={(value) => { setSigned(value ?? null); props.onChange(value?.fileId); }}
        onPendingChange={() => undefined} />
      {kept ? <small>The signature uploads after the report synchronizes.</small> : null}
      {props.error ? <small id={`${props.id}-error`} role="alert">{props.error}</small> : null}
    </div>
  );
}

function BarcodeControl(props: ControlProps) {
  const [problem, setProblem] = useState<string | null>(null);
  const label = props.field.label ?? props.field.name;
  return (
    <div className="eoc-field-barcode">
      <label htmlFor={props.id}>{label}{props.field.required ? " *" : ""}
        <input id={props.id} autoComplete="off" value={String(props.value ?? "")}
          aria-describedby={props.error ? `${props.id}-error` : undefined}
          onChange={(event) => props.onChange(event.target.value || undefined)} />
      </label>
      <label className="eoc-field-camera">Scan {label}
        <input type="file" accept="image/*" capture="environment" onChange={(event) => {
          const picked = event.target.files?.[0];
          event.target.value = "";
          if (!picked) return;
          setProblem(null);
          void detectBarcode(picked)
            .then((code) => code ? props.onChange(code) : setProblem("This browser could not read the code. Enter it manually."))
            .catch(() => setProblem("This image could not be read. Enter the code manually."));
        }} />
      </label>
      {problem ? <small role="alert">{problem}</small> : null}
      {props.error ? <small id={`${props.id}-error`} role="alert">{props.error}</small> : null}
    </div>
  );
}

function FieldControl(props: ControlProps) {
  const { id, field } = props;
  const label = field.label ?? field.name;
  const describedBy = props.error ? `${id}-error` : undefined;
  const errorNote = props.error ? <small id={`${id}-error`} role="alert">{props.error}</small> : null;

  if (field.type === "note") return <p className="eoc-field-note">{label}</p>;
  if (field.type === "calculate") return (
    <div className="eoc-field-calculation"><span>{label}</span><output>{String(props.value ?? "Pending inputs")}</output></div>
  );
  if (field.type === "image" && field.signature) return <SignatureCapture {...props} />;
  if (field.type === "image" || field.type === "audio") return <MediaControl {...props} />;
  if (field.type === "barcode") return <BarcodeControl {...props} />;
  if (field.type === "geotrace" || field.type === "geoshape") return (
    <GeometryCapture id={id} field={field} value={props.value} error={props.error} onChange={props.onChange} />
  );
  if (field.type === "select_multiple") {
    const selected = Array.isArray(props.value) ? props.value as string[] : [];
    return (
      <fieldset className="eoc-field-choices" aria-describedby={describedBy}>
        <legend>{label}{field.required ? " *" : ""}</legend>
        {props.choices.map((choice) => <label key={choice.name}>
          <input type="checkbox" checked={selected.includes(choice.name)} onChange={(event) => {
            const next = event.target.checked
              ? [...selected, choice.name]
              : selected.filter((item) => item !== choice.name);
            props.onChange(next.length ? next : undefined);
          }} />{choice.label}
        </label>)}
        {errorNote}
      </fieldset>
    );
  }
  if (field.type === "select_one") {
    // A cascading select hides an answer its parent no longer allows; the runner reports it.
    const current = props.choices.some((choice) => choice.name === props.value) ? String(props.value) : "";
    return (
      <label htmlFor={id}>{label}{field.required ? " *" : ""}
        <select id={id} value={current} aria-describedby={describedBy}
          onChange={(event) => props.onChange(event.target.value || undefined)}>
          <option value="">Choose an option</option>
          {props.choices.map((choice) => <option key={choice.name} value={choice.name}>{choice.label}</option>)}
        </select>
        {errorNote}
      </label>
    );
  }
  if (field.type === "geopoint") return (
    <fieldset className="eoc-field-location" aria-describedby={describedBy}>
      <legend>{label}{field.required ? " *" : ""}</legend>
      <label htmlFor={`${id}-coordinates`}>Latitude and longitude
        <input id={`${id}-coordinates`} inputMode="decimal" placeholder="34.0522 -118.2437"
          value={String(props.value ?? "")} onChange={(event) => props.onChange(event.target.value || undefined)} />
      </label>
      <ActionButton kind="secondary" onClick={() => navigator.geolocation.getCurrentPosition(
        (position) => props.onChange(`${position.coords.latitude} ${position.coords.longitude}`),
        () => props.onChange(props.value),
        { enableHighAccuracy: true, timeout: 10000 },
      )}>Use current location</ActionButton>
      {errorNote}
    </fieldset>
  );

  const type = field.type === "integer" || field.type === "decimal" ? "number"
    : field.type === "datetime" ? "datetime-local"
      : ["date", "time"].includes(field.type) ? field.type : "text";
  return (
    <label htmlFor={id}>{label}{field.required ? " *" : ""}
      <input id={id} type={type} inputMode={type === "number" ? "decimal" : undefined}
        value={String(props.value ?? "")} aria-describedby={describedBy} onChange={(event) => {
          const raw = event.target.value;
          props.onChange(type === "number" ? (raw === "" ? undefined : Number(raw)) : raw || undefined);
        }} />
      {errorNote}
    </label>
  );
}

/** One answer scope: the top of the form or one repeat entry. */
interface Scope {
  /** Answers as entered, which edits replace. */
  readonly raw: AnswerRecord;
  /** Answers after calculations, which the controls show. */
  readonly shown: AnswerRecord;
  /** Enclosing and own answers, which choice filters read. */
  readonly context: AnswerRecord;
  readonly prefix: string;
  readonly set: (next: AnswerRecord) => void;
}

interface TreeProps {
  readonly nodes: readonly FormNode[];
  readonly scope: Scope;
  readonly visible: ReadonlySet<string>;
  readonly errors: ReadonlyMap<string, string>;
  readonly media: ReadonlyMap<string, File>;
  readonly onMedia: (token: string, file: File) => void;
}

const records = (value: unknown): AnswerRecord[] =>
  Array.isArray(value) ? value.filter((item): item is AnswerRecord => typeof item === "object" && item !== null) : [];
const domId = (path: string): string => path.replace(/[^A-Za-z0-9_-]/g, "-");

function NodeTree(props: TreeProps) {
  const { scope } = props;
  return <>{props.nodes.map((node) => {
    const path = `${scope.prefix}${node.name}`;
    if (node.kind === "field") {
      if (node.type !== "note" && !props.visible.has(path)) return null;
      return <FieldControl key={path} id={`field-${domId(path)}`} field={node}
        value={scope.shown[node.name]} choices={choicesFor(node, scope.context)} error={props.errors.get(path)}
        media={props.media} onMedia={props.onMedia}
        onChange={(value) => scope.set({ ...scope.raw, [node.name]: value })} />;
    }
    if (!props.visible.has(path)) return null;
    const label = node.label ?? node.name;
    if (node.kind === "group") return (
      <fieldset key={path} className="eoc-field-group">
        <legend>{label}</legend>
        <div className="eoc-field-controls"><NodeTree {...props} nodes={node.children} /></div>
      </fieldset>
    );
    const entries = records(scope.raw[node.name]);
    const shown = records(scope.shown[node.name]);
    const setEntries = (next: AnswerRecord[]) => scope.set({ ...scope.raw, [node.name]: next });
    const errorId = `repeat-${domId(path)}-error`;
    return (
      <fieldset key={path} className="eoc-field-repeat" aria-describedby={props.errors.has(path) ? errorId : undefined}>
        <legend>{label}</legend>
        {entries.map((entry, index) => {
          const entryShown = shown[index] ?? entry;
          return (
            <section key={index} className="eoc-field-repeat-entry" aria-label={`${label} ${index + 1}`}>
              <header><strong>{label} {index + 1}</strong>
                <ActionButton kind="quiet" onClick={() => setEntries(entries.filter((_, k) => k !== index))}>Remove {label} {index + 1}</ActionButton>
              </header>
              <div className="eoc-field-controls">
                <NodeTree {...props} nodes={node.children} scope={{
                  raw: entry, shown: entryShown, context: { ...scope.context, ...entryShown },
                  prefix: `${path}[${index}].`,
                  set: (next) => setEntries(entries.map((item, k) => k === index ? next : item)),
                }} />
              </div>
            </section>
          );
        })}
        <ActionButton kind="secondary" onClick={() => setEntries([...entries, {}])}>Add {label}</ActionButton>
        {props.errors.has(path) ? <small id={errorId} role="alert">{props.errors.get(path)}</small> : null}
      </fieldset>
    );
  })}</>;
}

/** The form as touch controls, groups and repeat entries nested, relevance and errors from the runner. */
export function FieldCaptureFields(props: {
  readonly definition: FormDefinition;
  readonly answers: AnswerRecord;
  readonly media: ReadonlyMap<string, File>;
  readonly onMedia: (token: string, file: File) => void;
  readonly onChange: (answers: AnswerRecord) => void;
}) {
  const result = useMemo(() => runForm(props.definition, props.answers), [props.answers, props.definition]);
  const visible = useMemo(() => new Set(result.visible), [result]);
  const errors = useMemo(() => new Map(result.errors.map((error) => [error.field, error.message])), [result]);
  return <div className="eoc-field-controls">
    <NodeTree nodes={props.definition.nodes} visible={visible} errors={errors} media={props.media} onMedia={props.onMedia}
      scope={{ raw: props.answers, shown: result.values, context: result.values, prefix: "", set: props.onChange }} />
  </div>;
}
