import { ActionButton } from "../design/controls.js";
import type { RawNotification } from "../app/api/client.js";
import "./notifications.css";

export interface NotificationTrayProps {
  readonly items: readonly RawNotification[];
  readonly onOpenCenter: () => void;
}

function state(item: RawNotification): { readonly key: string; readonly label: string } {
  if (!item.assigned_to_current_actor) return { key: "delivery", label: item.status === "failed" ? "Delivery failed" : "Delivery log" };
  if (item.acknowledged_at) return { key: "acknowledged", label: "Acknowledged" };
  if (item.read_at) return { key: "read", label: "Read, acknowledgement pending" };
  return { key: "unread", label: "Unread" };
}

/** Compact command-drawer summary. Presence in the tray never marks an item read. */
export function NotificationTray({ items, onOpenCenter }: NotificationTrayProps) {
  return (
    <section className="notification-tray" aria-labelledby="notification-tray-title">
      <div className="notification-tray-heading">
        <h2 id="notification-tray-title">Notifications</h2>
        <ActionButton kind="quiet" onClick={onOpenCenter}>Open center</ActionButton>
      </div>
      {items.length === 0 ? (
        <p className="notification-muted">No notifications.</p>
      ) : (
        <ul aria-live="polite">
          {items.slice(0, 6).map((item) => (
            <li key={item.id} data-read={Boolean(item.read_at || !item.assigned_to_current_actor) || undefined}>
              <span className="notification-tray-state" data-state={state(item).key}>
                {state(item).label}
              </span>
              <strong>{item.title}</strong>
              <small>{item.incident_name ?? item.destination}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
