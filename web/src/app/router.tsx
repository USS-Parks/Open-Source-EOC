import { useCallback, useEffect, useState } from "react";

/**
 * The center surface the console is showing, kept in the URL hash so every
 * surface is deep-linkable and the browser back button works, with no
 * router dependency. "map" is the default map-first view; list sections
 * (boards, sitreps, alerts) and their detail views share the same hash.
 */
export type Surface =
  | { readonly kind: "map" }
  | {
      readonly kind: "dashboard";
      readonly id?: string;
      readonly filterField?: string;
      readonly filterEquals?: string;
    }
  | { readonly kind: "boards" }
  | { readonly kind: "board"; readonly id: string }
  | { readonly kind: "sitreps" }
  | { readonly kind: "sitrep"; readonly id: string }
  | { readonly kind: "forms" }
  | { readonly kind: "iap" }
  | { readonly kind: "files" }
  | { readonly kind: "incidents" }
  | { readonly kind: "datasets" }
  | { readonly kind: "resources" }
  | { readonly kind: "aar" }
  | { readonly kind: "feeds" }
  | { readonly kind: "messages" }
  | { readonly kind: "smartforms" }
  | { readonly kind: "tracking" }
  | { readonly kind: "alerts" }
  | { readonly kind: "lifelines" }
  | { readonly kind: "lifeline"; readonly id: string }
  | { readonly kind: "esf"; readonly id: string }
  | { readonly kind: "tasks" }
  | { readonly kind: "field-reports" }
  | { readonly kind: "periods" }
  | { readonly kind: "participants" }
  | { readonly kind: "jic" }
  | { readonly kind: "templates" }
  | { readonly kind: "settings" }
  | { readonly kind: "board-design"; readonly id: string }
  | { readonly kind: "not-found"; readonly path: string };

/** The rail section a surface belongs to (board detail lives under boards). */
export function sectionOf(surface: Surface): string {
  switch (surface.kind) {
    case "board":
      return "boards";
    case "sitrep":
      return "sitreps";
    case "dashboard":
      return "overview";
    case "incidents":
      return "incidentSetup";
    case "smartforms":
      return "smartForms";
    case "field-reports":
      return "fieldReports";
    case "periods":
      return "operationalPeriods";
    case "lifeline":
    case "esf":
      return "lifelines";
    case "board-design":
      return "boards";
    case "not-found":
      return "";
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
    case "dashboard": {
      if (!id) return { kind: "dashboard" };
      const parts = id.split("/");
      const dashId = parts[0]!;
      const [, field, value] = parts;
      return field && value !== undefined
        ? { kind: "dashboard", id: dashId, filterField: field, filterEquals: decodeURIComponent(value) }
        : { kind: "dashboard", id: dashId };
    }
    case "boards":
      return { kind: "boards" };
    case "board": {
      const [boardId, child] = id.split("/");
      if (!boardId) return { kind: "boards" };
      return child === "design" ? { kind: "board-design", id: boardId } : { kind: "board", id: boardId };
    }
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
    case "datasets":
      return { kind: "datasets" };
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
    case "lifelines":
      return { kind: "lifelines" };
    case "lifeline":
      return id ? { kind: "lifeline", id } : { kind: "lifelines" };
    case "esf":
      return id ? { kind: "esf", id } : { kind: "lifelines" };
    case "tasks":
      return { kind: "tasks" };
    case "field-reports":
      return { kind: "field-reports" };
    case "periods":
      return { kind: "periods" };
    case "participants":
      return { kind: "participants" };
    case "jic":
      return { kind: "jic" };
    case "templates":
      return { kind: "templates" };
    case "settings":
      return { kind: "settings" };
    default:
      return head ? { kind: "not-found", path: clean } : { kind: "map" };
  }
}

export function surfaceHash(surface: Surface): string {
  switch (surface.kind) {
    case "map":
      return "#/";
    case "dashboard":
      if (!surface.id) return "#/dashboard";
      return surface.filterField && surface.filterEquals !== undefined
        ? `#/dashboard/${surface.id}/${surface.filterField}/${encodeURIComponent(surface.filterEquals)}`
        : `#/dashboard/${surface.id}`;
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
    case "datasets":
      return "#/datasets";
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
    case "lifelines":
      return "#/lifelines";
    case "lifeline":
      return `#/lifeline/${surface.id}`;
    case "esf":
      return `#/esf/${surface.id}`;
    case "tasks":
      return "#/tasks";
    case "field-reports":
      return "#/field-reports";
    case "periods":
      return "#/periods";
    case "participants":
      return "#/participants";
    case "jic":
      return "#/jic";
    case "templates":
      return "#/templates";
    case "settings":
      return "#/settings";
    case "board-design":
      return `#/board/${surface.id}/design`;
    case "not-found":
      return `#/${surface.path}`;
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
