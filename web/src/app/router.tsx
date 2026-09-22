import { useCallback, useEffect, useState } from "react";

/**
 * The center surface the console is showing, kept in the URL hash so every
 * surface is deep-linkable and the browser back button works, with no
 * router dependency. "map" is the default map-first view; list sections
 * (boards, sitreps, alerts) and their detail views share the same hash.
 */
export type Surface =
  | {
      readonly kind: "map";
      readonly datasetId?: string;
      readonly featureId?: string;
    }
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
  | { readonly kind: "iap"; readonly id?: string }
  | { readonly kind: "files" }
  | { readonly kind: "incidents" }
  | { readonly kind: "datasets" }
  | { readonly kind: "resources"; readonly id?: string }
  | { readonly kind: "aar" }
  | { readonly kind: "feeds" }
  | { readonly kind: "messages" }
  | { readonly kind: "smartforms" }
  | { readonly kind: "tracking" }
  | { readonly kind: "alerts" }
  | { readonly kind: "lifelines" }
  | { readonly kind: "lifeline"; readonly id: string }
  | { readonly kind: "esf"; readonly id?: string }
  | { readonly kind: "tasks" }
  | { readonly kind: "field-reports" }
  | { readonly kind: "periods" }
  | { readonly kind: "participants" }
  | { readonly kind: "jic" }
  | { readonly kind: "templates" }
  | { readonly kind: "settings" }
  | { readonly kind: "board-design"; readonly id: string }
  | { readonly kind: "not-found"; readonly path: string };

export interface RouteContext {
  readonly incidentId?: string;
  /** null is an explicit "Not set" choice; undefined means the link did not
   * carry period context and may hydrate from saved preferences. */
  readonly periodRevision?: number | null;
  readonly view?: string;
  readonly filter?: string;
  readonly recordId?: string;
  readonly returnTo?: string;
}

export interface AppRoute {
  readonly surface: Surface;
  readonly context: RouteContext;
}

const MAX_HASH_LENGTH = 2048;
const MAX_CONTEXT_VALUE = 256;

function bounded(value: string | null, max = MAX_CONTEXT_VALUE): string | undefined {
  return value && value.length <= max ? value : undefined;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

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

function parseSurfacePath(clean: string): Surface {
  const slash = clean.indexOf("/");
  const head = slash === -1 ? clean : clean.slice(0, slash);
  const id = slash === -1 ? "" : clean.slice(slash + 1);
  switch (head) {
    case "map": {
      if (!id) return { kind: "map" };
      const [rawDatasetId, rawFeatureId, extra] = id.split("/");
      const datasetId = rawDatasetId ? safeDecode(rawDatasetId) : null;
      const featureId = rawFeatureId ? safeDecode(rawFeatureId) : null;
      return datasetId && featureId && !extra && datasetId.length <= 128 && featureId.length <= 500
        ? { kind: "map", datasetId, featureId }
        : { kind: "not-found", path: "invalid-link" };
    }
    case "dashboard": {
      if (!id) return { kind: "dashboard" };
      const parts = id.split("/");
      const dashId = parts[0]!;
      const [, field, value] = parts;
      const decoded = value === undefined ? null : safeDecode(value);
      return field && value !== undefined && decoded !== null
        ? { kind: "dashboard", id: dashId, filterField: field, filterEquals: decoded }
        : value !== undefined && decoded === null
          ? { kind: "not-found", path: "invalid-link" }
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
      return id ? { kind: "iap", id } : { kind: "iap" };
    case "files":
      return { kind: "files" };
    case "incidents":
      return { kind: "incidents" };
    case "datasets":
      return { kind: "datasets" };
    case "resources":
      return id ? { kind: "resources", id } : { kind: "resources" };
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
      return id ? { kind: "esf", id } : { kind: "esf" };
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

export function parseRouteHash(hash: string): AppRoute {
  if (hash.length > MAX_HASH_LENGTH) return { surface: { kind: "not-found", path: "invalid-link" }, context: {} };
  const clean = hash.replace(/^#\/?/, "");
  const question = clean.indexOf("?");
  const path = question === -1 ? clean : clean.slice(0, question);
  const rawQuery = question === -1 ? "" : clean.slice(question + 1);
  if (safeDecode(rawQuery) === null) return { surface: { kind: "not-found", path: "invalid-link" }, context: {} };
  const query = new URLSearchParams(rawQuery);
  const known = ["incident", "period", "view", "filter", "record", "return"] as const;
  if (known.some((key) => query.getAll(key).length > 1)) {
    return { surface: { kind: "not-found", path: "invalid-link" }, context: {} };
  }
  const incidentId = bounded(query.get("incident"), 128);
  const view = bounded(query.get("view"));
  const filter = bounded(query.get("filter"));
  const recordId = bounded(query.get("record"), 128);
  const periodValue = query.get("period");
  const periodRevision = periodValue === "unset"
    ? null
    : periodValue && /^\d{1,10}$/.test(periodValue) && Number(periodValue) > 0
      ? Number(periodValue)
      : undefined;
  const returnValue = bounded(query.get("return"), 512);
  const returnTo = returnValue?.startsWith("#/") && !returnValue.includes("return=") ? returnValue : undefined;
  if ((query.has("incident") && !incidentId) || (query.has("period") && periodRevision === undefined)
    || (query.has("view") && !view) || (query.has("filter") && !filter)
    || (query.has("record") && !recordId) || (query.has("return") && !returnTo)) {
    return { surface: { kind: "not-found", path: "invalid-link" }, context: {} };
  }
  return {
    surface: parseSurfacePath(path),
    context: {
      ...(incidentId ? { incidentId } : {}),
      ...(periodRevision !== undefined ? { periodRevision } : {}),
      ...(view ? { view } : {}),
      ...(filter ? { filter } : {}),
      ...(recordId ? { recordId } : {}),
      ...(returnTo ? { returnTo } : {}),
    },
  };
}

export function parseHash(hash: string): Surface {
  return parseRouteHash(hash).surface;
}

function surfacePath(surface: Surface): string {
  switch (surface.kind) {
    case "map":
      return surface.datasetId && surface.featureId
        ? `#/map/${encodeURIComponent(surface.datasetId)}/${encodeURIComponent(surface.featureId)}`
        : "#/";
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
      return surface.id ? `#/iap/${surface.id}` : "#/iap";
    case "files":
      return "#/files";
    case "incidents":
      return "#/incidents";
    case "datasets":
      return "#/datasets";
    case "resources":
      return surface.id ? `#/resources/${surface.id}` : "#/resources";
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
      return surface.id ? `#/esf/${surface.id}` : "#/esf";
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

export function surfaceHash(surface: Surface, context: RouteContext = {}): string {
  const path = surfacePath(surface);
  const query = new URLSearchParams();
  if (context.incidentId) query.set("incident", context.incidentId);
  if (context.periodRevision === null) query.set("period", "unset");
  else if (context.periodRevision) query.set("period", String(context.periodRevision));
  if (context.view) query.set("view", context.view);
  if (context.filter) query.set("filter", context.filter);
  if (context.recordId) query.set("record", context.recordId);
  if (context.returnTo) query.set("return", context.returnTo);
  const encoded = query.toString();
  return encoded ? `${path}?${encoded}` : path;
}

export function replaceRouteContext(context: RouteContext): void {
  const route = parseRouteHash(location.hash);
  history.replaceState(history.state, "", surfaceHash(route.surface, context));
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useSurface(): {
  surface: Surface;
  routeContext: RouteContext;
  navigate: (surface: Surface, context?: RouteContext) => void;
} {
  const [route, setRoute] = useState<AppRoute>(() => parseRouteHash(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRouteHash(location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((next: Surface, context: RouteContext = {}) => {
    const hash = surfaceHash(next, context);
    if (location.hash === hash) setRoute({ surface: next, context });
    else location.hash = hash; // the hashchange listener updates state
  }, []);
  return { surface: route.surface, routeContext: route.context, navigate };
}
