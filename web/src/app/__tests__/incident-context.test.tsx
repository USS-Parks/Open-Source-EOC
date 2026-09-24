// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClient } from "../api/client.js";
import { SessionProvider } from "../auth/session.js";
import { boardsInScope, IncidentProvider, IncidentSwitcher, useIncident } from "../incident/context.js";

/**
 * The shared incident context (VEOC-79B): one selection for the whole
 * workspace. It defaults to the first open incident and follows the switcher.
 */

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
  history.replaceState(null, "", "#/");
});

const INCIDENTS = [
  { id: "closed-1", name: "Old Flood", kind: "incident", closedAt: "2026-01-01T00:00:00Z", canManageParticipation: false, canEditArea: false },
  { id: "open-1", name: "Bald Hills Fire", kind: "incident", closedAt: null, canManageParticipation: true, canEditArea: true },
  { id: "open-2", name: "River Rescue", kind: "incident", closedAt: null, canManageParticipation: true, canEditArea: true },
];

function makeClient(incidents: () => readonly unknown[] = () => INCIDENTS): ApiClient {
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    const res = (status: number, body: unknown) => ({
      ok: status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: async () => body,
    });
    if (u.endsWith("/api/v1/jurisdictions/j1/incidents")) return res(200, { incidents: incidents() });
    if (/\/api\/v1\/incidents\/[^/]+$/.test(u))
      return res(200, { boards: [{ id: "board-1" }, { id: "board-2" }] });
    if (u.endsWith("/api/v1/me"))
      return res(200, {
        person: { id: "p", email: "e@x.org", displayName: "Duty Officer" },
        position: null,
        memberships: [{ jurisdictionId: "j1", role: "admin" }],
        guests: [],
        sessionId: "S",
      });
    return res(404, { error: "nope" });
  }) as unknown as typeof fetch;
  return new ApiClient({ fetchImpl });
}

function Probe() {
  const { selectedIncidentId, incidentBoardIds, selectWhenListed } = useIncident();
  return (
    <>
      <span data-testid="selected">{selectedIncidentId ?? ""}</span>
      <span data-testid="boards">{[...incidentBoardIds].sort().join(",")}</span>
      <button type="button" onClick={() => void selectWhenListed("new-1")}>Select new-1</button>
      <button type="button" onClick={() => void selectWhenListed("foreign")}>Select foreign</button>
    </>
  );
}

function mount(client = makeClient()) {
  localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
  return render(
    <SessionProvider client={client}>
      <IncidentProvider>
        <IncidentSwitcher />
        <Probe />
      </IncidentProvider>
    </SessionProvider>,
  );
}

describe("IncidentProvider", () => {
  it("defaults to the first open incident and lists every incident in the switcher", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("open-1"));
    const select = screen.getByLabelText("Selected incident") as HTMLSelectElement;
    expect(select.value).toBe("open-1");
    // The closed incident is still selectable, just not the default.
    expect(screen.getByRole("option", { name: /Old Flood \(closed\)/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: "River Rescue" })).toBeTruthy();
  });

  it("follows the switcher to another incident", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("open-1"));
    fireEvent.change(screen.getByLabelText("Selected incident"), { target: { value: "open-2" } });
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("open-2"));
  });

  it("exposes the selected incident's board ids for incident-scoped contribution", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("boards").textContent).toBe("board-1,board-2"));
  });

  it("restores a valid deep-linked incident and clears incompatible record context on a switch", async () => {
    history.replaceState(null, "", "#/board/board-9?incident=open-2&record=record-4");
    mount();
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("open-2"));
    fireEvent.change(screen.getByLabelText("Selected incident"), { target: { value: "open-1" } });
    await waitFor(() => expect(location.hash).toBe("#/boards?incident=open-1"));
    expect(screen.getByTestId("selected").textContent).toBe("open-1");
    location.hash = "#/board/board-9?incident=open-2&record=record-4";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("open-2"));
  });

  it("replaces a foreign linked incident with an available incident and explains the limit", async () => {
    history.replaceState(null, "", "#/boards?incident=foreign");
    mount();
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("open-1"));
    expect(location.hash).toBe("#/boards?incident=open-1");
    expect(screen.getByRole("alert").textContent).toMatch(/linked incident is not available/i);
  });

  it("switches to a just-activated incident once the server lists it, and never to one it does not list", async () => {
    let listed: readonly unknown[] = INCIDENTS;
    mount(makeClient(() => listed));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("open-1"));
    fireEvent.click(screen.getByRole("button", { name: "Select foreign" }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("selected").textContent).toBe("open-1");
    listed = [...INCIDENTS, { ...INCIDENTS[1]!, id: "new-1", name: "New Activation" }];
    fireEvent.click(screen.getByRole("button", { name: "Select new-1" }));
    await waitFor(() => expect(screen.getByTestId("selected").textContent).toBe("new-1"));
    expect((screen.getByLabelText("Selected incident") as HTMLSelectElement).value).toBe("new-1");
    expect(location.hash).toContain("incident=new-1");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("boardsInScope", () => {
  const boards = [
    { id: "standing", incidentIds: [] },
    { id: "fire-roads", incidentIds: ["fire"] },
    { id: "flood-roads", incidentIds: ["flood"] },
    { id: "shared", incidentIds: ["fire", "flood"] },
    { id: "unknown" },
  ];

  it("keeps jurisdiction boards and the selected incident's boards, and leaves out another incident's", () => {
    expect(boardsInScope(boards, "fire").map((board) => board.id)).toEqual(["standing", "fire-roads", "shared", "unknown"]);
  });

  it("keeps every board when no incident is selected", () => {
    expect(boardsInScope(boards, null)).toEqual(boards);
  });
});
