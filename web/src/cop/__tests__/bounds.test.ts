import { describe, expect, it, vi } from "vitest";
import {
  bindCopMapBounds,
  normalizeCopMapBounds,
  type CopMapBounds,
} from "../CopMap.js";

function readableBounds(bounds: CopMapBounds) {
  return {
    getWest: () => bounds[0],
    getSouth: () => bounds[1],
    getEast: () => bounds[2],
    getNorth: () => bounds[3],
  };
}

class BoundsMapStub {
  bounds: CopMapBounds;
  readonly listeners = new Set<() => void>();

  constructor(bounds: CopMapBounds) {
    this.bounds = bounds;
  }

  getBounds() {
    return readableBounds(this.bounds);
  }

  on(type: "moveend", listener: () => void) {
    expect(type).toBe("moveend");
    this.listeners.add(listener);
  }

  off(type: "moveend", listener: () => void) {
    expect(type).toBe("moveend");
    this.listeners.delete(listener);
  }

  moveend() {
    for (const listener of this.listeners) listener();
  }
}

describe("COP viewport bounds callback (H12-CB)", () => {
  it("reports initial ready and moveend bounds through the current callback, then unbinds", () => {
    const map = new BoundsMapStub([-124, 32, -114, 42]);
    const first = vi.fn();
    const replacement = vi.fn();
    let callback: ((bounds: CopMapBounds) => void) | undefined = first;

    const unbind = bindCopMapBounds(map, () => callback);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenLastCalledWith([-124, 32, -114, 42]);

    map.bounds = [-123, 33, -115, 41];
    map.moveend();
    expect(first).toHaveBeenLastCalledWith([-123, 33, -115, 41]);

    callback = replacement;
    map.bounds = [-122, 34, -116, 40];
    map.moveend();
    expect(first).toHaveBeenCalledTimes(2);
    expect(replacement).toHaveBeenCalledWith([-122, 34, -116, 40]);

    unbind();
    map.bounds = [-121, 35, -117, 39];
    map.moveend();
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(map.listeners.size).toBe(0);
  });

  it("normalizes world copies and safely bounds wrapped or full-world views", () => {
    expect(normalizeCopMapBounds(readableBounds([190, 32, 200, 42]))).toEqual([
      -170, 32, -160, 42,
    ]);
    expect(normalizeCopMapBounds(readableBounds([170, 32, 190, 42]))).toEqual([
      -180, 32, 180, 42,
    ]);
    expect(normalizeCopMapBounds(readableBounds([-200, 32, 200, 42]))).toEqual([
      -180, 32, 180, 42,
    ]);
    expect(normalizeCopMapBounds(readableBounds([10, 95, 20, -95]))).toEqual([
      10, -90, 20, 90,
    ]);
  });
});
