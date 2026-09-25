import { ActionButton } from "../design/controls.js";
import type { RawNotification } from "../app/api/client.js";
import "./notifications.css";

export interface NotificationTrayProps {
  readonly items: readonly RawNotification[];
  readonly onOpenCenter: () => void;
  /** Opens one notification in the center, which marks it read. */
  readonly onOpenItem?: (id: string) => void;
}

function state(item: RawNotification): { readonly key: string; readonly label: string } {
  if (!item.assigned_to_current_actor) return { key: "delivery", label: item.status === "failed" ? "Delivery failed" : "Delivery log" };
  if (item.acknowledged_at) return { key: "acknowledged", label: "Acknowledged" };
  if (item.read_at) return { key: "read", label: "Read, acknowledgement pending" };
  return { key: "unread", label: "Unread" };
}

function time(value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? "" : new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
}

/**
 * The command bar's notifications panel: what is addressed to this person,
 * unread first, newest first, eight at most. Delivery records for other
 * people stay in the center. Showing an item never marks it read; opening it
 * in the center does.
 */
export function NotificationTray({ items, onOpenCenter, onOpenItem }: NotificationTrayProps) {
  const mine = items
    .filter((item) => item.assigned_to_current_actor)
    .sort((a, b) => Number(Boolean(a.read_at)) - Number(Boolean(b.read_at)) || b.created_at.localeCompare(a.created_at));
  const unread = mine.filter((item) => !item.read_at).length;
  const deliveries = items.length - mine.length;
  return (
    <section className="notification-tray" aria-labelledby="notification-tray-title">
      <div className="notification-tray-heading">
        <h2 id="notification-tray-title">Notifications</h2>
        <span className="notification-tray-count">{unread === 0 ? "All read" : `${unread} unread`}</span>
      </div>
      {mine.length === 0 ? (
        <p className="notification-muted">Nothing is addressed to you.</p>
      ) : (
        <ul aria-live="polite">
          {mine.slice(0, 8).map((item) => {
            const body = (
              <>
                <span className="notification-tray-meta">
                  <span className="notification-tray-state" data-state={state(item).key}>{state(item).label}</span>
                  <time dateTime={item.created_at}>{time(item.created_at)}</time>
                </span>
                <strong>{item.title}</strong>
                {item.body ? <span className="notification-tray-body">{item.body}</span> : null}
                <small>{item.incident_name ?? item.destination}</small>
              </>
            );
            return (
              <li key={item.id} data-read={Boolean(item.read_at) || undefined}>
                {onOpenItem ? <button type="button" onClick={() => onOpenItem(item.id)}>{body}</button> : body}
              </li>
            );
          })}
        </ul>
      )}
      <div className="notification-tray-foot">
        {deliveries > 0 ? <small>{deliveries === 1 ? "1 delivery record" : `${deliveries} delivery records`} for others in the center</small> : <span />}
        <ActionButton kind="quiet" onClick={onOpenCenter}>Open center</ActionButton>
      </div>
    </section>
  );
}
