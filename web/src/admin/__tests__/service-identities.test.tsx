// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, expect, it, vi } from "vitest";
import type { ServiceIdentity } from "@openeoc/shared";
import type { ApiClient } from "../../app/api/client.js";
import { ServiceIdentities } from "../ServiceIdentities.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const DAY = 86_400_000;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const bridge: ServiceIdentity = {
  id: "s1", name: "CAD bridge", role: "member", createdAt: at(-DAY), createdBy: "Admin",
  expiresAt: at(30 * DAY), lastUsedAt: at(-60_000), revokedAt: null, revokedBy: null, stopped: null,
};
const display: ServiceIdentity = {
  id: "s2", name: "Wall display", role: "viewer", createdAt: at(-9 * DAY), createdBy: "Admin",
  expiresAt: at(-DAY), lastUsedAt: null, revokedAt: null, revokedBy: null, stopped: "expired",
};
const old: ServiceIdentity = {
  id: "s3", name: "Old sync", role: "member", createdAt: at(-20 * DAY), createdBy: "Admin",
  expiresAt: at(20 * DAY), lastUsedAt: null, revokedAt: at(-2 * DAY), revokedBy: "Riley Planner", stopped: "revoked",
};
const orphan: ServiceIdentity = {
  id: "s4", name: "GIS export", role: "viewer", createdAt: at(-5 * DAY), createdBy: "Former Admin",
  expiresAt: at(60 * DAY), lastUsedAt: null, revokedAt: null, revokedBy: null, stopped: "creator",
};
const TOKEN = `oeoc-svc.00000000-0000-4000-8000-000000000009.${"x".repeat(43)}`;

it("lists each identity with its access, state and last use, and shows a new token once", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const created: ServiceIdentity = { ...bridge, id: "s9", name: "Roster sync", role: "viewer", lastUsedAt: null };
  const client = {
    listServiceIdentities: vi.fn().mockResolvedValueOnce([bridge, display, old, orphan]).mockResolvedValue([created, bridge, display, old, orphan]),
    createServiceIdentity: vi.fn().mockResolvedValue({ identity: created, token: TOKEN }),
  };
  const view = render(<ServiceIdentities client={client as unknown as ApiClient} jurisdictionId="j1" />);
  const row = await view.findByRole("listitem", { name: "Service identity CAD bridge" });
  expect(within(row).getByText("Read and write in this jurisdiction")).toBeTruthy();
  expect(within(row).getByText("Active")).toBeTruthy();
  expect(within(row).queryByText("Never")).toBeNull();
  const lapsed = view.getByRole("listitem", { name: "Service identity Wall display" });
  expect(within(lapsed).getByText("Expired")).toBeTruthy();
  expect(within(lapsed).getByText("Never")).toBeTruthy();
  const revoked = view.getByRole("listitem", { name: "Service identity Old sync" });
  expect(within(revoked).getByText(/ by Riley Planner$/)).toBeTruthy();
  expect(within(revoked).queryByRole("button")).toBeNull();
  // Stopped because its creator no longer administers here, and said so.
  const stopped = view.getByRole("listitem", { name: "Service identity GIS export" });
  expect(within(stopped).getByText("Stopped")).toBeTruthy();
  expect(within(stopped).getByText(/^Stopped: Former Admin no longer administers this jurisdiction\./)).toBeTruthy();
  expect(within(stopped).getByRole("button", { name: "Revoke GIS export" })).toBeTruthy();
  expect((await axe.run(view.container)).violations).toEqual([]);

  fireEvent.change(view.getByLabelText("Name"), { target: { value: "  Roster sync " } });
  fireEvent.change(view.getByLabelText("Access"), { target: { value: "viewer" } });
  fireEvent.change(view.getByLabelText("Expires at the end of"), { target: { value: "2027-01-31" } });
  fireEvent.click(view.getByRole("button", { name: "Create identity" }));
  const token = await view.findByLabelText("Token for Roster sync");
  expect((token as HTMLInputElement).value).toBe(TOKEN);
  expect((token as HTMLInputElement).readOnly).toBe(true);
  expect(client.createServiceIdentity).toHaveBeenCalledWith("j1", {
    name: "Roster sync", role: "viewer", expiresAt: new Date("2027-01-31T23:59:59").toISOString(),
  });
  await view.findByRole("listitem", { name: "Service identity Roster sync" });
  expect((await axe.run(view.container)).violations).toEqual([]);
  fireEvent.click(view.getByRole("button", { name: "Copy token" }));
  await view.findByText("Token copied.");
  expect(writeText).toHaveBeenCalledWith(TOKEN);
  fireEvent.click(view.getByRole("button", { name: "I have stored the token" }));
  expect(view.queryByLabelText("Token for Roster sync")).toBeNull();
  expect(view.container.textContent).not.toContain(TOKEN);
});

it("revokes after a confirmation, shows a refusal in the server's words and saves the API description", async () => {
  const client = {
    listServiceIdentities: vi.fn().mockResolvedValueOnce([bridge]).mockResolvedValue([{ ...bridge, revokedAt: at(0), revokedBy: "Admin" }]),
    revokeServiceIdentity: vi.fn().mockResolvedValue(undefined),
    createServiceIdentity: vi.fn().mockRejectedValue(new Error("a live service identity in this jurisdiction already has that name")),
    openApiDocument: vi.fn().mockResolvedValue({ openapi: "3.1.0" }),
  };
  const saved = vi.fn((_blob: Blob) => "blob:openapi");
  Object.assign(URL, { createObjectURL: saved, revokeObjectURL: vi.fn() });
  const view = render(<ServiceIdentities client={client as unknown as ApiClient} jurisdictionId="j1" />);
  const row = await view.findByRole("listitem", { name: "Service identity CAD bridge" });
  fireEvent.click(within(row).getByRole("button", { name: "Revoke CAD bridge" }));
  expect(client.revokeServiceIdentity).not.toHaveBeenCalled();
  fireEvent.click(within(row).getByRole("button", { name: "Keep CAD bridge" }));
  fireEvent.click(within(row).getByRole("button", { name: "Revoke CAD bridge" }));
  fireEvent.click(within(row).getByRole("button", { name: "Confirm revoking CAD bridge" }));
  await view.findByText("CAD bridge revoked. Its next request is refused.");
  expect(client.revokeServiceIdentity).toHaveBeenCalledWith("s1");
  await waitFor(() => expect(within(view.getByRole("listitem", { name: "Service identity CAD bridge" })).getByText("Revoked")).toBeTruthy());

  fireEvent.change(view.getByLabelText("Name"), { target: { value: "CAD bridge" } });
  fireEvent.click(view.getByRole("button", { name: "Create identity" }));
  expect((await screen.findByRole("alert")).textContent).toBe("a live service identity in this jurisdiction already has that name");

  fireEvent.click(view.getByRole("button", { name: "Download the API description" }));
  await view.findByText("The API description was saved as openeoc-openapi.json.");
  expect(await saved.mock.calls[0]![0].text()).toBe(`${JSON.stringify({ openapi: "3.1.0" }, null, 2)}\n`);
});
