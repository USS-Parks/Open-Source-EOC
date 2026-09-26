// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClient } from "../api/client.js";
import { SessionProvider, useSession } from "../auth/session.js";
import { DEMO_SIGNED_OUT } from "../config.js";
import { Login } from "../screens/Login.js";

/**
 * The desktop demonstration signs in as its director by itself, so the demo
 * opens with one click; a person who signs out stays signed out in that tab,
 * and nothing but a synthetic demonstration ever signs itself in.
 */

const DEMO = { OPENEOC_DEMO_EMAIL: "director@demo.example", OPENEOC_DEMO_PASSWORD: "demo-password" };

afterEach(() => {
  cleanup();
  delete (globalThis as { OPENEOC?: unknown }).OPENEOC;
  sessionStorage.clear();
});

function server(logins: string[]): ApiClient {
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const res = (status: number, body: unknown) => ({ ok: status < 300, status, statusText: `HTTP ${status}`, json: async () => body });
    if (u.endsWith("/auth/login")) {
      logins.push((JSON.parse(String(init?.body)) as { email: string }).email);
      return res(200, { accessToken: "A", resumeToken: "R", sessionId: "S" });
    }
    if (u.endsWith("/api/v1/me"))
      return res(200, { person: { id: "p", email: DEMO.OPENEOC_DEMO_EMAIL, displayName: "Director" }, position: null,
        memberships: [{ jurisdictionId: "j1", role: "member" }], guests: [], sessionId: "S" });
    return res(404, { error: "nope" });
  }) as unknown as typeof fetch;
  return new ApiClient({ fetchImpl });
}

function Shell() {
  const session = useSession();
  return session.status === "authed" ? <p>Signed in as {session.me?.person.displayName}</p> : <Login />;
}

describe("the demonstration's own sign-in", () => {
  it("signs in as the director with no typing", async () => {
    (globalThis as { OPENEOC?: unknown }).OPENEOC = { OPENEOC_SYNTHETIC_DATA: "1", ...DEMO };
    const logins: string[] = [];
    render(<SessionProvider client={server(logins)}><Shell /></SessionProvider>);
    await screen.findByText("Signed in as Director");
    expect(logins).toEqual([DEMO.OPENEOC_DEMO_EMAIL]);
  });

  it("stays on the sign-in page after the person signed out in this tab", async () => {
    (globalThis as { OPENEOC?: unknown }).OPENEOC = { OPENEOC_SYNTHETIC_DATA: "1", ...DEMO };
    sessionStorage.setItem(DEMO_SIGNED_OUT, "1");
    const logins: string[] = [];
    render(<SessionProvider client={server(logins)}><Shell /></SessionProvider>);
    await screen.findByLabelText("Email");
    await new Promise((settle) => setTimeout(settle, 50));
    expect(logins).toEqual([]);
  });

  it("never signs itself in on data that is not synthetic", async () => {
    (globalThis as { OPENEOC?: unknown }).OPENEOC = { ...DEMO };
    const logins: string[] = [];
    render(<SessionProvider client={server(logins)}><Shell /></SessionProvider>);
    await screen.findByLabelText("Email");
    await waitFor(() => expect(logins).toEqual([]));
  });
});
