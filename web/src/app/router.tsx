import { useCallback, useEffect, useState } from "react";

/**
 * The center surface the console is showing, kept in the URL hash so every
 * surface is deep-linkable and the browser back button works, with no
 * router dependency. "map" is the default map-first view; list sections
 * (boards, sitreps, alerts) and their detail views share the same hash.
 */
export type Surface =
  | { readonly kind: "map" }
  | { readonly kind: "dashboard"; readonly id?: string }
  | { readonly kind: "boards" }
  | { readonly kind: "board"; readonly id: string }
  | { readonly kind: "sitreps" }
  | { readonly kind: "sitrep"; readonly id: string }
  | { readonly kind: "forms" }
  | { readonly kind: "iap" }
  | { readonly kind: "files" }
  | { readonly kind: "incidents" }
  | { readonly kind: "resources" }
  | { readonly kind: "aar" }
  | { readonly kind: "feeds" }
  | { readonly kind: "messages" }
  | { readonly kind: "smartforms" }
  | { readonly kind: "tracking" }
  | { readonly kind: "alerts" };

/** The rail section a surface belongs to (board detail lives under boards). */
export function sectionOf(surface: Surface): string {
  switch (surface.kind) {
    case "board":
      return "boards";
    case "sitrep":
      return "sitreps";
    default:
      return surface.kind;
  }
}

export function parseHash(hash: string): Surface {
  const clean = hash.replace(/^#\/?/, "");
  const slash = clean.indexOf("/");
  const head = slash === -1 ? clean : clean.slice(0, slash);
  const id = slash === -1 ? "" : clean.slice(slash + 1);
  switch (head) {
    case "dashboard":
      return id ? { kind: "dashboard", id } : { kind: "dashboard" };
    case "boards":
      return { kind: "boards" };
    case "board":
      return id ? { kind: "board", id } : { kind: "boards" };
    case "sitreps":
      return { kind: "sitreps" };
    case "sitrep":
      return id ? { kind: "sitrep", id } : { kind: "sitreps" };
    case "forms":
      return { kind: "forms" };
    case "iap":
      return { kind: "iap" };
    case "files":
      return { kind: "files" };
    case "incidents":
      return { kind: "incidents" };
    case "resources":
      return { kind: "resources" };
    case "aar":
      return { kind: "aar" };
    case "feeds":
      return { kind: "feeds" };
    case "messages":
      return { kind: "messages" };
    case "smartforms":
      return { kind: "smartforms" };
    case "tracking":
      return { kind: "tracking" };
    case "alerts":
      return { kind: "alerts" };
    default:
      return { kind: "map" };
  }
}

export function surfaceHash(surface: Surface): string {
  switch (surface.kind) {
    case "map":
      return "#/";
    case "dashboard":
      return surface.id ? `#/dashboard/${surface.id}` : "#/dashboard";
    case "boards":
      return "#/boards";
    case "board":
      return `#/board/${surface.id}`;
    case "sitreps":
      return "#/sitreps";
    case "sitrep":
      return `#/sitrep/${surface.id}`;
    case "forms":
      return "#/forms";
    case "iap":
      return "#/iap";
    case "files":
      return "#/files";
    case "incidents":
      return "#/incidents";
    case "resources":
      return "#/resources";
    case "aar":
      return "#/aar";
    case "feeds":
      return "#/feeds";
    case "messages":
      return "#/messages";
    case "smartforms":
      return "#/smartforms";
    case "tracking":
      return "#/tracking";
    case "alerts":
      return "#/alerts";
  }
}

export function useSurface(): { surface: Surface; navigate: (surface: Surface) => void } {
  const [surface, setSurface] = useState<Surface>(() => parseHash(location.hash));
  useEffect(() => {
    const onHash = () => setSurface(parseHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((next: Surface) => {
    const hash = surfaceHash(next);
    if (location.hash === hash) setSurface(next);
    else location.hash = hash; // the hashchange listener updates state
  }, []);
  return { surface, navigate };
}
