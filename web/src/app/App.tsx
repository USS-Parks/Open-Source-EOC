import { useEffect, useState } from "react";
import { Theme } from "../design/components.js";
import type { ThemeName } from "../design/tokens.js";
import { SessionProvider, useSession } from "./auth/session.js";
import { Console } from "./screens/Console.js";
import { Login } from "./screens/Login.js";
import { Loading } from "./screens/parts.js";

/**
 * App root: theme at the top, then the session gate. Anonymous shows the
 * login; a live session shows the map-first console. The theme is a
 * per-viewer preference (guarded localStorage), not shared state.
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

function Gate(props: { theme: ThemeName; onToggleTheme: () => void }) {
  const { status } = useSession();
  if (status === "loading") return <Loading label="Starting…" />;
  if (status === "anon") return <Login />;
  return <Console theme={props.theme} onToggleTheme={props.onToggleTheme} />;
}

export function App() {
  const [theme, setTheme] = useState<ThemeName>(() => loadTheme());
  useEffect(() => {
    saveTheme(theme);
  }, [theme]);
  return (
    <Theme name={theme}>
      <SessionProvider>
        <Gate theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />
      </SessionProvider>
    </Theme>
  );
}
