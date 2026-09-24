import { StatusBadge } from "../../design/components.js";
import type { BoardListItem } from "../api/client.js";
import { EmptyState, Scroll } from "../screens/parts.js";

/** The boards list section. */

export function BoardsIndex(props: {
  boards: readonly BoardListItem[];
  onOpen: (id: string) => void;
}) {
  return (
    <Scroll>
      {props.boards.length === 0 ? (
        <EmptyState label="No boards in this jurisdiction yet." />
      ) : (
        <table className="eoc-table">
          <thead>
            <tr>
              <th>Board</th>
              <th>Type</th>
              <th>On map</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {props.boards.map((b) => (
              <tr key={b.id}>
                <td>{b.title}</td>
                <td>
                  <code className="eoc-muted">{b.templateKey}</code>
                </td>
                <td>
                  {b.hasGeometry ? (
                    <StatusBadge status="info">layer</StatusBadge>
                  ) : (
                    <span className="eoc-muted">—</span>
                  )}
                </td>
                <td>
                  {/* Every row's button says "Open"; its name says which board. */}
                  <button type="button" className="eoc-btn is-quiet" aria-label={`Open ${b.title}`} onClick={() => props.onOpen(b.id)}>
                    Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Scroll>
  );
}
