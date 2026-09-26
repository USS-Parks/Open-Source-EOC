// @vitest-environment jsdom
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VolunteerRoster, VolunteerView } from "@openeoc/shared";
import { VolunteersSurface, hoursText, volunteerDraft, volunteerInput } from "../VolunteersSurface.js";

afterEach(cleanup);

const ana: VolunteerView = {
  id: "v1", name: "Ana Reyes", affiliation: "cert", affiliationName: "Klamath CERT", skills: ["First aid", "Radio"],
  credentials: [
    { name: "CERT Basic Training", issuer: "Klamath OES", issuedOn: "2024-01-10", expiresOn: null, expired: false },
    { name: "CPR", issuer: "Red Cross", issuedOn: "2018-03-01", expiresOn: "2020-03-01", expired: true },
  ],
  contact: { phone: "707-555-0101", email: "ana.reyes@example.org" },
  enteredBy: null, notes: "", active: true, updatedAt: "2026-09-25T17:00:00Z",
};
const ben: VolunteerView = {
  ...ana, id: "v2", name: "Ben Ortiz", affiliation: "partner", affiliationName: "Valley CERT", skills: [], credentials: [],
  contact: { phone: "707-555-0199", email: "" }, enteredBy: { organizationId: "o1", organizationName: "Valley CERT", incidentId: "i1" },
};

const staffRoster: VolunteerRoster = {
  jurisdictionId: "j1", incidentId: "i1", timeZone: "America/Los_Angeles", today: "2026-09-25",
  volunteers: [ana, ben],
  deployments: [{
    id: "d1", volunteerId: "v1", volunteerName: "Ana Reyes", incidentId: "i1", incidentName: "River Flood", role: "Shelter support",
    startsAt: "2026-09-20T15:00:00Z", endsAt: "2026-09-20T19:00:00Z", needs: ["CPR"], note: "", warnings: ["CPR expired 2020-03-01"],
  }],
  hours: [
    { volunteerId: "v1", volunteerName: "Ana Reyes", date: "2026-09-20", minutes: 360 },
    { volunteerId: "v2", volunteerName: "Ben Ortiz", date: "2026-09-20", minutes: 150 },
    { volunteerId: "v1", volunteerName: "Ana Reyes", date: "2026-09-21", minutes: 120 },
  ],
  underWay: [{ deploymentId: "d9", volunteerName: "Ana Reyes", since: "2026-09-25T15:00:00Z" }],
  entry: "jurisdiction", canSeeContacts: true,
};

function client(roster: VolunteerRoster = staffRoster) {
  return {
    volunteerRoster: vi.fn().mockResolvedValue(roster),
    incidentVolunteerRoster: vi.fn().mockResolvedValue(roster),
    createVolunteer: vi.fn().mockResolvedValue({ id: "v3" }),
    createIncidentVolunteer: vi.fn().mockResolvedValue({ id: "v3" }),
    updateVolunteer: vi.fn().mockResolvedValue({ id: "v1" }),
    deployVolunteer: vi.fn().mockResolvedValue({ id: "d2" }),
    updateVolunteerDeployment: vi.fn().mockResolvedValue({ id: "d1" }),
    removeVolunteerDeployment: vi.fn().mockResolvedValue(undefined),
  };
}

describe("volunteer roster on screen", () => {
  it("round-trips an entry through the editor's draft, and says hours exactly", () => {
    expect(volunteerInput(volunteerDraft(ana))).toEqual({
      name: "Ana Reyes", affiliation: "cert", affiliationName: "Klamath CERT", phone: "707-555-0101", email: "ana.reyes@example.org",
      skills: ["First aid", "Radio"], notes: "", active: true,
      credentials: ana.credentials.map((c) => ({ name: c.name, issuer: c.issuer, issuedOn: c.issuedOn, expiresOn: c.expiresOn })),
    });
    const draft = volunteerDraft();
    expect(() => volunteerInput({ ...draft, name: "Cy", credentials: [{ name: "", issuer: "Red Cross", issuedOn: "", expiresOn: "" }] }))
      .toThrow("Credential 1: enter its name.");
    expect(hoursText(90)).toBe("1:30");
    expect(hoursText(605)).toBe("10:05");
  });

  it("lists the roster with expired credentials and contacts, and adds a volunteer with a credential", async () => {
    const api = client();
    const view = render(<VolunteersSurface client={api} jurisdictionId="j1" incidentId={null} incidentName={null} />);
    const table = await view.findByRole("table");
    expect(within(table).getByText("Expired")).toBeTruthy();
    expect(within(table).getByText("707-555-0101")).toBeTruthy();
    expect(within(table).getByText("ana.reyes@example.org")).toBeTruthy();
    expect(within(table).getByText("Valley CERT")).toBeTruthy();
    expect(api.volunteerRoster).toHaveBeenCalledWith("j1", expect.any(String));
    const form = view.getByRole("form", { name: "Add a volunteer" });
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Cy Lee" } });
    fireEvent.change(within(form).getByLabelText("Affiliation"), { target: { value: "faith" } });
    fireEvent.change(within(form).getByLabelText("Skills, separated by commas"), { target: { value: "Cooking, Spanish, Cooking" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add a credential" }));
    fireEvent.change(within(form).getByLabelText("Credential 1 Name"), { target: { value: "Food handler" } });
    fireEvent.change(within(form).getByLabelText("Credential 1 Expires"), { target: { value: "2027-06-30" } });
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(within(form).getByRole("button", { name: "Add volunteer" }));
    await view.findByText("Added Cy Lee to the roster.");
    expect(api.createVolunteer).toHaveBeenCalledWith("j1", {
      name: "Cy Lee", affiliation: "faith", affiliationName: "", phone: "", email: "", skills: ["Cooking", "Spanish"],
      credentials: [{ name: "Food handler", issuer: "", issuedOn: null, expiresOn: "2027-06-30" }], notes: "", active: true,
    });
  });

  it("warns before deploying a volunteer who lacks a needed credential, and deploys only when told to", async () => {
    const api = client();
    const view = render(<VolunteersSurface client={api} jurisdictionId="j1" incidentId="i1" incidentName="River Flood" />);
    fireEvent.click(await view.findByRole("button", { name: "Deploy Ana Reyes" }));
    const form = view.getByRole("form", { name: "Deploy a volunteer" });
    expect((within(form).getByLabelText("Volunteer") as HTMLSelectElement).value).toBe("v1");
    fireEvent.change(within(form).getByLabelText("Role"), { target: { value: "Shelter support" } });
    fireEvent.change(within(form).getByLabelText("Starts"), { target: { value: "2026-09-26T08:00" } });
    fireEvent.change(within(form).getByLabelText("Ends, blank while under way"), { target: { value: "2026-09-26T12:00" } });
    fireEvent.click(within(within(form).getByRole("group", { name: "Credentials the role needs" })).getByRole("checkbox", { name: "CPR" }));
    fireEvent.click(within(form).getByRole("button", { name: "Deploy" }));
    expect((await within(form).findByRole("alert")).textContent).toContain("Ana Reyes does not have what the role needs: CPR expired 2020-03-01.");
    expect(api.deployVolunteer).not.toHaveBeenCalled();
    expect((await axe.run(view.container)).violations).toEqual([]);
    fireEvent.click(within(form).getByRole("button", { name: "Deploy anyway" }));
    await view.findByText("Deployed Ana Reyes as Shelter support. Warning: CPR expired 2020-03-01.");
    expect(api.deployVolunteer).toHaveBeenCalledWith("v1", {
      incidentId: "i1", role: "Shelter support", startsAt: new Date("2026-09-26T08:00").toISOString(),
      endsAt: new Date("2026-09-26T12:00").toISOString(), needs: ["CPR"], note: "",
    });
    // The recorded deployment carries its warning in the list.
    const deployments = view.getByRole("region", { name: "Deployments" });
    expect(within(deployments).getByText("CPR expired 2020-03-01")).toBeTruthy();
  });

  it("shows a viewer the roster and hours without contacts or forms", async () => {
    const api = client({
      ...staffRoster, entry: null, canSeeContacts: false,
      volunteers: staffRoster.volunteers.map((v) => ({ ...v, contact: null })),
    });
    const view = render(<VolunteersSurface client={api} jurisdictionId="j1" incidentId="i1" incidentName="River Flood" />);
    const table = await view.findByRole("table");
    expect(within(table).queryByText("Contact")).toBeNull();
    expect(view.queryByRole("form")).toBeNull();
    expect(view.getByText(/Contact details are shown only to the jurisdiction's staff/)).toBeTruthy();
    fireEvent.click(view.getByRole("tab", { name: "Hours" }));
    const byVolunteer = view.getByRole("table", { name: "Hours by volunteer" });
    expect(within(byVolunteer).getAllByRole("row").map((row) => row.textContent)).toEqual([
      "VolunteerDaysHours (h:mm)", "Ana Reyes28:00", "Ben Ortiz12:30", "All volunteers310:30",
    ]);
    expect(view.getByRole("note").textContent).toContain("Under way, and not counted until they end: Ana Reyes since");
    expect((await axe.run(view.container)).violations).toEqual([]);
  });

  it("enters a partner organization's volunteer for the incident", async () => {
    const api = client({ ...staffRoster, entry: "organization", volunteers: [ben], deployments: [], hours: [], underWay: [] });
    const view = render(<VolunteersSurface client={api} jurisdictionId="j1" incidentId="i1" incidentName="River Flood" />);
    const form = await view.findByRole("form", { name: "Add a volunteer" });
    expect(within(form).getByText(/only your organization and the jurisdiction's staff see them/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Name"), { target: { value: "Dee Park" } });
    fireEvent.click(within(form).getByRole("button", { name: "Add volunteer" }));
    await view.findByText("Added Dee Park to the roster.");
    expect(api.createIncidentVolunteer).toHaveBeenCalledWith("i1", expect.objectContaining({ name: "Dee Park" }));
    expect(api.createVolunteer).not.toHaveBeenCalled();
    expect(api.incidentVolunteerRoster).toHaveBeenCalledWith("i1", expect.any(String));
  });
});
