import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * The page header's slots. A surface places its page actions and, when it has
 * one, its own subtitle line in the shell's page header, next to the title the
 * shell already shows, so every screen keeps one header.
 */
export interface PageChromeSlots {
  readonly actions: HTMLElement | null;
  readonly subtitle: HTMLElement | null;
}

export const PageChromeContext = createContext<PageChromeSlots>({ actions: null, subtitle: null });

export function PageActions(props: { readonly children: ReactNode }) {
  const target = useContext(PageChromeContext).actions;
  return target ? createPortal(props.children, target) : null;
}

export function PageSubtitle(props: { readonly children: ReactNode }) {
  const target = useContext(PageChromeContext).subtitle;
  return target ? createPortal(props.children, target) : null;
}
