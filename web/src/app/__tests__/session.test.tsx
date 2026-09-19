// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

function makeClient(): ApiClient {
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
    if (u.endsWith("/api/v1/me"))
      return res(200, {
        person: { id: "p", email: "e@x.org", displayName: "Duty Officer" },
        position: null,
        memberships: [{ jurisdictionId: "j1", role: "member" }],
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
      <button type="button" onClick={() => void session.login("e@x.org", "pw")}>
        login
      </button>
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
});
