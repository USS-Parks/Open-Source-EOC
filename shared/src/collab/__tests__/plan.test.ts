import { describe, expect, it } from "vitest";
import {
  planIncidentSpace,
  sectionForPosition,
  slugify,
  type PositionHolder,
} from "../plan.js";

/**
 * Collaboration-space planning (F15). The channel structure and
 * membership derive purely from the ICS positions and their holders, so the
 * plan is testable with no backend and the adapters simply enact it.
 */

describe("sectionForPosition", () => {
  it("routes command staff to the command channel", () => {
    expect(sectionForPosition("incident_commander")).toBe("command");
    expect(sectionForPosition("public_information_officer")).toBe("command");
    expect(sectionForPosition("safety_officer")).toBe("command");
  });

  it("routes section chiefs to their sections", () => {
    expect(sectionForPosition("operations_section_chief")).toBe("operations");
    expect(sectionForPosition("planning_section_chief")).toBe("planning");
    expect(sectionForPosition("logistics_section_chief")).toBe("logistics");
    expect(sectionForPosition("finance_admin_section_chief")).toBe("finance_admin");
  });

  it("defaults the unmapped to command rather than dropping them", () => {
    expect(sectionForPosition("some_unknown_role")).toBe("command");
  });
});

describe("slugify", () => {
  it("produces a backend-safe slug", () => {
    expect(slugify("Klamath Flood 2026!")).toBe("klamath-flood-2026");
    expect(slugify("   ")).toBe("incident");
  });
});

describe("planIncidentSpace", () => {
  const positions = [
    "incident_commander",
    "public_information_officer",
    "operations_section_chief",
    "planning_section_chief",
  ];
  const holders: PositionHolder[] = [
    { positionKey: "incident_commander", personId: "p-ic", email: "ic@example.org" },
    { positionKey: "operations_section_chief", personId: "p-ops", email: "ops@example.org" },
  ];

  it("creates an incident-wide channel plus one per present section", () => {
    const plan = planIncidentSpace("Klamath Flood", positions, holders);
    expect(plan.spaceName).toBe("klamath-flood");
    const sections = plan.channels.map((c) => c.section);
    // command (IC + PIO), operations, planning, and the incident-wide "all".
    expect(sections).toEqual(["all", "command", "operations", "planning"]);
  });

  it("assigns membership from current holders", () => {
    const plan = planIncidentSpace("Klamath Flood", positions, holders);
    const all = plan.channels.find((c) => c.section === "all")!;
    expect(all.memberPersonIds).toEqual(["p-ic", "p-ops"]);
    const command = plan.channels.find((c) => c.section === "command")!;
    expect(command.memberPersonIds).toEqual(["p-ic"]);
    const ops = plan.channels.find((c) => c.section === "operations")!;
    expect(ops.memberPersonIds).toEqual(["p-ops"]);
    // A section with a position but no holder yet exists with no members.
    const planning = plan.channels.find((c) => c.section === "planning")!;
    expect(planning.memberPersonIds).toEqual([]);
  });

  it("keeps emails aligned to the sorted member ids and de-duplicates a person", () => {
    const dup: PositionHolder[] = [
      { positionKey: "operations_section_chief", personId: "p1", email: "a@example.org" },
      { positionKey: "planning_section_chief", personId: "p1", email: "a@example.org" },
    ];
    const plan = planIncidentSpace("X", ["operations_section_chief", "planning_section_chief"], dup);
    const all = plan.channels.find((c) => c.section === "all")!;
    expect(all.memberPersonIds).toEqual(["p1"]);
    expect(all.memberEmails).toEqual(["a@example.org"]);
  });
});
