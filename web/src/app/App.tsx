import { useEffect, useState } from "react";
import { Theme } from "../design/components.js";
import type { ThemeName } from "../design/tokens.js";
import { DeviceUnlock } from "../offline/DevicePin.js";
import { UpdateNotice } from "../offline/UpdateNotice.js";
import { SessionProvider, useSession } from "./auth/session.js";
import { IncidentProvider } from "./incident/context.js";
import { WorkspaceContextProvider, useWorkspaceContext } from "./layout/context.js";
import { Console } from "./screens/Console.js";
import { Login } from "./screens/Login.js";
import { Loading } from "./screens/parts.js";

/**
 * App root: theme at the top, then the session gate. Anonymous shows the
 * login; a device copy waiting for its PIN shows the PIN screen; a live
 * session shows the map-first console. The theme is a per-viewer preference
 * (guarded localStorage), not shared state.
 */

const THEME_KEY = "openeoc.theme";

function loadTheme(): ThemeName {
  try {
    const value = localStorage.getItem(THEME_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // Blocked storage: fall through to the default.
  }
  return "light";
}

function saveTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // A viewer with storage disabled keeps the choice only for this load.
  }
}

function WorkspaceConsole() {
  const workspace = useWorkspaceContext();
  return <Console theme={workspace.theme} onToggleTheme={workspace.toggleTheme} />;
}

function Gate(props: { theme: ThemeName; onThemeChange: (theme: ThemeName) => void }) {
  const session = useSession();
  const { status, error } = session;
  if (status === "loading") return <Loading label={error ?? "Starting…"} />;
  if (status === "anon") return <Login />;
  if (status === "locked" && session.lockedFor) {
    return <DeviceUnlock key={session.lockedFor.personId} lockedFor={session.lockedFor} error={error}
      onUnlock={session.unlockDevice} onUsePassword={session.usePassword} onErase={session.eraseDevice} />;
  }
  return (
    <IncidentProvider>
      <WorkspaceContextProvider theme={props.theme} onThemeChange={props.onThemeChange}>
        <WorkspaceConsole />
      </WorkspaceContextProvider>
    </IncidentProvider>
  );
}

export function App() {
  const [theme, setTheme] = useState<ThemeName>(() => loadTheme());
  useEffect(() => {
    saveTheme(theme);
  }, [theme]);
  return (
    <Theme name={theme}>
      <SessionProvider>
        <Gate theme={theme} onThemeChange={setTheme} />
      </SessionProvider>
      <UpdateNotice />
    </Theme>
  );
}
