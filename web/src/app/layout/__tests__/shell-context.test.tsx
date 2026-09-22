// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IncidentAreaRevision, SavedStatePayload, SavedStateRecord } from "@openeoc/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError, type Me } from "../../api/client.js";
import { SessionProvider } from "../../auth/session.js";
import { IncidentProvider, IncidentSwitcher } from "../../incident/context.js";
import { useSurface } from "../../router.js";
import { WorkspaceContextProvider, useWorkspaceContext } from "../context.js";

const person: Me = {
  person: { id: "person-1", email: "operator@example.test", displayName: "Operator" },
  position: null,
  memberships: [{ jurisdictionId: "j1", role: "member" }],
  guests: [],
  sessionId: "session-1",
};

const incidents = [
  { id: "incident-1", jurisdictionId: "j1", name: "River Fire", kind: "incident", closedAt: null, canManageParticipation: false, canEditArea: false },
  { id: "incident-2", jurisdictionId: "j1", name: "Harbor Flood", kind: "incident", closedAt: null, canManageParticipation: false, canEditArea: false },
];

const area = (incidentId: string, revision: number, label: string): IncidentAreaRevision => ({
  incidentId,
  revision,
  geometry: null,
  operationalPeriod: { label, startsAt: "2026-09-21T08:00:00-07:00", endsAt: "2026-09-21T20:00:00-07:00" },
  reason: "period",
  createdAt: "2026-09-21T08:00:00-07:00",
  createdBy: "person-1",
  positionId: null,
  createdByName: "Operator",
  positionTitle: null,
});

function state(incidentId: string, kind: "workspace_preferences" | "workspace_layout", key: string, revision: number, payload: SavedStatePayload): SavedStateRecord {
  return { incidentId, kind, key, schemaVersion: 1, revision, payload, createdAt: "2026-09-21T08:00:00Z", updatedAt: "2026-09-21T08:00:00Z" };
}

function missing(): Promise<never> {
  return Promise.reject(new ApiError(404, "saved state not found"));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function client(overrides: Record<string, unknown> = {}): ApiClient {
  return {
    setTokens: vi.fn(),
    clearTokens: vi.fn(),
    me: vi.fn().mockResolvedValue(person),
    listIncidents: vi.fn().mockResolvedValue(incidents),
    incidentBoards: vi.fn().mockResolvedValue([]),
    getIncidentArea: vi.fn((incidentId: string) => Promise.resolve(area(incidentId, 2, incidentId === "incident-1" ? "Day 2" : "Flood 1"))),
    incidentAreaHistory: vi.fn((incidentId: string) => Promise.resolve([area(incidentId, 1, incidentId === "incident-1" ? "Day 1" : "Flood 0")])),
    getWorkspaceState: vi.fn((_incidentId: string, _kind: string, _key: string) => missing()),
    saveWorkspaceState: vi.fn((incidentId: string, kind: string, key: string, input: { expectedRevision: number; payload: SavedStatePayload }) => Promise.resolve(state(incidentId, kind as "workspace_preferences" | "workspace_layout", key, input.expectedRevision + 1, input.payload))),
    listAssignedPositions: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ApiClient;
}

function Probe() {
  const workspace = useWorkspaceContext();
  const { surface } = useSurface();
  const map = workspace.layout("map");
  return (
    <div>
      <span data-testid="phase">{workspace.phase}</span>
      <span data-testid="period">{workspace.selectedPeriodLabel}</span>
      <span data-testid="theme">{workspace.theme}</span>
      <span data-testid="width">{map.drawerWidth}</span>
      <span data-testid="surface">{surface.kind}</span>
      <button type="button" onClick={workspace.toggleTheme}>toggle theme</button>
      <button type="button" onClick={() => workspace.selectPeriod(1)}>period one</button>
      <button type="button" onClick={() => workspace.selectPeriod(null)}>period not set</button>
      <button type="button" onClick={() => workspace.updateLayout("map", { ...map, drawerWidth: 412 })}>resize</button>
      <button type="button" onClick={() => void workspace.keepSession()}>keep session</button>
      <button type="button" onClick={workspace.reloadSaved}>reload saved</button>
    </div>
  );
}

function Harness({ api }: { api: ApiClient }) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  return (
    <SessionProvider client={api}>
      <IncidentProvider>
        <WorkspaceContextProvider theme={theme} onThemeChange={setTheme}>
          <IncidentSwitcher />
          <Probe />
        </WorkspaceContextProvider>
      </IncidentProvider>
    </SessionProvider>
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState(null, "", "#/" );
});

describe("workspace context", () => {
  it("hydrates period, theme, and arrangement layout then saves with revision CAS", async () => {
    const save = vi.fn((incidentId: string, kind: "workspace_preferences" | "workspace_layout", key: string, input: { expectedRevision: number; payload: SavedStatePayload }) =>
      Promise.resolve(state(incidentId, kind, key, input.expectedRevision + 1, input.payload)));
    const api = client({
      getWorkspaceState: vi.fn((incidentId: string, kind: string, key: string) => {
        if (kind === "workspace_preferences") return Promise.resolve(state(incidentId, "workspace_preferences", key, 3, { theme: "dark", periodRevision: 2 }));
        if (key === "map") return Promise.resolve(state(incidentId, "workspace_layout", key, 7, { compactNavigation: true, drawerOpen: true, drawerWidth: 388 }));
        return missing();
      }),
      saveWorkspaceState: save,
    });
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(<Harness api={api} />);
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("current"));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("period").textContent).toBe("Day 2");
    expect(screen.getByTestId("width").textContent).toBe("388");
    expect(location.hash).toContain("period=2");

    fireEvent.click(screen.getByText("period one"));
    await waitFor(() => expect(save).toHaveBeenCalledWith("incident-1", "workspace_preferences", "shell", expect.objectContaining({ expectedRevision: 3, payload: expect.objectContaining({ periodRevision: 1 }) })));
    fireEvent.click(screen.getByText("resize"));
    await waitFor(() => expect(save).toHaveBeenCalledWith("incident-1", "workspace_layout", "map", expect.objectContaining({ expectedRevision: 7, payload: expect.objectContaining({ drawerWidth: 412 }) })));

    history.back();
    await waitFor(() => expect(screen.getByTestId("period").textContent).toBe("Day 2"));
    fireEvent.click(screen.getByText("period not set"));
    await waitFor(() => expect(location.hash).toContain("period=unset"));
    expect(screen.getByTestId("period").textContent).toBe("Not set");
  });

  it("ignores a slower prior-incident restore after the operator switches incident", async () => {
    const slow = deferred<SavedStateRecord>();
    const api = client({
      getWorkspaceState: vi.fn((incidentId: string, kind: string, key: string) => {
        if (kind !== "workspace_preferences") return missing();
        if (incidentId === "incident-1") return slow.promise;
        return Promise.resolve(state(incidentId, "workspace_preferences", key, 1, { theme: "dark", periodRevision: 2 }));
      }),
    });
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(<Harness api={api} />);
    await screen.findByRole("option", { name: "Harbor Flood" });
    fireEvent.change(screen.getByLabelText("Selected incident"), { target: { value: "incident-2" } });
    await waitFor(() => expect(screen.getByTestId("period").textContent).toBe("Flood 1"));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    slow.resolve(state("incident-1", "workspace_preferences", "shell", 9, { theme: "light", periodRevision: 1 }));
    await Promise.resolve();
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(screen.getByTestId("period").textContent).toBe("Flood 1");
  });

  it("surfaces revision conflicts and overwrites only after explicit keep-session recovery", async () => {
    let put = 0;
    const save = vi.fn((incidentId: string, kind: "workspace_preferences" | "workspace_layout", key: string, input: { expectedRevision: number; payload: SavedStatePayload }) => {
      put += 1;
      if (put === 1) return Promise.reject(new ApiError(409, "saved state revision is 4"));
      return Promise.resolve(state(incidentId, kind, key, input.expectedRevision + 1, input.payload));
    });
    const get = vi.fn((incidentId: string, kind: string, key: string) => {
      if (kind === "workspace_preferences") return Promise.resolve(state(incidentId, "workspace_preferences", key, put ? 4 : 3, { theme: "light", periodRevision: 2 }));
      return missing();
    });
    const api = client({ getWorkspaceState: get, saveWorkspaceState: save });
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(<Harness api={api} />);
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("current"));
    fireEvent.click(screen.getByText("toggle theme"));
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("conflict"));
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("keep session"));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith("incident-1", "workspace_preferences", "shell", expect.objectContaining({ expectedRevision: 4, payload: expect.objectContaining({ theme: "dark" }) })));
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("current"));
  });

  it("ignores a keep-session completion after the incident scope changes", async () => {
    const latest = deferred<SavedStateRecord>();
    let put = 0;
    const save = vi.fn((incidentId: string, kind: "workspace_preferences" | "workspace_layout", key: string, input: { expectedRevision: number; payload: SavedStatePayload }) => {
      put += 1;
      if (incidentId === "incident-1") return Promise.reject(new ApiError(409, "saved state revision is 4"));
      return Promise.resolve(state(incidentId, kind, key, input.expectedRevision + 1, input.payload));
    });
    const get = vi.fn((incidentId: string, kind: string, key: string) => {
      if (kind !== "workspace_preferences") return missing();
      if (incidentId === "incident-1" && put > 0) return latest.promise;
      return Promise.resolve(state(incidentId, "workspace_preferences", key, 3, { theme: "light", periodRevision: 2 }));
    });
    const api = client({ getWorkspaceState: get, saveWorkspaceState: save });
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(<Harness api={api} />);
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("current"));
    fireEvent.click(screen.getByText("toggle theme"));
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("conflict"));
    fireEvent.click(screen.getByText("keep session"));
    fireEvent.change(screen.getByLabelText("Selected incident"), { target: { value: "incident-2" } });
    await waitFor(() => expect(screen.getByTestId("period").textContent).toBe("Flood 1"));
    latest.resolve(state("incident-1", "workspace_preferences", "shell", 4, { theme: "light", periodRevision: 2 }));
    await Promise.resolve();
    expect(screen.getByTestId("period").textContent).toBe("Flood 1");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("keeps local theme and layout controls usable when there is no incident scope", async () => {
    const api = client({ listIncidents: vi.fn().mockResolvedValue([]) });
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(<Harness api={api} />);
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("idle"));
    fireEvent.click(screen.getByText("toggle theme"));
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    fireEvent.click(screen.getByText("resize"));
    expect(screen.getByTestId("width").textContent).toBe("412");
    expect(api.saveWorkspaceState).not.toHaveBeenCalled();
  });

  it("preserves an unknown surface when a late workspace restore normalizes route context", async () => {
    const preference = deferred<SavedStateRecord>();
    const api = client({
      getWorkspaceState: vi.fn((incidentId: string, kind: string, _key: string) => {
        if (kind === "workspace_preferences") return preference.promise;
        return missing();
      }),
    });
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(<Harness api={api} />);
    await screen.findByRole("option", { name: "Harbor Flood" });
    location.hash = "#/unknown-workspace";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    await waitFor(() => expect(screen.getByTestId("surface").textContent).toBe("not-found"));

    preference.resolve(state("incident-1", "workspace_preferences", "shell", 3, { theme: "dark", periodRevision: 2 }));
    await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("current"));
    expect(screen.getByTestId("surface").textContent).toBe("not-found");
    expect(location.hash).toContain("#/unknown-workspace?");
  });
});
