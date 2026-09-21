import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import "./kit.css";

export type ActionButtonKind = "primary" | "secondary" | "quiet" | "danger";

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly kind?: ActionButtonKind;
  readonly loading?: boolean;
  readonly loadingLabel?: string;
}

export function ActionButton({
  kind = "secondary",
  loading = false,
  loadingLabel = "Working…",
  disabled,
  className,
  children,
  ...buttonProps
}: ActionButtonProps) {
  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? "button"}
      className={["eoc-kit-button", `is-${kind}`, className].filter(Boolean).join(" ")}
      data-primary={kind === "primary" || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <span className="eoc-kit-spinner" aria-hidden="true" /> : null}
      <span>{loading ? loadingLabel : children}</span>
    </button>
  );
}

export interface TabOption {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface TabsProps {
  readonly id: string;
  readonly label: string;
  readonly tabs: readonly TabOption[];
  readonly value: string;
  readonly onChange: (id: string) => void;
  readonly className?: string;
}

export function Tabs({ id, label, tabs, value, onChange, className }: TabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = tabs.filter((tab) => !tab.disabled);

  function move(currentId: string, direction: "next" | "previous" | "first" | "last") {
    if (enabled.length === 0) return;
    const current = Math.max(0, enabled.findIndex((tab) => tab.id === currentId));
    const index = direction === "first"
      ? 0
      : direction === "last"
        ? enabled.length - 1
        : direction === "next"
          ? (current + 1) % enabled.length
          : (current - 1 + enabled.length) % enabled.length;
    const next = enabled[index];
    if (!next) return;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const direction = event.key === "ArrowRight"
      ? "next"
      : event.key === "ArrowLeft"
        ? "previous"
        : event.key === "Home"
          ? "first"
          : event.key === "End"
            ? "last"
            : null;
    if (!direction) return;
    event.preventDefault();
    move(id, direction);
  }

  return (
    <div className={["eoc-kit-tabs", className].filter(Boolean).join(" ")} role="tablist" aria-label={label}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) refs.current.set(tab.id, element);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={`${id}-${tab.id}-tab`}
            aria-controls={`${id}-${tab.id}-panel`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface MenuProps {
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly className?: string;
}

export function Menu({ label, items, className }: MenuProps) {
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<"first" | "last" | null>(null);
  const enabled = items.filter((item) => !item.disabled);

  useEffect(() => {
    if (!open || !pendingFocus.current) return;
    const item = pendingFocus.current === "first" ? enabled[0] : enabled.at(-1);
    pendingFocus.current = null;
    if (item) itemRefs.current.get(item.id)?.focus();
  }, [open, enabled]);

  useEffect(() => {
    if (!open) return;
    function closeWhenOutside(event: Event) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("focusin", closeWhenOutside);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("focusin", closeWhenOutside);
    };
  }, [open]);

  function openAt(position: "first" | "last") {
    pendingFocus.current = position;
    setOpen(true);
  }

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function moveItem(id: string, direction: number) {
    const current = Math.max(0, enabled.findIndex((item) => item.id === id));
    const next = enabled[(current + direction + enabled.length) % enabled.length];
    if (next) itemRefs.current.get(next.id)?.focus();
  }

  return (
    <div
      ref={rootRef}
      className={["eoc-kit-menu", className].filter(Boolean).join(" ")}
      onBlurCapture={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="eoc-kit-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (open) setOpen(false);
          else openAt("first");
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openAt(event.key === "ArrowDown" ? "first" : "last");
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) close();
            else openAt("first");
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
      >
        {label}<span aria-hidden="true">▾</span>
      </button>
      {open ? (
        <div id={menuId} className="eoc-kit-menu-popup" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.id}
              ref={(element) => {
                if (element) itemRefs.current.set(item.id, element);
                else itemRefs.current.delete(item.id);
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              disabled={item.disabled}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect();
                close();
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  close();
                } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  moveItem(item.id, event.key === "ArrowDown" ? 1 : -1);
                } else if (event.key === "Home" || event.key === "End") {
                  event.preventDefault();
                  const target = event.key === "Home" ? enabled[0] : enabled.at(-1);
                  if (target) itemRefs.current.get(target.id)?.focus();
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export interface TooltipProps {
  readonly text: string;
  readonly children: ReactElement<{ "aria-describedby"?: string }>;
}

export function Tooltip({ text, children }: TooltipProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  if (!isValidElement(children)) throw new Error("Tooltip requires one element child");
  const existingDescription = children.props["aria-describedby"];
  const describedBy = visible
    ? [existingDescription, id].filter(Boolean).join(" ")
    : existingDescription;
  return (
    <span
      className="eoc-kit-tooltip"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocusCapture={() => setVisible(true)}
      onBlurCapture={() => setVisible(false)}
      onKeyDownCapture={(event) => {
        if (event.key === "Escape" && visible) {
          event.preventDefault();
          setVisible(false);
        }
      }}
    >
      {cloneElement(children, describedBy ? { "aria-describedby": describedBy } : {})}
      {visible ? <span id={id} className="eoc-kit-tooltip-popup" role="tooltip">{text}</span> : null}
    </span>
  );
}

export interface ProgressIndicatorProps {
  readonly label: string;
  readonly value?: number;
  readonly max?: number;
  readonly valueText?: string;
  readonly className?: string;
}

export function ProgressIndicator({ label, value, max = 100, valueText, className }: ProgressIndicatorProps) {
  if (!Number.isFinite(max) || max <= 0) throw new RangeError("Progress max must be greater than zero");
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > max)) {
    throw new RangeError("Progress value must be between zero and max");
  }
  const percent = value === undefined ? null : (value / max) * 100;
  const complete = value !== undefined && value === max;
  return (
    <div className={["eoc-kit-progress", className].filter(Boolean).join(" ")} data-complete={complete || undefined}>
      <div className="eoc-kit-progress-label">
        <span>{label}</span>
        <strong>{valueText ?? (percent === null ? "In progress" : `${Math.round(percent)}%`)}</strong>
      </div>
      <div
        className="eoc-kit-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText ?? (percent === null ? "In progress" : undefined)}
      >
        <span className={percent === null ? "is-indeterminate" : undefined} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>
    </div>
  );
}
