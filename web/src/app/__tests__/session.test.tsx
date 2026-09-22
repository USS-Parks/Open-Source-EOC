// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client.js";
import { SessionProvider, useSession } from "../auth/session.js";

/**
 * Session lifecycle in a real DOM: anonymous with no stored tokens,
 * authenticated after login (adopting the first jurisdiction), and revived
 * from a saved token pair on mount.
 */

afterEach(() => {
  cleanup();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

function makeClient(onResume?: () => boolean | void): ApiClient {
  const fetchImpl = (async (url: string) => {
    const u = String(url);
    const res = (status: number, body: unknown) => ({
      ok: status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: async () => body,
    });
    if (u.endsWith("/auth/login"))
      return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
    if (u.endsWith("/auth/resume")) {
      if (onResume?.() === false) return res(401, { error: "expired" });
      return res(200, { accessToken: "A2", resumeToken: "R2", sessionId: "S" });
    }
    if (u.endsWith("/api/v1/me"))
      return res(200, {
        person: { id: "p", email: "e@x.org", displayName: "Duty Officer" },
        position: null,
        memberships: [{ jurisdictionId: "j1", role: "member" }],
        guests: [],
        sessionId: "S",
      });
    return res(404, { error: "nope" });
  }) as unknown as typeof fetch;
  return new ApiClient({ fetchImpl });
}

function makePositionClient(): ApiClient {
  let active = false;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const res = (status: number, body: unknown) => ({
      ok: status < 300,
      status,
      statusText: `HTTP ${status}`,
      json: async () => body,
    });
    if (u.endsWith("/api/v1/positions/position-1/sign-in") && init?.method === "POST") {
      active = true;
      return res(200, { ok: true });
    }
    if (u.endsWith("/api/v1/positions/sign-out") && init?.method === "POST") {
      active = false;
      return res(200, { ok: true });
    }
    if (u.endsWith("/api/v1/me")) return res(200, {
      person: { id: "p", email: "e@x.org", displayName: "Duty Officer" },
      position: active ? { id: "position-1", key: "planning", title: "Planning Section", jurisdictionId: "j1" } : null,
      memberships: [{ jurisdictionId: "j1", role: "member" }],
      guests: [],
      sessionId: "S",
    });
    return res(404, { error: "nope" });
  }) as unknown as typeof fetch;
  return new ApiClient({ fetchImpl });
}

function Probe() {
  const session = useSession();
  return (
    <div>
      <span data-testid="status">{session.status}</span>
      <span data-testid="who">{session.me?.person.displayName ?? ""}</span>
      <span data-testid="jur">{session.jurisdictionId ?? ""}</span>
      <span data-testid="position">{session.me?.position?.title ?? ""}</span>
      <span data-testid="error">{session.error ?? ""}</span>
      <button type="button" onClick={() => void session.login("e@x.org", "pw")}>
        login
      </button>
      <button type="button" onClick={() => void session.recoverSession().catch(() => undefined)}>recover session</button>
      <button type="button" onClick={() => session.setJurisdiction("foreign")}>foreign jurisdiction</button>
      <button type="button" onClick={() => void session.switchPosition("position-1")}>sign in position</button>
      <button type="button" onClick={() => void session.switchPosition(null)}>sign out position</button>
    </div>
  );
}

describe("SessionProvider", () => {
  it("starts anonymous with no stored tokens", async () => {
    render(
      <SessionProvider client={makeClient()}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"));
  });

  it("authenticates on login and adopts the first jurisdiction", async () => {
    render(
      <SessionProvider client={makeClient()}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"));
    fireEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"));
    expect(screen.getByTestId("who").textContent).toBe("Duty Officer");
    expect(screen.getByTestId("jur").textContent).toBe("j1");
  });

  it("revives a saved session on mount", async () => {
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(
      <SessionProvider client={makeClient()}>
        <Probe />
      </SessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"));
    expect(screen.getByTestId("jur").textContent).toBe("j1");
  });

  it("renews a live session for offline-work recovery without changing its jurisdiction", async () => {
    const resumed = vi.fn();
    render(<SessionProvider client={makeClient(resumed)}><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"));
    fireEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"));
    fireEvent.click(screen.getByText("recover session"));
    await waitFor(() => expect(resumed).toHaveBeenCalledOnce());
    expect(screen.getByTestId("jur").textContent).toBe("j1");
  });

  it("returns to sign-in when recovery credentials are no longer valid", async () => {
    render(<SessionProvider client={makeClient(() => false)}><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"));
    fireEvent.click(screen.getByText("login"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"));
    fireEvent.click(screen.getByText("recover session"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"));
    expect(localStorage.getItem("openeoc.tokens")).toBeNull();
  });

  it("rejects a jurisdiction outside the refreshed membership and guest list", async () => {
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(<SessionProvider client={makeClient()}><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId("jur").textContent).toBe("j1"));
    fireEvent.click(screen.getByText("foreign jurisdiction"));
    expect(screen.getByTestId("jur").textContent).toBe("j1");
    expect(screen.getByTestId("error").textContent).toMatch(/not available/i);
  });

  it("changes acting position only through authenticated endpoints and refetches me", async () => {
    localStorage.setItem("openeoc.tokens", JSON.stringify({ accessToken: "A", resumeToken: "R" }));
    render(<SessionProvider client={makePositionClient()}><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"));
    fireEvent.click(screen.getByText("sign in position"));
    await waitFor(() => expect(screen.getByTestId("position").textContent).toBe("Planning Section"));
    fireEvent.click(screen.getByText("sign out position"));
    await waitFor(() => expect(screen.getByTestId("position").textContent).toBe(""));
  });
});
