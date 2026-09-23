import { describe, expect, it } from "vitest";
import { ICS_211, groupBadgeCode, ics211Rows, icsDateTime, instant, methodLabel, normalizeBadgeCode, type OnDutyEntry } from "../model.js";

const entry = (checkinId: string, since: Date, method = "manual"): OnDutyEntry => ({
  checkinId, personId: `p-${checkinId}`, personName: `Person ${checkinId}`, positionId: "pos",
  positionTitle: "Planning Section Chief", since: since.toISOString(), method,
});

describe("staffing view logic", () => {
  it("numbers ICS-211 lines in check-in order with local date, 24-hour time and a plain method", () => {
    const rows = ics211Rows([entry("a", new Date(2026, 8, 23, 6, 5)), entry("b", new Date(2026, 8, 23, 18, 40), "scan")]);
    expect(rows).toEqual([
      { id: "a", number: 1, name: "Person a", assignment: "Planning Section Chief", date: "2026-09-23", time: "0605", method: "Manual entry" },
      { id: "b", number: 2, name: "Person b", assignment: "Planning Section Chief", date: "2026-09-23", time: "1840", method: "Badge scan" },
    ]);
    expect(icsDateTime(new Date(2026, 0, 2, 3, 4).toISOString())).toBe("2026-01-02 0304");
    expect(methodLabel("radio")).toBe("radio");
    expect(`${ICS_211.id} ${ICS_211.title}`).toBe("ICS-211 Incident Check-In List");
  });

  it("prints a badge code in groups of four and reads it back with the spaces removed", () => {
    const code = "Ab-_0123456789xyz";
    expect(groupBadgeCode(code)).toBe("Ab-_ 0123 4567 89xy z");
    expect(normalizeBadgeCode(` ${groupBadgeCode(code)}\n`)).toBe(code);
  });

  it("turns a datetime-local value into an instant and rejects a blank one", () => {
    expect(instant("2026-09-23T08:00")).toBe(new Date(2026, 8, 23, 8, 0).toISOString());
    expect(instant("")).toBeUndefined();
    expect(instant("not a time")).toBeUndefined();
  });
});
