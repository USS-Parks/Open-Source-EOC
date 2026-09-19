import { BriefingView } from "../../sitreps/BriefingView.js";
import type { ApiClient } from "../api/client.js";
import { useAsync } from "../data/hooks.js";
import { ErrorNote, Loading, Scroll } from "../screens/parts.js";

/** One archived situation report rendered as the executive briefing view. */
export function SitrepSurface(props: { client: ApiClient; sitrepId: string }) {
  const { data, error, loading } = useAsync(
    () => props.client.getSitrep(props.sitrepId),
    [props.sitrepId],
  );
  if (loading && !data) return <Loading label="Loading situation report…" />;
  if (error && !data) return <ErrorNote message={error} />;
  if (!data) return null;
  return (
    <Scroll>
      <BriefingView sitrep={data} />
    </Scroll>
  );
}
