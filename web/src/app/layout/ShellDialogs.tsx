import { useEffect, useState, type ReactNode } from "react";
import { ModalDialog } from "../../design/overlays.js";

/** One page of the Settings dialog. */
export interface SettingsSection {
  readonly key: string;
  readonly title: string;
  readonly content: ReactNode;
}

/**
 * Settings for this viewer: General (navigation, and Administration for
 * administrators) and the sections the console adds. The theme is chosen at
 * the foot of the rail, where the frames place it.
 */
export function SettingsDialog(props: {
  readonly open: boolean;
  readonly compactNavigation: boolean;
  readonly onCompactNavigation: (compact: boolean) => void;
  readonly allSections?: boolean;
  readonly onAllSections?: (value: boolean) => void;
  readonly onOpenAdministration?: (() => void) | undefined;
  readonly sections?: readonly SettingsSection[];
  readonly onClose: () => void;
}) {
  const [active, setActive] = useState("general");
  useEffect(() => { if (props.open) setActive("general"); }, [props.open]);
  const general: SettingsSection = { key: "general", title: "General", content: <GeneralSettings {...props} /> };
  const sections = [general, ...(props.sections ?? [])];
  const shown = sections.find((section) => section.key === active) ?? general;
  return (
    <ModalDialog open={props.open} title="Settings" onClose={props.onClose}>
      <div className="eoc-shell-settings">
        <div className="eoc-shell-settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical">
          {sections.map((section) => (
            <button key={section.key} type="button" role="tab" id={`eoc-settings-tab-${section.key}`}
              aria-selected={section.key === shown.key} aria-controls="eoc-settings-panel"
              onClick={() => setActive(section.key)}>{section.title}</button>
          ))}
        </div>
        <div id="eoc-settings-panel" className="eoc-shell-settings-panel" role="tabpanel" aria-labelledby={`eoc-settings-tab-${shown.key}`}>
          {shown.content}
        </div>
      </div>
    </ModalDialog>
  );
}

function GeneralSettings(props: {
  readonly compactNavigation: boolean;
  readonly onCompactNavigation: (compact: boolean) => void;
  readonly allSections?: boolean;
  readonly onAllSections?: (value: boolean) => void;
  readonly onOpenAdministration?: (() => void) | undefined;
}) {
  return (
    <>
      <fieldset>
        <legend>Navigation</legend>
        <label>
          <input type="checkbox" checked={props.compactNavigation}
            onChange={(event) => props.onCompactNavigation(event.target.checked)} />
          Compact navigation
        </label>
        <p>Shows the section rail as icons only. The setting is saved with this incident's workspace.</p>
        {props.onAllSections ? (
          <>
            <label>
              <input type="checkbox" checked={props.allSections ?? false}
                onChange={(event) => props.onAllSections!(event.target.checked)} />
              Show every section
            </label>
            <p>The rail lists the core sections. Turn this on to list every section as well: chronology,
              dashboards, staffing, forms, the JIC, contacts, datasets and the rest. Saved on this computer.</p>
          </>
        ) : null}
      </fieldset>
      {props.onOpenAdministration ? (
        <fieldset>
          <legend>Administration</legend>
          <p>People, positions, integrations and records for the jurisdictions you administer.</p>
          <button type="button" className="eoc-kit-button" onClick={props.onOpenAdministration}>Open Administration</button>
        </fieldset>
      ) : null}
      <p>The theme, light or dark, is chosen at the foot of the section rail.</p>
    </>
  );
}

const GUIDES = [
  { key: "operator", title: "Operator quickstart", load: () => import("../../../../docs/guides/OPERATOR-QUICKSTART.md?raw") },
  { key: "viewer", title: "Viewer quickstart", load: () => import("../../../../docs/guides/VIEWER-QUICKSTART.md?raw") },
  { key: "field", title: "Field user", load: () => import("../../../../docs/guides/FIELD-USER.md?raw") },
  { key: "accessibility", title: "Accessibility", load: () => import("../../../../docs/guides/ACCESSIBILITY.md?raw") },
] as const;

/** Inline markdown: code, bold and link text. Links in the guides point into the repository, so only their text shows. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(/.exec(part);
    return link ? link[1] : part;
  });
}

/** The guides' own markdown subset: headings, paragraphs, lists and tables. */
export function GuideText(props: { readonly markdown: string }) {
  const blocks: ReactNode[] = [];
  const lines = props.markdown.replace(/\r/g, "").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (!line.trim()) {
      index += 1;
    } else if (heading) {
      const Tag = `h${Math.min(heading[1]!.length + 2, 6)}` as "h3";
      blocks.push(<Tag key={index}>{inline(heading[2]!)}</Tag>);
      index += 1;
    } else if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (index < lines.length && lines[index]!.startsWith("|")) {
        const cells = lines[index]!.split("|").slice(1, -1).map((cell) => cell.trim());
        if (!cells.every((cell) => /^:?-+:?$/.test(cell))) rows.push(cells);
        index += 1;
      }
      const [head, ...body] = rows;
      blocks.push(
        <table key={index}>
          <thead><tr>{head?.map((cell, cellIndex) => <th key={cellIndex}>{inline(cell)}</th>)}</tr></thead>
          <tbody>{body.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{inline(cell)}</td>)}</tr>)}</tbody>
        </table>,
      );
    } else if (/^(\d+\.|-)\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (index < lines.length && (/^(\d+\.|-)\s/.test(lines[index]!) || /^\s+\S/.test(lines[index]!))) {
        const item = lines[index]!;
        if (/^(\d+\.|-)\s/.test(item)) items.push(item.replace(/^(\d+\.|-)\s+/, ""));
        else items[items.length - 1] += ` ${item.trim()}`;
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={index}>{items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>)}</List>);
    } else {
      const paragraph: string[] = [];
      while (index < lines.length && lines[index]!.trim() && !/^(#|\||\d+\.\s|-\s)/.test(lines[index]!)) {
        paragraph.push(lines[index]!.trim());
        index += 1;
      }
      blocks.push(<p key={index}>{inline(paragraph.join(" "))}</p>);
    }
  }
  return <div className="eoc-shell-guide">{blocks}</div>;
}

/** Help: keyboard basics and the user guides that ship with this release. */
export function HelpDialog(props: { readonly open: boolean; readonly onClose: () => void }) {
  const [guide, setGuide] = useState<(typeof GUIDES)[number]["key"]>("operator");
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!props.open) return;
    let current = true;
    setText(null);
    setError(null);
    GUIDES.find((candidate) => candidate.key === guide)!.load()
      .then((module) => { if (current) setText(module.default); })
      .catch(() => { if (current) setError("This guide could not be loaded. Reload the page and try again."); });
    return () => { current = false; };
  }, [guide, props.open]);
  const title = GUIDES.find((candidate) => candidate.key === guide)!.title;
  return (
    <ModalDialog open={props.open} title="Help" onClose={props.onClose}>
      <div className="eoc-shell-help">
        <section aria-labelledby="eoc-shell-help-keys">
          <h3 id="eoc-shell-help-keys">Keyboard</h3>
          <ul>
            <li>Tab from the top of any page reaches <strong>Skip to workspace</strong>, which moves past the command bar and sections.</li>
            <li>Escape closes the open dialog, drawer or menu and returns focus to the control that opened it.</li>
            <li>Arrow keys move through menus and tabs; Enter or Space chooses.</li>
          </ul>
        </section>
        <section aria-labelledby="eoc-shell-help-guides">
          <h3 id="eoc-shell-help-guides">Guides</h3>
          <div className="eoc-shell-help-tabs" role="tablist" aria-label="Guides">
            {GUIDES.map((candidate) => (
              <button key={candidate.key} type="button" role="tab" aria-selected={guide === candidate.key}
                onClick={() => setGuide(candidate.key)}>{candidate.title}</button>
            ))}
          </div>
          <div role="tabpanel" aria-label={title}>
            {error ? <p role="alert">{error}</p> : text === null ? <p>Loading guide…</p> : <GuideText markdown={text} />}
          </div>
        </section>
      </div>
    </ModalDialog>
  );
}
