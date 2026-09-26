import type { ReactNode } from "react";

/** Inline markdown: code, bold and link text. Links in the guides point into the repository, so only their text shows. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    const link = /^\[([^\]]+)\]\(/.exec(part);
    return link ? link[1] : part;
  });
}

/**
 * The guides' own markdown subset: headings, paragraphs, lists and tables.
 * Every piece becomes a React element or text, so nothing in a file is ever
 * read as HTML.
 */
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
