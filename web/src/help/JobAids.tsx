import { useState } from "react";
import { GuideText } from "./GuideText.js";
import { JOB_AIDS, aidForPosition } from "./job-aids.js";

export interface ActingPosition {
  readonly key: string;
  readonly title: string;
}

/** Every position's job aid, with the acting position's listed first and open. */
export function JobAids(props: { readonly position: ActingPosition | null }) {
  const match = aidForPosition(props.position);
  const [chosen, setChosen] = useState(match?.aid.key ?? null);
  const listed = match ? [match.aid, ...JOB_AIDS.filter((aid) => aid !== match.aid)] : JOB_AIDS;
  const open = JOB_AIDS.find((aid) => aid.key === chosen);
  const note = !props.position
    ? "No acting position is selected. Choose a job aid."
    : !match
      ? `No job aid is written for ${props.position.title}. Choose the one nearest your work.`
      : match.nearest
        ? `No job aid is written for ${props.position.title}; the nearest is ${match.aid.title}.`
        : `The job aid for your acting position, ${props.position.title}.`;
  return (
    <>
      <p className="eoc-shell-help-note">{note}</p>
      <div className="eoc-shell-help-tabs" role="tablist" aria-label="Job aids">
        {listed.map((aid) => (
          <button key={aid.key} type="button" role="tab" aria-selected={aid.key === open?.key}
            onClick={() => setChosen(aid.key)}>{aid.title}</button>
        ))}
      </div>
      {open ? <div role="tabpanel" aria-label={`Job aid: ${open.title}`}><GuideText markdown={open.markdown} /></div> : null}
    </>
  );
}
