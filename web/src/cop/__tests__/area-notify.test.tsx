// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../app/api/client.js";
import { MassNotificationSurface, type ComposerPrefill } from "../../contacts/MassNotificationSurface.js";
import { areaFromVertices, areaPrefill, notifyPeopleInArea, type ContactsInArea } from "../area-notify.js";

afterEach(cleanup);

const FOUND: ContactsInArea = {
  contacts: [
    { id: "c1", name: "Avery Point", channels: ["email", "sms"] },
    { id: "c2", name: "Bailey Address", channels: [] },
  ],
  unplaced: 2,
};

describe("notify people in an area", () => {
  it("closes the drawn outline and refuses fewer than three corners", () => {
    expect(areaFromVertices([[0, 0], [1, 0], [1, 1]])).toEqual({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] });
    expect(areaFromVertices([[0, 0], [1, 0], [1, 1], [0, 0]]).coordinates[0]).toHaveLength(4);
    expect(() => areaFromVertices([[0, 0], [1, 1]])).toThrow("Draw at least three corners");
    // A map panned once round the world reports longitudes past 180; the area comes back into range.
    expect(areaFromVertices([[-484.2, 40.78], [-484.14, 40.78], [235.86, 40.82]]).coordinates[0]!.map(([lng]) => Number(lng.toFixed(2))))
      .toEqual([-124.2, -124.14, -124.14, -124.2]);
    expect(areaFromVertices([[180, 0], [179, 1], [179, 0]]).coordinates[0]![0]).toEqual([180, 0]);
  });

  it("asks the server who is inside and opens the composer with them selected, saying what it could not see", async () => {
    const client = { contactsInArea: vi.fn().mockResolvedValue(FOUND) };
    const open = vi.fn();
    const area = areaFromVertices([[-124.2, 40.78], [-124.14, 40.78], [-124.14, 40.82]]);
    await expect(notifyPeopleInArea(client, "j1", area, open)).resolves.toBe(FOUND);
    expect(client.contactsInArea).toHaveBeenCalledWith("j1", area);
    expect(open).toHaveBeenCalledWith({
      contactIds: ["c1", "c2"],
      note: "2 contacts whose known location is in the drawn area are selected below. 1 has no email, phone or app link. "
        + "2 contacts' addresses could not be placed on the map and may be inside. Nothing is sent until you press Send notification.",
    });
    expect(areaPrefill({ contacts: [], unplaced: 0 }).note).toBe(
      "No contact's known location is in the drawn area. Nothing is sent until you press Send notification.");
    const crowd = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, name: `Contact ${i}`, channels: ["sms" as const] }));
    expect(areaPrefill({ contacts: crowd, unplaced: 0 }).note).toBe(
      "501 contacts whose known location is in the drawn area are selected below. "
        + "One send reaches at most 500 contacts: draw a smaller area or send in parts. Nothing is sent until you press Send notification.");
    const failing = { contactsInArea: vi.fn().mockRejectedValue(new Error("requires write access to this jurisdiction")) };
    await expect(notifyPeopleInArea(failing, "j1", area, open)).rejects.toThrow("requires write access");
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("prefills the composer's contacts and sends nothing until Send is pressed", async () => {
    const contact = (id: string, name: string) => ({ id, name, active: true });
    const client = {
      listMassNotifications: vi.fn().mockResolvedValue({ massNotifications: [], nextCursor: null }),
      listContactGroups: vi.fn().mockResolvedValue({ groups: [], nextCursor: null }),
      listContacts: vi.fn().mockResolvedValue({ contacts: [contact("c1", "Avery Point"), contact("c2", "Bailey Address"), contact("c3", "Cameron Outside")], nextCursor: null }),
      listPositions: vi.fn().mockResolvedValue([]),
      sendMassNotification: vi.fn().mockResolvedValue({ id: "m1" }),
      getMassNotification: vi.fn().mockReturnValue(new Promise(() => undefined)),
    } as unknown as ApiClient;
    const prefill: ComposerPrefill = areaPrefill(FOUND);
    render(<MassNotificationSurface client={client} jurisdictionId="j1" canSend prefill={prefill} />);
    const checked = (name: string) => (screen.getByRole("checkbox", { name }) as HTMLInputElement).checked;
    await waitFor(() => expect(checked("Avery Point")).toBe(true));
    expect(checked("Bailey Address")).toBe(true);
    expect(checked("Cameron Outside")).toBe(false);
    expect(screen.getByTestId("compose-prefill").textContent).toBe(prefill.note);
    expect(client.sendMassNotification).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Subject/), { target: { value: "Evacuation warning" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Leave the flood area now." } });
    fireEvent.click(screen.getByRole("button", { name: "Send notification" }));
    await waitFor(() => expect(client.sendMassNotification).toHaveBeenCalledOnce());
    expect(client.sendMassNotification).toHaveBeenCalledWith("j1", expect.objectContaining({ contactIds: ["c1", "c2"] }));
    await waitFor(() => expect(screen.queryByTestId("compose-prefill")).toBeNull());
  });

  it("keeps the person's changes when a parent hands over an equal prefill, and applies a new one", async () => {
    const client = {
      listMassNotifications: vi.fn().mockResolvedValue({ massNotifications: [], nextCursor: null }),
      listContactGroups: vi.fn().mockResolvedValue({ groups: [], nextCursor: null }),
      listContacts: vi.fn().mockResolvedValue({ contacts: [{ id: "c1", name: "Avery Point", active: true }, { id: "c2", name: "Bailey Address", active: true }], nextCursor: null }),
      listPositions: vi.fn().mockResolvedValue([]),
    } as unknown as ApiClient;
    const view = render(<MassNotificationSurface client={client} jurisdictionId="j1" canSend prefill={areaPrefill(FOUND)} />);
    const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
    await waitFor(() => expect(box("Bailey Address").checked).toBe(true));
    fireEvent.click(box("Bailey Address"));
    view.rerender(<MassNotificationSurface client={client} jurisdictionId="j1" canSend prefill={areaPrefill(FOUND)} />);
    expect(box("Bailey Address").checked).toBe(false);
    view.rerender(<MassNotificationSurface client={client} jurisdictionId="j1" canSend
      prefill={areaPrefill({ contacts: [FOUND.contacts[1]!], unplaced: 0 })} />);
    await waitFor(() => expect(box("Bailey Address").checked).toBe(true));
    expect(box("Avery Point").checked).toBe(false);
  });
});
