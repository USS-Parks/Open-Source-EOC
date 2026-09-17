import { useState } from "react";
import { LIFELINE_STATUS } from "@openeoc/shared";
import { Button, EnumSelect, Panel, StatusBadge, TextField, Theme } from "./components.js";
import {
  AppFrame,
  BoardList,
  BoardTable,
  MapPanel,
  NotificationTray,
} from "./layout.js";
import type { ThemeName } from "./tokens.js";

/**
 * Component gallery: every design-system piece rendered together. Serves as
 * the living style reference and the fixture the a11y and keyboard tests
 * render. Run interactively with vite during development.
 */
export function Gallery(props: { theme: ThemeName }) {
  const [name, setName] = useState("");
  const [lifelineStatus, setLifelineStatus] = useState("stable");
  return (
    <Theme name={props.theme}>
      <AppFrame title={`Design gallery (${props.theme})`}>
        <Panel title="Status badges">
          <StatusBadge status="info">info</StatusBadge>{" "}
          <StatusBadge status="warning">warning</StatusBadge>{" "}
          <StatusBadge status="critical">critical</StatusBadge>{" "}
          <StatusBadge status="success">success</StatusBadge>{" "}
          <StatusBadge status="unknown">unknown</StatusBadge>
        </Panel>
        <Panel title="Controls">
          <div style={{ display: "grid", gap: 12, maxWidth: 360 }}>
            <TextField label="Point of contact" value={name} onChange={setName} />
            <EnumSelect
              label="Lifeline status"
              values={LIFELINE_STATUS.values}
              value={lifelineStatus}
              onChange={setLifelineStatus}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Button kind="primary">Save</Button>
              <Button>Cancel</Button>
              <Button kind="danger">Close incident</Button>
            </div>
          </div>
        </Panel>
        <Panel title="Boards">
          <BoardList
            boards={[
              { id: "sig", name: "Significant Events", status: "critical" },
              { id: "shelters", name: "Shelters", status: "success" },
              { id: "roads", name: "Road Closures" },
            ]}
            onOpen={() => undefined}
          />
        </Panel>
        <Panel title="Display view">
          <BoardTable
            caption="Shelter status"
            columns={["Shelter", "Occupancy", "Status"]}
            rows={[
              ["Hoopa High Gym", "112 / 150", <StatusBadge key="a" status="success">open</StatusBadge>],
              ["Weitchpec Firehouse", "0 / 40", <StatusBadge key="b" status="unknown">unknown</StatusBadge>],
            ]}
          />
        </Panel>
        <MapPanel label="Common operating picture placeholder" />
        <NotificationTray
          items={[
            { id: "1", status: "critical", text: "Road closure reported on SR-96" },
            { id: "2", status: "info", text: "Situation report 4 published" },
          ]}
        />
      </AppFrame>
    </Theme>
  );
}
