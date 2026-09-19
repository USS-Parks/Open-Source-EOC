import type { CSSProperties, ReactNode } from "react";
import { Button, StatusBadge } from "../../design/components.js";
import type { ThemeName } from "../../design/tokens.js";

/**
 * The map-first console chrome: a command bar across the top, a left nav
 * rail that switches the center surface, the center itself (the map by
 * default), and a right dock for boards and notifications. This is the
 * Esri-leaning layout (a dominant canvas with panels docked around it)
 * carrying the WebEOC-leaning board and form work inside those panels.
 */

export interface NavItem {
  readonly key: string;
  readonly label: string;
}

export function AppShell(props: {
  product: string;
  context: string;
  nav: readonly NavItem[];
  activeNav: string;
  onNavigate: (key: string) => void;
  userName: string;
  roleLabel: string;
  theme: ThemeName;
  onToggleTheme: () => void;
  onLogout: () => void;
  rightDock: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ height: "100vh", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
      <a href="#main" style={skipLink}>
        Skip to content
      </a>
      <header style={commandBar}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
          <strong style={{ fontSize: "1.05em", whiteSpace: "nowrap" }}>{props.product}</strong>
          <span style={{ color: "var(--eoc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {props.context}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <StatusBadge status="success">live</StatusBadge>
          <Button kind="quiet" onClick={props.onToggleTheme}>
            {props.theme === "dark" ? "Light" : "Dark"}
          </Button>
          <span style={{ color: "var(--eoc-text-muted)", whiteSpace: "nowrap" }}>
            {props.userName}
          </span>
          <StatusBadge status="info">{props.roleLabel}</StatusBadge>
          <Button kind="quiet" onClick={props.onLogout}>
            Sign out
          </Button>
        </div>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "132px 1fr 340px", minHeight: 0 }}>
        <nav aria-label="Sections" style={rail}>
          {props.nav.map((item) => {
            const active = item.key === props.activeNav;
            return (
              <button
                key={item.key}
                type="button"
                aria-current={active ? "page" : undefined}
                onClick={() => props.onNavigate(item.key)}
                style={{
                  ...railButton,
                  background: active ? "var(--eoc-surface-raised)" : "transparent",
                  borderLeft: active ? "3px solid var(--eoc-focus)" : "3px solid transparent",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <main id="main" style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {props.children}
        </main>
        <aside aria-label="Boards and notifications" style={dock}>
          {props.rightDock}
        </aside>
      </div>
    </div>
  );
}

const skipLink: CSSProperties = {
  position: "absolute",
  left: -9999,
  top: 0,
  background: "var(--eoc-surface)",
  padding: 8,
  zIndex: 10,
};

const commandBar: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  padding: "10px 16px",
  borderBottom: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)",
  boxShadow: "var(--eoc-shadow-sm)",
  zIndex: 1,
};

const rail: CSSProperties = {
  borderRight: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)",
  display: "flex",
  flexDirection: "column",
  paddingTop: 8,
  gap: 2,
};

const railButton: CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  minHeight: 44,
  border: "none",
  fontFamily: "inherit",
  fontSize: "0.95em",
  color: "var(--eoc-text)",
  cursor: "pointer",
};

const dock: CSSProperties = {
  borderLeft: "1px solid var(--eoc-border)",
  background: "var(--eoc-surface)",
  overflow: "auto",
  padding: 12,
  display: "grid",
  gap: 16,
  alignContent: "start",
};
