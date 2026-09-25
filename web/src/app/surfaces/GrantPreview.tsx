import type { GrantPreview as Preview } from "@openeoc/shared";
import type { ApiClient } from "../api/client.js";
import { Button } from "../../design/components.js";
import { useAsync } from "../data/hooks.js";

/**
 * What a partner's grant lets its person read on this incident, read as that
 * person under the same access rules. Everything the administrator reads and
 * the person does not is named, so a missing map layer or board is found
 * before the partner reports it.
 */
export function GrantPreviewPanel(props: {
  readonly client: ApiClient;
  readonly incidentId: string;
  readonly participantId: string;
  readonly onClose: () => void;
}) {
  const preview = useAsync<Preview>(() => props.client.previewIncidentParticipant(props.incidentId, props.participantId), [props.incidentId, props.participantId]);
  const data = preview.data;
  return (
    <section className="eoc-grant-preview" aria-label="What this partner can read">
      <header>
        <h3>{data ? `What ${data.person} (${data.organization}) can read` : "What this partner can read"}</h3>
        <Button onClick={props.onClose}>Close preview</Button>
      </header>
      {preview.error ? <p role="alert">The preview could not be made: {preview.error}</p> : !data ? <p>Reading the incident as this partner…</p> : (
        <>
          <p className="eoc-grant-preview-note">
            {data.active
              ? `As a ${data.role} until ${new Date(data.expiresAt).toLocaleString()}. This is read with the partner's own access, not a model of it.`
              : "This grant has ended, so the partner reads nothing on this incident."}
          </p>
          <dl>
            {data.sections.map((section) => (
              <div key={section.key}>
                <dt>{section.label}</dt>
                <dd>
                  <span>{section.readable.length ? `Reads ${section.readable.length}: ${section.readable.join("; ")}` : "Reads none"}</span>
                  {section.restricted.length ? <span className="eoc-grant-preview-restricted">Cannot read {section.restricted.length}: {section.restricted.join("; ")}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}
