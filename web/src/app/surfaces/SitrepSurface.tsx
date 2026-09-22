import { BriefingView } from "../../sitreps/BriefingView.js";
import { JicPreparation } from "../../sitreps/JicPreparation.js";
import { SitrepWorkspace as Workspace } from "../../sitreps/SitrepWorkspace.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll } from "../screens/parts.js";

/** One archived situation report rendered as the executive briefing view. */
export { Workspace as SitrepWorkspace };

export function SitrepSurface(props: {
  client: ApiClient;
  sitrepId: string;
  jurisdictionId: string;
}) {
  const { data, error, loading } = useAsync(
    () => props.client.getSitrep(props.sitrepId),
    [props.sitrepId],
  );
  if (loading && !data) return <Loading label="Loading situation report…" />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <Scroll>
      <div className="eoc-sitrep-detail-frame">
        <div className="eoc-sitrep-detail">
          <BriefingView sitrep={data} />
          <JicPreparation client={props.client} jurisdictionId={props.jurisdictionId} sitrep={data} />
        </div>
      </div>
    </Scroll>
  );
}
