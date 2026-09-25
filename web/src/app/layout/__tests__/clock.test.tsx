// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { ApiClient } from "../../api/client.js";
import { ClockNotice } from "../ClockNotice.js";
import { clockNoticeText, clockOff, clockOffsetMs, describeOffset } from "../clock.js";

afterEach(cleanup);

const SECOND = 1000;

describe("the device's clock against the server's", () => {
  it("measures from the Date header at the middle of the request, and refuses a slow or missing answer", () => {
    const sent = Date.parse("2026-09-25T17:00:00.000Z");
    // The server said 17:02:00 while the request took 200 ms: the device is two minutes behind.
    expect(clockOffsetMs("Fri, 25 Sep 2026 17:02:00 GMT", sent, sent + 200)).toBe(2 * 60 * SECOND + 400);
    expect(clockOffsetMs("Fri, 25 Sep 2026 16:59:30 GMT", sent, sent + 100)).toBe(-29_550);
    expect(clockOffsetMs(null, sent, sent + 100)).toBeNull();
    expect(clockOffsetMs("not a date", sent, sent + 100)).toBeNull();
    expect(clockOffsetMs("Fri, 25 Sep 2026 17:02:00 GMT", sent, sent + 6 * SECOND)).toBeNull();
    expect(clockOffsetMs("Fri, 25 Sep 2026 17:02:00 GMT", sent, sent - 1)).toBeNull();
  });

  it("says how far off, and which way, past 30 seconds", () => {
    expect(clockOff(30 * SECOND)).toBe(false);
    expect(clockOff(-30.5 * SECOND)).toBe(true);
    expect(clockOff(null)).toBe(false);
    expect(describeOffset(45 * SECOND)).toBe("45 seconds");
    expect(describeOffset(-61 * SECOND)).toBe("1 minute 1 second");
    expect(describeOffset(125 * SECOND)).toBe("2 minutes 5 seconds");
    expect(describeOffset(3 * 3600 * SECOND + 2 * 60 * SECOND + 9 * SECOND)).toBe("3 hours 2 minutes");
    expect(describeOffset(2 * 86_400 * SECOND)).toBe("2 days");
    expect(clockNoticeText(120 * SECOND)).toBe("This device's clock is 2 minutes behind the server's.");
    expect(clockNoticeText(-90 * SECOND)).toBe("This device's clock is 1 minute 30 seconds ahead of the server's.");
  });

  it("reads each API answer's Date header and tells listeners when the offset moves", async () => {
    let serverAhead = 0;
    const fetchImpl = (async () => new Response(JSON.stringify({ status: "ok", version: "test" }), {
      status: 200,
      headers: { "content-type": "application/json", date: new Date(Date.now() + serverAhead).toUTCString() },
    })) as typeof fetch;
    const client = new ApiClient({ fetchImpl });
    const heard: number[] = [];
    const stop = client.onServerClock((offset) => heard.push(offset));
    expect(client.serverClockOffset()).toBeNull();
    await client.serverHealth();
    expect(Math.abs(client.serverClockOffset()!)).toBeLessThan(2 * SECOND);
    expect(heard).toHaveLength(1);
    serverAhead = 5 * 60 * SECOND;
    await client.serverHealth();
    expect(heard).toHaveLength(2);
    expect(heard[1]!).toBeGreaterThan(298 * SECOND);
    stop();
    serverAhead = 0;
    await client.serverHealth();
    expect(heard).toHaveLength(2);
  });

  it("shows the notice past 30 seconds, clears it when the clocks agree, and lets the viewer dismiss it", async () => {
    let listener: ((offset: number) => void) | null = null;
    const client = {
      serverClockOffset: () => -3 * 60 * SECOND,
      onServerClock: (next: (offset: number) => void) => {
        listener = next;
        return () => { listener = null; };
      },
    };
    const view = render(<ClockNotice client={client} />);
    const notice = view.getByRole("status");
    expect(notice.textContent).toContain("This device's clock is 3 minutes ahead of the server's.");
    expect(notice.textContent).toContain("Two-step sign-in codes can be refused");
    expect((await axe.run(view.container)).violations).toEqual([]);

    act(() => listener!(2 * SECOND));
    expect(view.queryByRole("status")).toBeNull();
    act(() => listener!(45 * SECOND));
    expect(view.getByRole("status").textContent).toContain("45 seconds behind");
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    expect(view.queryByRole("status")).toBeNull();
    // A dismissed notice returns when the clocks drift a further 30 seconds apart.
    act(() => listener!(60 * SECOND));
    expect(view.queryByRole("status")).toBeNull();
    act(() => listener!(80 * SECOND));
    expect(view.getByRole("status").textContent).toContain("1 minute 20 seconds behind");
  });
});
