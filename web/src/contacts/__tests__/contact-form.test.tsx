// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../app/api/client.js";
import { ContactsSurface } from "../ContactsSurface.js";
import type { Contact } from "../model.js";

afterEach(cleanup);

const EOC = { type: "Point" as const, coordinates: [-124.1664, 40.8021] as [number, number] };
const ADDRESS = "Address (house number, street, town)";

const contact = (part: Partial<Contact>): Contact => ({
  id: "c1", name: "Avery Point", organization: null, title: null, emails: [], phones: ["+17075550101"], personId: null, personName: null,
  positionId: null, positionTitle: null, notes: null, active: true, address: null, location: null, addressPoint: null,
  updatedAt: "2026-09-26T17:00:00Z", ...part,
});

function surface(contacts: Contact[], isAdmin = true) {
  const client = {
    listContacts: vi.fn().mockResolvedValue({ contacts, nextCursor: null }),
    listContactGroups: vi.fn().mockResolvedValue({ groups: [], nextCursor: null }),
    listMembers: vi.fn().mockResolvedValue({ members: [], nextCursor: null }),
    listPositions: vi.fn().mockResolvedValue([]),
    updateContact: vi.fn().mockResolvedValue(contacts[0]),
  };
  render(<ContactsSurface client={client as unknown as ApiClient} jurisdictionId="j1" isAdmin={isAdmin} />);
  return client;
}

const edit = async () =>
  fireEvent.click(within(await screen.findByRole("listitem", { name: "Contact Avery Point" })).getByRole("button", { name: "Edit" }));
const note = () => screen.getByTestId("contact-map-point").textContent;

describe("the contact form's address and map point", () => {
  it("says the set point wins, clears it on request and otherwise leaves it as it is", async () => {
    const client = surface([contact({ address: "County Operations Center, Eureka", location: EOC })]);
    const card = await screen.findByRole("listitem", { name: "Contact Avery Point" });
    expect(within(card).getByText("County Operations Center, Eureka")).toBeTruthy();
    expect(within(card).getByText("Set on the contact")).toBeTruthy();
    await edit();
    expect(note()).toMatch(/^The area search finds this contact at the map point set on it/);
    const address = screen.getByLabelText(ADDRESS) as HTMLInputElement;
    expect(address.value).toBe("County Operations Center, Eureka");
    fireEvent.change(address, { target: { value: "  Arcata City Hall  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
    await vi.waitFor(() => expect(client.updateContact).toHaveBeenCalledOnce());
    const [, kept] = client.updateContact.mock.calls[0]!;
    expect(kept).toMatchObject({ address: "Arcata City Hall" });
    expect(kept).not.toHaveProperty("location");
    await screen.findByText("Avery Point saved.");

    await edit();
    fireEvent.click(screen.getByRole("button", { name: "Clear the stored map point" }));
    expect(note()).toBe("The set map point is cleared when you save. The address did not place on the map, so the area search counts this contact as unplaced.");
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
    await vi.waitFor(() => expect(client.updateContact).toHaveBeenCalledTimes(2));
    expect(client.updateContact.mock.calls[1]![1]).toMatchObject({ location: null });
  });

  it("says where the address placed, or that it did not, and what a changed address will do", async () => {
    surface([contact({ address: "816 3rd Street, Eureka", addressPoint: EOC })]);
    await edit();
    expect(note()).toBe("The area search finds this contact where the address placed.");
    fireEvent.change(screen.getByLabelText(ADDRESS), { target: { value: "12 Main Street, Arcata" } });
    expect(note()).toMatch(/^The address is placed when you save/);
    cleanup();
    surface([contact({ address: "999 Nowhere Road" })]);
    await edit();
    expect(note()).toBe("The address did not place on the map, so the area search counts this contact as unplaced.");
    expect(within(screen.getByRole("listitem", { name: "Contact Avery Point" })).getByText("Address not placed")).toBeTruthy();
  });

  it("clears a blank address, and refuses one too long before sending", async () => {
    const client = surface([contact({ address: "Arcata City Hall" })]);
    await edit();
    fireEvent.change(screen.getByLabelText(ADDRESS), { target: { value: "x".repeat(301) } });
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Enter an address of at most 300 characters.");
    expect(client.updateContact).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(ADDRESS), { target: { value: "   " } });
    expect(note()).toBe("With no map point and no address, the area search cannot find this contact.");
    fireEvent.click(screen.getByRole("button", { name: "Save contact" }));
    await vi.waitFor(() => expect(client.updateContact).toHaveBeenCalledWith("c1", expect.objectContaining({ address: null })));
  });

  it("shows a viewer no address or map point rows, since the server sends none", async () => {
    surface([contact({})], false);
    const card = await screen.findByRole("listitem", { name: "Contact Avery Point" });
    expect(within(card).queryByText("Address")).toBeNull();
    expect(within(card).queryByText("Map point")).toBeNull();
  });
});
