import { useState } from "react";
import { Tabs } from "../../design/controls.js";
import { Icon } from "../../design/icons/index.js";
import "../../datasets/datasets.css";
import type { ApiClient, BoardListItem } from "../api/client.js";
import { EmptyState, Scroll, SurfaceHeader } from "../screens/parts.js";
import { Channels } from "../../admin/Channels.js";
import { Deployment } from "../../admin/Deployment.js";
import { Guests } from "../../admin/Guests.js";
import { Notifications } from "../../admin/Notifications.js";
import { People } from "../../admin/People.js";
import { Positions } from "../../admin/Positions.js";
import { Records } from "../../admin/Records.js";

const JURISDICTION_TABS = [
  { id: "people", label: "People" },
  { id: "positions", label: "Positions" },
  { id: "guests", label: "Guest access" },
  { id: "notifications", label: "Notifications" },
  { id: "records", label: "Records" },
  { id: "channels", label: "Channels" },
] as const;

/**
 * Administration of the selected jurisdiction and, for instance
 * administrators, of the deployment. The navigation entry is hidden from
 * everyone else, and the server refuses these routes regardless.
 */
export function AdminSurface(props: {
  client: ApiClient;
  jurisdictionId: string;
  personId: string | null;
  isAdmin: boolean;
  isInstanceAdmin: boolean;
  boards: readonly BoardListItem[];
}) {
  const tabs = [...(props.isAdmin ? JURISDICTION_TABS : []), { id: "deployment", label: "Deployment" }];
  const [chosen, setTab] = useState<string>(tabs[0]!.id);
  const tab = tabs.some((t) => t.id === chosen) ? chosen : tabs[0]!.id;
  if (!props.isAdmin && !props.isInstanceAdmin) {
    return <EmptyState label="Administration is available to administrators."
      hint="Ask a jurisdiction administrator for the change you need." />;
  }
  return (
    <Scroll>
      <SurfaceHeader title="Administration" />
      <div className="d21-workspace">
        <div className="d21-workspace-intro">
          <Icon name="settings" size={32} decorative />
          <div>
            <strong>People, access and records</strong>
            <span>Changes take effect on the person's next request. Membership, sign-in and two-step sign-in changes are recorded in the audit trail.</span>
          </div>
        </div>
        <Tabs id="admin" label="Administration sections" tabs={tabs} value={tab} onChange={setTab} />
        <div role="tabpanel" id={`admin-${tab}-panel`} aria-labelledby={`admin-${tab}-tab`}>
          {tab === "people" ? <People client={props.client} jurisdictionId={props.jurisdictionId} actorId={props.personId ?? ""} /> : null}
          {tab === "positions" ? <Positions client={props.client} jurisdictionId={props.jurisdictionId} /> : null}
          {tab === "guests" ? <Guests client={props.client} jurisdictionId={props.jurisdictionId} boards={props.boards} /> : null}
          {tab === "notifications" ? <Notifications client={props.client} jurisdictionId={props.jurisdictionId} boards={props.boards} /> : null}
          {tab === "records" ? <Records client={props.client} jurisdictionId={props.jurisdictionId} /> : null}
          {tab === "channels" ? <Channels client={props.client} jurisdictionId={props.jurisdictionId} /> : null}
          {tab === "deployment" ? <Deployment client={props.client} isInstanceAdmin={props.isInstanceAdmin}
            {...(props.isAdmin ? { jurisdictionId: props.jurisdictionId } : {})} /> : null}
        </div>
      </div>
    </Scroll>
  );
}
