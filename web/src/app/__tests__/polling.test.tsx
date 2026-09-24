// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolled } from "../data/hooks.js";

function Probe(props: { load: () => Promise<string> }) {
  const state = usePolled(props.load, 1000, []);
  return <span data-testid="state">{`${state.loading ? "loading" : "idle"} ${state.data ?? "none"}`}</span>;
}

const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => vi.advanceTimersByTime(ms));
const shown = () => screen.getByTestId("state").textContent;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

describe("background polling", () => {
  it("keeps the last data on screen while a background refresh runs", async () => {
    let finish: (value: string) => void = () => undefined;
    const load = vi.fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<Probe load={load} />);
    await flush();
    expect(shown()).toBe("idle first");
    await advance(1000);
    expect(load).toHaveBeenCalledTimes(2);
    expect(shown()).toBe("idle first");
    await act(async () => finish("second"));
    expect(shown()).toBe("idle second");
  });

  it("pauses while the page is hidden and refreshes at once when it shows again", async () => {
    const load = vi.fn(async () => "data");
    render(<Probe load={load} />);
    await flush();
    await act(async () => setVisibility("hidden"));
    await advance(10_000);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => setVisibility("visible"));
    expect(load).toHaveBeenCalledTimes(2);
    await advance(999);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("doubles the wait after each failure, up to five minutes, and restores it after a success", async () => {
    let failing = true;
    const load = vi.fn(async () => {
      if (failing) throw new Error("server unreachable");
      return "back";
    });
    render(<Probe load={load} />);
    await flush();
    await advance(1000);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(1999);
    expect(load).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(3);
    for (const wait of [4000, 8000, 16_000, 32_000, 64_000, 128_000, 256_000]) await advance(wait);
    expect(load).toHaveBeenCalledTimes(10);
    // Doubling would wait 512 seconds next; the ceiling holds it at five minutes.
    await advance(299_999);
    expect(load).toHaveBeenCalledTimes(10);
    await advance(1);
    expect(load).toHaveBeenCalledTimes(11);
    failing = false;
    await advance(300_000);
    expect(load).toHaveBeenCalledTimes(12);
    expect(shown()).toBe("idle back");
    await advance(1000);
    expect(load).toHaveBeenCalledTimes(13);
  });
});
