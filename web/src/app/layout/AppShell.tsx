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

export interface ShellSyncState {
  readonly state: "checking" | "current" | "error";
  readonly label: string;
}

export interface ShellPage {
  readonly group: string;
  readonly title: string;
  readonly scope: string;
}

export interface AppShellProps {
  readonly product: string;
  readonly organization: string;
  readonly context: ReactNode;
  readonly periodLabel: string;
  readonly positionLabel: string;
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

export function AppShell(props: AppShellProps) {
  const [compactNav, setCompactNav] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(startsWithWideDrawer);
  const [drawerWidth, setDrawerWidth] = useState(340);
  const [viewport, setViewport] = useState<ShellViewport>(currentViewport);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navOpener = useRef<HTMLButtonElement>(null);
  const navClose = useRef<HTMLButtonElement>(null);
  const navFocusTarget = useRef<"opener" | "workspace" | null>(null);
  const drawerInvoker = useRef<HTMLElement | null>(null);
  const drawerOpener = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerHeading = useRef<HTMLHeadingElement>(null);
  const focusDrawer = useRef(false);
  const restoreDrawerFocus = useRef(false);
  const pointerCleanup = useRef<(() => void) | null>(null);

  const navModal = viewport === "narrow" && navOpen;
  const drawerModal = viewport !== "dock" && drawerOpen;

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const narrow = window.matchMedia("(max-width: 760px)");
    const dock = window.matchMedia("(min-width: 1181px)");
    const onChange = () => {
      const next = narrow.matches ? "narrow" : dock.matches ? "dock" : "overlay";
      setViewport(next);
      setNavOpen(false);
      if (next === "narrow") setDrawerOpen(false);
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

  const shellStyle = {
    "--eoc-shell-rail-width": compactNav ? "64px" : "224px",
    "--eoc-shell-drawer-width": `${drawerWidth}px`,
  } as CSSProperties;

  function openDrawer(invoker: HTMLElement) {
    drawerInvoker.current = invoker;
    focusDrawer.current = true;
    setDrawerOpen(true);
  }

  function closeDrawer() {
    restoreDrawerFocus.current = true;
    setDrawerOpen(false);
  }

  function closeNavigation(target: "opener" | "workspace" | null) {
    navFocusTarget.current = target;
    setNavOpen(false);
  }

  function resizeFromPointer(event: ReactPointerEvent<HTMLDivElement>) {
    pointerCleanup.current?.();
    const startX = event.clientX;
    const startWidth = drawerWidth;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    target.setPointerCapture(pointerId);
    const move = (next: PointerEvent) => setDrawerWidth(clampDrawer(startWidth + startX - next.clientX));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
      pointerCleanup.current = null;
    };
    pointerCleanup.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
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
    if (event.key === "Home") setDrawerWidth(MIN_DRAWER);
    else if (event.key === "End") setDrawerWidth(MAX_DRAWER);
    else setDrawerWidth((current) => clampDrawer(current + (event.key === "ArrowLeft" ? 16 : -16)));
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
        <div className="eoc-shell-command-fact"><span>Operational period</span><strong>{props.periodLabel}</strong></div>
        <div className="eoc-shell-command-fact"><span>Acting position</span><strong>{props.positionLabel}</strong></div>
        <div className="eoc-shell-sync" data-state={props.sync.state}><span aria-hidden="true" />{props.sync.label}</div>
        <span className="eoc-shell-handling" aria-label="Handling marking: FOUO">FOUO</span>
        <button className="eoc-shell-notifications" type="button" aria-label={`Notifications, ${props.notificationCount} unread`} aria-expanded={drawerOpen} onClick={(event) => openDrawer(event.currentTarget)}>
          <Icon name={destinationIconByKey.alerts} size={20} decorative />
          {props.notificationCount > 0 ? <span>{props.notificationCount}</span> : null}
        </button>
        <details className="eoc-shell-account">
          <summary role="button" aria-label="Account menu"><span aria-hidden="true">{props.userName.trim().charAt(0) || "?"}</span><strong>{props.userName}</strong></summary>
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
            <button type="button" className="eoc-shell-compact-toggle" aria-pressed={compactNav} onClick={() => setCompactNav((current) => !current)}>
              <span>{compactNav ? "Expand navigation" : "Compact navigation"}</span>
            </button>
          </div>
          <div className="eoc-shell-nav-scroll">
            {props.nav.map((group) => (
              <section key={group.key} aria-labelledby={`nav-group-${group.key}`}>
                <h2 id={`nav-group-${group.key}`}>{group.label}</h2>
                {group.items.map((item) => {
                  const active = item.key === props.activeNav;
                  return (
                    <button key={item.key} type="button" aria-current={active ? "page" : undefined} aria-label={compactNav ? item.label : undefined} onClick={() => { props.onNavigate(item.key); closeNavigation(viewport === "narrow" ? "workspace" : null); }}>
                      <Icon name={destinationIconByKey[item.icon]} size={20} selected={active} decorative />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </nav>

        <main ref={mainRef} id="main" className="eoc-shell-main" tabIndex={-1} aria-hidden={(navModal || drawerModal) || undefined} inert={(navModal || drawerModal) || undefined}>
          <header className="eoc-shell-page-header">
            <div><span>{props.page.group}</span><h1>{props.page.title}</h1><p>{props.page.scope} · {props.sync.label}</p></div>
            {!drawerOpen ? <button ref={drawerOpener} type="button" onClick={(event) => openDrawer(event.currentTarget)}>Open context</button> : null}
          </header>
          <div className="eoc-shell-workspace">{props.children}</div>
        </main>

        {drawerModal ? <div className="eoc-shell-drawer-overlay" aria-hidden="true" onPointerDown={closeDrawer} /> : null}
        <aside ref={drawerRef} className="eoc-shell-drawer" data-open={drawerOpen || undefined} role={drawerModal ? "dialog" : "complementary"} aria-modal={drawerModal || undefined} aria-labelledby="eoc-shell-context-title" onKeyDown={onDrawerKeyDown}>
          <div className="eoc-shell-resizer" role="separator" aria-label="Resize context drawer" aria-orientation="vertical" aria-valuemin={MIN_DRAWER} aria-valuemax={MAX_DRAWER} aria-valuenow={drawerWidth} aria-hidden={viewport === "narrow" || undefined} tabIndex={viewport === "narrow" ? -1 : 0} onPointerDown={resizeFromPointer} onKeyDown={resizeFromKeyboard} />
          <header><h2 ref={drawerHeading} id="eoc-shell-context-title" tabIndex={-1}>Context</h2><button type="button" aria-label="Close context drawer" onClick={closeDrawer}>×</button></header>
          <div className="eoc-shell-drawer-content">{props.rightDock}</div>
        </aside>
      </div>
    </div>
  );
}
