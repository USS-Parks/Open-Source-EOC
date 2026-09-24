import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Icon, destinationIconByKey, type DestinationIconKey } from "../../design/icons/index.js";
import type { ThemeName } from "../../design/tokens.js";
import { BrandMark } from "./BrandMark.js";
import { PageChromeContext } from "./page-chrome.js";
import { HelpDialog, SettingsDialog } from "./ShellDialogs.js";
import "./shell.css";

export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly icon: DestinationIconKey;
}

export interface NavGroup {
  readonly key: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export type WorkspaceArrangement = "map" | "boards" | "planning";
type ShellViewport = "narrow" | "overlay" | "dock";

export interface ShellLayoutState {
  readonly compactNavigation: boolean;
  readonly drawerOpen: boolean;
  readonly drawerWidth: number;
}

export interface ShellSyncState {
  readonly state: "checking" | "current" | "error";
  readonly label: string;
  /** Updates arrive as they happen rather than by polling. */
  readonly live?: boolean;
}

export interface ShellPage {
  readonly group: string;
  readonly title: string;
  /** The line under the title when the surface does not supply its own. */
  readonly scope: string;
}

export interface AppShellProps {
  readonly product: string;
  readonly organization: string;
  readonly context: ReactNode;
  readonly periodLabel: string;
  readonly positionLabel: string;
  readonly periodControl?: ReactNode;
  readonly positionControl?: ReactNode;
  readonly nav: readonly NavGroup[];
  readonly activeNav: string;
  readonly onNavigate: (key: string) => void;
  readonly userName: string;
  readonly roleLabel: string;
  readonly theme: ThemeName;
  readonly onToggleTheme: () => void;
  readonly onLogout: () => void;
  readonly notificationCount: number;
  readonly sync: ShellSyncState;
  readonly page: ShellPage;
  readonly arrangement: WorkspaceArrangement;
  /** Screens whose context drawer stays closed offer no opener in the page header. */
  readonly contextOpener?: boolean;
  readonly layout?: ShellLayoutState;
  readonly onLayoutChange?: (layout: ShellLayoutState) => void;
  readonly rightDock: ReactNode;
  readonly children: ReactNode;
}

const MIN_DRAWER = 280;
const MAX_DRAWER = 520;

function clampDrawer(width: number) {
  return Math.min(MAX_DRAWER, Math.max(MIN_DRAWER, width));
}

function startsWithWideDrawer() {
  return typeof window === "undefined" || typeof window.matchMedia !== "function"
    ? true
    : window.matchMedia("(min-width: 1181px)").matches;
}

function currentViewport(): ShellViewport {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dock";
  if (window.matchMedia("(max-width: 760px)").matches) return "narrow";
  return window.matchMedia("(min-width: 1181px)").matches ? "dock" : "overlay";
}

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => {
    if (element.hidden || element.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
  });
}

function trapTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement) {
  if (event.key !== "Tab") return;
  const elements = focusable(container);
  const first = elements[0];
  const last = elements.at(-1);
  if (!first || !last) {
    event.preventDefault();
    container.focus();
    return;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !elements.includes(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length === 1 ? parts[0]!.slice(0, 2) : `${parts[0]![0]}${parts.at(-1)![0]}`).toUpperCase();
}

/** The theme chooser at the foot of the rail: the current theme, and a menu of both. */
function ThemeMenu(props: { readonly theme: ThemeName; readonly onChoose: (theme: ThemeName) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const choose = (theme: ThemeName) => {
    props.onChoose(theme);
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div ref={root} className="eoc-shell-theme-menu" onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label={props.theme === "light" ? "Light theme" : "Theme, dark"} onClick={() => setOpen(!open)}>
        <Icon name={props.theme === "light" ? "sun" : "theme"} size={20} decorative />
        <span>{props.theme === "light" ? "Light theme" : "Theme"}</span>
        <Icon name="chevronDown" size={16} decorative className="eoc-shell-theme-chevron" />
      </button>
      {open ? (
        <div role="menu" aria-label="Theme" className="eoc-shell-theme-popup">
          {(["light", "dark"] as const).map((theme) => (
            <button key={theme} type="button" role="menuitemradio" aria-checked={props.theme === theme} onClick={() => choose(theme)}>
              <Icon name={theme === "light" ? "sun" : "theme"} size={16} decorative />
              {theme === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell(props: AppShellProps) {
  const [compactNav, setCompactNav] = useState(props.layout?.compactNavigation ?? false);
  const [navOpen, setNavOpen] = useState(false);
  // A saved open drawer is a desktop dock preference.  It must not turn into
  // an unexpected modal when a narrow or overlay workspace hydrates.
  const [drawerOpen, setDrawerOpen] = useState(() =>
    startsWithWideDrawer() && (props.layout?.drawerOpen ?? true),
  );
  const [drawerWidth, setDrawerWidth] = useState(props.layout?.drawerWidth ?? 340);
  const [viewport, setViewport] = useState<ShellViewport>(currentViewport);
  const [dialog, setDialog] = useState<"settings" | "help" | null>(null);
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [subtitleSlot, setSubtitleSlot] = useState<HTMLElement | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navOpener = useRef<HTMLButtonElement>(null);
  const navClose = useRef<HTMLButtonElement>(null);
  const navFocusTarget = useRef<"opener" | "workspace" | null>(null);
  const drawerInvoker = useRef<HTMLElement | null>(null);
  const drawerOpener = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerHeading = useRef<HTMLHeadingElement>(null);
  const focusDrawer = useRef(false);
  const restoreDrawerFocus = useRef(false);
  const pointerCleanup = useRef<(() => void) | null>(null);
  const drawerWidthRef = useRef(drawerWidth);

  const navModal = viewport === "narrow" && navOpen;
  const drawerModal = viewport !== "dock" && drawerOpen;
  const administration = props.nav.some((group) => group.items.some((item) => item.key === "admin"));

  useEffect(() => {
    const layout = props.layout;
    if (!layout) return;
    setCompactNav(layout.compactNavigation);
    setDrawerOpen((current) => viewport === "dock" ? layout.drawerOpen : current && layout.drawerOpen);
    setDrawerWidth(layout.drawerWidth);
    drawerWidthRef.current = layout.drawerWidth;
  }, [props.layout?.compactNavigation, props.layout?.drawerOpen, props.layout?.drawerWidth, viewport]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const narrow = window.matchMedia("(max-width: 760px)");
    const dock = window.matchMedia("(min-width: 1181px)");
    const onChange = () => {
      const next = narrow.matches ? "narrow" : dock.matches ? "dock" : "overlay";
      setViewport(next);
      setNavOpen(false);
      if (next !== "dock") setDrawerOpen(false);
    };
    narrow.addEventListener("change", onChange);
    dock.addEventListener("change", onChange);
    return () => {
      narrow.removeEventListener("change", onChange);
      dock.removeEventListener("change", onChange);
    };
  }, []);

  useEffect(() => () => pointerCleanup.current?.(), []);

  useEffect(() => {
    if (navModal) {
      navClose.current?.focus();
      return;
    }
    const target = navFocusTarget.current;
    if (!target) return;
    navFocusTarget.current = null;
    if (target === "workspace") mainRef.current?.focus();
    else navOpener.current?.focus();
  }, [navModal]);

  useEffect(() => {
    if (drawerOpen && focusDrawer.current) {
      focusDrawer.current = false;
      drawerHeading.current?.focus();
      return;
    }
    if (!drawerOpen && restoreDrawerFocus.current) {
      restoreDrawerFocus.current = false;
      const invoker = drawerInvoker.current;
      if (invoker?.isConnected) invoker.focus();
      else drawerOpener.current?.focus();
    }
  }, [drawerOpen]);

  const shellStyle = { "--eoc-shell-drawer-width": `${drawerWidth}px` } as CSSProperties;

  function openDrawer(invoker: HTMLElement) {
    drawerInvoker.current = invoker;
    focusDrawer.current = true;
    setDrawerOpen(true);
    if (viewport === "dock") publishLayout({ drawerOpen: true });
  }

  function closeDrawer() {
    restoreDrawerFocus.current = true;
    setDrawerOpen(false);
    if (viewport === "dock") publishLayout({ drawerOpen: false });
  }

  function closeNavigation(target: "opener" | "workspace" | null) {
    navFocusTarget.current = target;
    setNavOpen(false);
  }

  function setCompact(next: boolean) {
    setCompactNav(next);
    publishLayout({ compactNavigation: next });
  }

  function resizeFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    pointerCleanup.current?.();
    const startX = event.clientX;
    const startWidth = drawerWidth;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    const move = (next: PointerEvent) => {
      const width = clampDrawer(startWidth + startX - next.clientX);
      drawerWidthRef.current = width;
      setDrawerWidth(width);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      pointerCleanup.current = null;
    };
    const finish = () => {
      cleanup();
      publishLayout({ drawerWidth: drawerWidthRef.current });
    };
    pointerCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }

  function onNavigationKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!navModal || !navRef.current) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeNavigation("opener");
      return;
    }
    trapTab(event, navRef.current);
  }

  function onDrawerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
      return;
    }
    if (drawerModal && drawerRef.current) trapTab(event, drawerRef.current);
  }

  function resizeFromKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? MIN_DRAWER
      : event.key === "End" ? MAX_DRAWER
        : clampDrawer(drawerWidth + (event.key === "ArrowLeft" ? 16 : -16));
    drawerWidthRef.current = next;
    setDrawerWidth(next);
    publishLayout({ drawerWidth: next });
  }

  function publishLayout(change: Partial<ShellLayoutState>) {
    props.onLayoutChange?.({
      compactNavigation: change.compactNavigation ?? compactNav,
      // The saved drawer state is the docked desktop preference; a phone or overlay drawer leaves it alone.
      drawerOpen: viewport === "dock" ? change.drawerOpen ?? drawerOpen : props.layout?.drawerOpen ?? true,
      drawerWidth: change.drawerWidth ?? drawerWidthRef.current,
    });
  }

  function chooseTheme(theme: ThemeName) {
    if (theme !== props.theme) props.onToggleTheme();
  }

  return (
    <div className="eoc-shell" data-arrangement={props.arrangement} data-compact-navigation={compactNav || undefined} data-drawer-open={drawerOpen || undefined} style={shellStyle}>
      <a className="eoc-shell-skip" href="#main" inert={drawerModal || undefined} aria-hidden={drawerModal || undefined} onClick={(event) => { event.preventDefault(); mainRef.current?.focus(); }}>
        Skip to workspace
      </a>
      <header className="eoc-shell-command" inert={drawerModal || undefined} aria-hidden={drawerModal || undefined}>
        <button ref={navOpener} className="eoc-shell-mobile-nav" type="button" aria-controls="eoc-shell-navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>
          <Icon name={destinationIconByKey.overview} size={20} decorative />
          <span>All sections</span>
        </button>
        <div className="eoc-shell-brand">
          <BrandMark />
          <span><strong>{props.product}</strong><small>{props.organization}</small></span>
        </div>
        <div className="eoc-shell-context">{props.context}</div>
        {viewport === "dock" ? <div className="eoc-shell-chip is-period">{props.periodControl ?? <strong>{props.periodLabel}</strong>}</div> : null}
        {viewport === "dock" ? <div className="eoc-shell-chip is-position">{props.positionControl ?? <strong>{props.positionLabel}</strong>}</div> : null}
        <div className="eoc-shell-sync" data-state={props.sync.state} data-live={props.sync.live || undefined}><span aria-hidden="true" />{props.sync.label}</div>
        <button className="eoc-shell-notifications" type="button" aria-label={`Notifications, ${props.notificationCount} unread`} aria-expanded={drawerOpen} onClick={(event) => openDrawer(event.currentTarget)}>
          <Icon name={destinationIconByKey.alerts} size={24} decorative />
          {props.notificationCount > 0 ? <span>{props.notificationCount}</span> : null}
        </button>
        <details className="eoc-shell-account">
          <summary role="button" aria-label="Account menu">
            <span className="eoc-shell-avatar" aria-hidden="true">{initials(props.userName)}</span>
            <span className="eoc-shell-account-name"><strong>{props.userName}</strong><small>{props.positionLabel}</small></span>
            <Icon name="chevronDown" size={20} decorative />
          </summary>
          <div>
            <p><strong>{props.userName}</strong><span>{props.roleLabel}</span><span>{props.positionLabel}</span></p>
            <button type="button" onClick={props.onToggleTheme}>{props.theme === "dark" ? "Use light theme" : "Use dark theme"}</button>
            <button type="button" onClick={props.onLogout}>Sign out</button>
          </div>
        </details>
      </header>

      <div className="eoc-shell-body">
        {navModal ? <button type="button" className="eoc-shell-overlay" aria-label="Close navigation" onClick={() => closeNavigation("opener")} /> : null}
        <nav ref={navRef} id="eoc-shell-navigation" className="eoc-shell-rail" data-open={navOpen || undefined} aria-label="Sections" aria-hidden={viewport === "narrow" && !navOpen ? true : undefined} inert={(drawerModal || (viewport === "narrow" && !navOpen)) || undefined} onKeyDown={onNavigationKeyDown}>
          <div className="eoc-shell-rail-top">
            <button ref={navClose} type="button" className="eoc-shell-nav-close" onClick={() => closeNavigation("opener")}>Close sections</button>
          </div>
          <div className="eoc-shell-nav-scroll">
            {props.nav.map((group) => (
              <section key={group.key} aria-labelledby={`nav-group-${group.key}`}>
                <h2 id={`nav-group-${group.key}`}>{group.label}</h2>
                {group.items.map((item) => {
                  const active = item.key === props.activeNav;
                  return (
                    <button key={item.key} type="button" aria-current={active ? "page" : undefined} aria-label={compactNav ? item.label : undefined} onClick={() => { props.onNavigate(item.key); closeNavigation(viewport === "narrow" ? "workspace" : null); }}>
                      <Icon name={destinationIconByKey[item.icon]} size={24} selected={active} decorative />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
          <div className="eoc-shell-rail-foot">
            <button type="button" aria-label={compactNav ? "Settings" : undefined} aria-haspopup="dialog" onClick={() => setDialog("settings")}>
              <Icon name="settings" size={20} decorative /><span>Settings</span>
            </button>
            <button type="button" aria-label={compactNav ? "Help" : undefined} aria-haspopup="dialog" onClick={() => setDialog("help")}>
              <Icon name="help" size={20} decorative /><span>Help</span>
            </button>
            <ThemeMenu theme={props.theme} onChoose={chooseTheme} />
          </div>
        </nav>

        <main ref={mainRef} id="main" className="eoc-shell-main" tabIndex={-1} aria-hidden={(navModal || drawerModal) || undefined} inert={(navModal || drawerModal) || undefined}>
          <header className="eoc-shell-page-header">
            <div className="eoc-shell-page-title">
              <h1>{props.page.title}</h1>
              <p><span ref={setSubtitleSlot} className="eoc-shell-page-subtitle-slot" /><span className="eoc-shell-page-scope">{props.page.scope}</span></p>
            </div>
            <div className="eoc-shell-page-side">
              <span className="eoc-shell-marking" aria-label="Handling marking: FOUO">FOUO</span>
              <div className="eoc-shell-page-actions">
                <div ref={setActionsSlot} className="eoc-shell-page-actions-slot" />
                {!drawerOpen && props.contextOpener !== false ? <button ref={drawerOpener} type="button" className="eoc-shell-context-opener" onClick={(event) => openDrawer(event.currentTarget)}>Open context</button> : null}
              </div>
            </div>
          </header>
          <PageChromeContext.Provider value={{ actions: actionsSlot, subtitle: subtitleSlot }}>
            <div className="eoc-shell-workspace">{props.children}</div>
          </PageChromeContext.Provider>
          <footer className="eoc-shell-page-footer"><span aria-label="Handling marking: FOUO">FOUO</span></footer>
        </main>

        {drawerModal ? <div className="eoc-shell-drawer-overlay" aria-hidden="true" onPointerDown={closeDrawer} /> : null}
        {/* A div, not an aside: a phone or overlay drawer is a modal dialog, which an aside may not be. */}
        <div ref={drawerRef} className="eoc-shell-drawer" data-open={drawerOpen || undefined} role={drawerModal ? "dialog" : "complementary"} aria-modal={drawerModal || undefined} aria-labelledby="eoc-shell-context-title" onKeyDown={onDrawerKeyDown}>
          <div className="eoc-shell-resizer" role="separator" aria-label="Resize context drawer" aria-orientation="vertical" aria-valuemin={MIN_DRAWER} aria-valuemax={MAX_DRAWER} aria-valuenow={drawerWidth} aria-hidden={viewport === "narrow" || undefined} tabIndex={viewport === "narrow" ? -1 : 0} onPointerDown={resizeFromPointer} onKeyDown={resizeFromKeyboard} />
          <div className="eoc-shell-drawer-header"><h2 ref={drawerHeading} id="eoc-shell-context-title" tabIndex={-1}>Context</h2><button type="button" aria-label="Close context drawer" onClick={closeDrawer}>×</button></div>
          <div className="eoc-shell-drawer-content">
            {viewport !== "dock" ? <section className="eoc-shell-drawer-context-controls" aria-label="Operational context">{props.periodControl}{props.positionControl}</section> : null}
            {props.rightDock}
          </div>
        </div>
      </div>
      <SettingsDialog open={dialog === "settings"} theme={props.theme} onTheme={chooseTheme}
        compactNavigation={compactNav} onCompactNavigation={setCompact}
        onOpenAdministration={administration ? () => { setDialog(null); props.onNavigate("admin"); } : undefined}
        onClose={() => setDialog(null)} />
      <HelpDialog open={dialog === "help"} onClose={() => setDialog(null)} />
    </div>
  );
}
