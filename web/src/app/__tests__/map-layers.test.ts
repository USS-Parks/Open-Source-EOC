import { describe, expect, it } from "vitest";
import type { BoardListItem } from "../api/client.js";
import { layerReadScope, layersInScope } from "../incident/map-layers.js";

const board = (id: string, incidentIds: string[]): BoardListItem =>
  ({ id, title: id, templateKey: "shelters", templateVersion: 1, hasGeometry: true, incidentIds });

describe("the map's layers for the selected incident", () => {
  // What the collections list returns to a county member who also takes part
  // in a partner's incident and holds a guest grant from a third organization.
  const collections = [
    { id: "county-standing" }, { id: "county-flood" }, { id: "county-other-incident" },
    { id: "partner-standing" }, { id: "guest-granted" }, { id: "partner-flood", incidentIds: ["flood"] },
  ];
  const countyBoards = [board("county-standing", []), board("county-flood", ["flood"]), board("county-other-incident", ["storm"])];

  it("keeps the jurisdiction's standing boards and the incident's own, and drops everything else", () => {
    const ids = layersInScope(collections, countyBoards, "flood", new Set(["county-flood"])).map((c) => c.id);
    expect(ids).toEqual(["county-standing", "county-flood"]);
  });

  it("keeps a partner incident's boards and drops the partner's standing and guest-granted boards", () => {
    // Viewing the partner's incident: the board list is that incident's boards, which name no incidents.
    const partnerIncident = [{ id: "partner-flood", title: "partner-flood", templateKey: "shelters", templateVersion: 1, hasGeometry: true }];
    const ids = layersInScope(collections, partnerIncident, "flood", new Set(["partner-flood"])).map((c) => c.id);
    expect(ids).toEqual(["partner-flood"]);
  });

  it("keeps every layer with no incident selected", () => {
    expect(layersInScope(collections, countyBoards, null, new Set())).toHaveLength(collections.length);
  });
});

describe("the incident a layer is read through", () => {
  it("is the selected incident only for a board reached through it, so a member keeps every record", () => {
    expect(layerReadScope({ incidentIds: ["flood", "fire"] }, "flood")).toBe("flood");
    expect(layerReadScope({ incidentIds: ["fire"] }, "flood")).toBeUndefined();
    // A board the viewer holds a role on, one of the incident's boards included, is read unscoped.
    expect(layerReadScope({}, "flood")).toBeUndefined();
    expect(layerReadScope(undefined, "flood")).toBeUndefined();
    expect(layerReadScope({ incidentIds: ["flood"] }, null)).toBeUndefined();
  });
});
