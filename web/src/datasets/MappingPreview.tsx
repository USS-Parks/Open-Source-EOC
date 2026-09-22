import type { FieldMapping } from "@openeoc/shared";

const FIELD_LABELS: Readonly<Record<keyof FieldMapping, string>> = {
  title: "Title",
  category: "Category",
  severity: "Severity",
  occurredAt: "Occurred at",
  status: "Status",
  note: "Note",
  sourceId: "Source identity",
  geometry: "Geometry",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS) as Array<keyof FieldMapping>;

export function MappingPreview(props: {
  readonly mapping: FieldMapping;
  readonly emptyLabel?: string;
}) {
  const entries = FIELD_ORDER.flatMap((field) => {
    const path = props.mapping[field];
    return path ? [{ field, path }] : [];
  });

  if (entries.length === 0) {
    return <p className="d21-muted">{props.emptyLabel ?? "No fields mapped."}</p>;
  }

  return (
    <div className="d21-mapping" aria-label="Field mapping preview">
      <div className="d21-mapping-head"><span>Normalized field</span><span>Source path</span></div>
      {entries.map(({ field, path }) => (
        <div className="d21-mapping-row" key={field}>
          <span>{FIELD_LABELS[field]}</span>
          <code>{path}</code>
        </div>
      ))}
    </div>
  );
}
