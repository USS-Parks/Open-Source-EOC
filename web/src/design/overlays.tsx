import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ActionButton } from "./controls.js";
import "./forms.css";

export interface OverlayProps {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly unsaved?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  readonly onDiscard?: () => void | Promise<void>;
  readonly onClose: () => void;
}

function focusable(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function trapTab(event: KeyboardEvent<HTMLElement>, container: HTMLElement) {
  if (event.key !== "Tab") return;
  const elements = focusable(container);
  if (elements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = elements[0]!;
  const last = elements.at(-1)!;
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

function Overlay({
  kind,
  open,
  title,
  children,
  footer,
  unsaved = false,
  initialFocusRef,
  onDiscard,
  onClose,
}: OverlayProps & { readonly kind: "drawer" | "modal" }) {
  const titleId = useId();
  const guardTitleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const guardRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const guardReturnFocus = useRef<HTMLElement | null>(null);
  const guardWasOpen = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirming(false);
      return;
    }
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = initialFocusRef?.current ?? (panelRef.current ? focusable(panelRef.current)[0] : null) ?? panelRef.current;
    target?.focus();
    return () => previousFocus.current?.focus();
  }, [open, initialFocusRef]);

  useEffect(() => {
    if (confirming) {
      guardWasOpen.current = true;
      guardRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    } else if (guardWasOpen.current) {
      guardWasOpen.current = false;
      (guardReturnFocus.current ?? panelRef.current)?.focus();
    }
  }, [confirming]);

  if (!open) return null;

  function requestClose() {
    if (unsaved) {
      const active = document.activeElement;
      guardReturnFocus.current = active instanceof HTMLElement && panelRef.current?.contains(active) ? active : panelRef.current;
      setConfirming(true);
    }
    else onClose();
  }

  async function discard() {
    setDiscarding(true);
    setDiscardError(null);
    try {
      await onDiscard?.();
      onClose();
    } catch (error) {
      setDiscardError(error instanceof Error ? error.message : "Changes could not be discarded");
    } finally {
      setDiscarding(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (confirming && guardRef.current) {
      if (event.key === "Escape") {
        event.preventDefault();
        setConfirming(false);
        return;
      }
      trapTab(event, guardRef.current);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }
    if (panelRef.current) trapTab(event, panelRef.current);
  }

  return (
    <div
      className="eoc-overlay-backdrop"
      data-kind={kind}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section
        ref={panelRef}
        className={`eoc-overlay-panel eoc-${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="eoc-overlay-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="eoc-overlay-close" aria-label={`Close ${title}`} onClick={requestClose}>×</button>
        </header>
        <div className="eoc-overlay-body">{children}</div>
        {footer ? <footer className="eoc-overlay-footer">{footer}</footer> : null}
        {confirming ? (
          <div ref={guardRef} className="eoc-unsaved-guard" role="alertdialog" aria-modal="true" aria-labelledby={guardTitleId}>
            <strong id={guardTitleId}>Discard unsaved changes?</strong>
            <p>Your entered values will be lost if they are not stored as a draft.</p>
            {discardError ? <p role="alert">{discardError}</p> : null}
            <div>
              <ActionButton kind="primary" onClick={() => setConfirming(false)}>Keep editing</ActionButton>
              <ActionButton kind="danger" loading={discarding} loadingLabel="Discarding…" onClick={() => void discard()}>Discard changes</ActionButton>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function Drawer(props: OverlayProps) {
  return <Overlay {...props} kind="drawer" />;
}

export function ModalDialog(props: OverlayProps) {
  return <Overlay {...props} kind="modal" />;
}
