import type { CatalogEntryStatus } from "@openeoc/shared";
import { Button, StatusBadge } from "../design/components.js";
import { Icon } from "../design/icons/index.js";
import { MappingPreview } from "./MappingPreview.js";
import { formatDuration } from "./format.js";

export function DatasetCatalog(props: {
  readonly sources: readonly CatalogEntryStatus[];
  readonly canManage: boolean;
  readonly onboarding: string | null;
  readonly onOnboard: (sourceId: string) => void;
}) {
  if (props.sources.length === 0) {
    return <p className="d21-muted">No catalog entries are configured.</p>;
  }

  return (
    <ul className="d21-card-grid d21-catalog" aria-label="California source catalog">
      {props.sources.map((source) => {
        const usable = source.available && source.coversIncident;
        return (
          <li className="d21-card" data-source-id={source.id} key={source.id}>
            <header className="d21-card-header">
              <span className="d21-card-icon"><Icon name="source" size={20} decorative /></span>
              <div><strong>{source.name}</strong><span>{source.owner}</span></div>
              {source.onboarded ? <StatusBadge status="success">Registered</StatusBadge>
                : !source.available ? <StatusBadge status="critical">Integration unavailable</StatusBadge>
                  : source.coversIncident ? <StatusBadge status="info">Covers incident</StatusBadge>
                    : <StatusBadge status="warning">Outside incident area</StatusBadge>}
            </header>
            <dl className="d21-facts">
              <div><dt>Coverage</dt><dd>{source.coverage.label}</dd></div>
              <div><dt>Update</dt><dd>{source.refreshMethod}{source.cadenceSeconds ? ` · every ${formatDuration(source.cadenceSeconds)}` : " · on demand"}</dd></div>
              <div><dt>Format</dt><dd>{source.kind.toUpperCase()}</dd></div>
              <div><dt>License</dt><dd>{source.license}</dd></div>
            </dl>
            {source.notes ? <p className="d21-callout">{source.notes}</p> : null}
            <details>
              <summary>Mapping preview</summary>
              <MappingPreview mapping={source.fieldMapping} />
            </details>
            <footer className="d21-card-actions">
              {source.onboarded ? <span className="d21-muted">Catalog registration is present; ingestion readiness is shown below.</span> : null}
              {props.canManage && !source.onboarded ? (
                <Button onClick={() => props.onOnboard(source.id)} disabled={!usable || props.onboarding === source.id}>
                  {!source.available ? "Adapter unavailable" : !source.coversIncident ? "Not available here" : props.onboarding === source.id ? "Adding…" : "Add to incident"}
                </Button>
              ) : null}
            </footer>
          </li>
        );
      })}
    </ul>
  );
}
