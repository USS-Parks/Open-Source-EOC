import { describe, expect, it } from "vitest";
import { incidentBoardScopePending } from "../Console.js";

describe("incidentBoardScopePending", () => {
  it("holds an incident-linked board until the selected incident and its board scope are ready", () => {
    expect(incidentBoardScopePending("incident-1", null, true)).toBe(true);
    expect(incidentBoardScopePending("incident-1", "incident-2", false)).toBe(true);
    expect(incidentBoardScopePending("incident-1", "incident-1", true)).toBe(true);
  });

  it("lets non-incident and resolved incident routes render immediately", () => {
    expect(incidentBoardScopePending(undefined, null, true)).toBe(false);
    expect(incidentBoardScopePending("incident-1", "incident-1", false)).toBe(false);
  });
});
