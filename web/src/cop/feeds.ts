import type { ThemeName } from "../design/tokens.js";
import { boardLayerSpecs } from "./layers.js";
import { symbolStatusFor } from "./symbology.js";
import type { CopFeatureCollection } from "./layers.js";

/**
 * Feed layers on the COP (VEOC-19, F18). Feed features are read-only:
 * they carry provenance (_source), age, and a staleness flag from the
 * server. A stale feed's features drop to the unknown frame, whatever
 * their severity claimed, because old data must not present as current.
 */

export interface FeedLayerHealth {
  readonly name: string;
  readonly stale: boolean;
  readonly ageSeconds: number | null;
}

export function tagFeedFeatures(
  fc: CopFeatureCollection,
  feed: FeedLayerHealth,
): CopFeatureCollection {
  return {
    type: "FeatureCollection",
    features: fc.features.map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        _source: feed.name,
        _stale: feed.stale,
        _ageSeconds: feed.ageSeconds,
        _ageLabel: formatAge(feed.ageSeconds),
        _symbolStatus: feed.stale ? "unknown" : symbolStatusFor(f.properties),
      },
    })),
  };
}

export function feedSourceId(feedId: string): string {
  return `feed-${feedId}`;
}

export function feedLayerIds(feedId: string): string[] {
  const src = feedSourceId(feedId);
  return [`${src}-fill`, `${src}-line`, `${src}-point`];
}

/** Same three-layer shape as boards, under the feed's own source id. */
export function feedLayerSpecs(feedId: string, theme: ThemeName): unknown[] {
  return boardLayerSpecs(feedId, theme).map((spec) => {
    const s = spec as Record<string, unknown>;
    const id = (s.id as string).replace(/^board-/, "feed-");
    return { ...s, id, source: feedSourceId(feedId) };
  });
}

/** Human age for the provenance line: "live", "4m ago", "2h ago", "never". */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return "never";
  if (seconds < 60) return "live";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
