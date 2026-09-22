import type { ApiClient } from "../api/client.js";
import { AarWorkspace } from "../../aar/AarWorkspace.js";
import { EmptyState } from "../../design/feedback.js";

export interface AarSurfaceProps {
  readonly client: ApiClient;
  readonly jurisdictionId: string;
  readonly incidentId: string | null;
}


export function AarSurface(props: AarSurfaceProps) {
  if (!props.incidentId) {
    return (
      <EmptyState
        title="No incident selected"
        description="Choose an incident in the command bar to review its observations, corrective actions, and exact report snapshot."
      />
    );
  }

  return (
    <AarWorkspace
      key={props.incidentId}
      client={props.client}
      jurisdictionId={props.jurisdictionId}
      incidentId={props.incidentId}
    />
  );
}
