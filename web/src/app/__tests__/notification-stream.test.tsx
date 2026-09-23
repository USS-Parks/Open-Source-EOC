// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawNotification } from "../api/client.js";
import { useNotifications } from "../data/hooks.js";

class FakeSocket {
  static opened: FakeSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: string[] = [];
  constructor(readonly url: URL) {
    FakeSocket.opened.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.onclose?.();
  }
}

function Probe(props: { client: Parameters<typeof useNotifications>[0] }) {
  const inbox = useNotifications(props.client);
  return <span data-testid="inbox">{`${inbox.data?.length ?? 0} ${inbox.live ? "live" : "down"}`}</span>;
}

const flush = () => act(async () => {});

beforeEach(() => {
  FakeSocket.opened = [];
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("pushed notification inbox", () => {
  it("refetches on each pushed change, and on each reconnect attempt while the stream is down", async () => {
    const notifications = vi.fn(async () => [] as RawNotification[]);
    render(<Probe client={{ notifications, fieldSyncToken: () => "access-token" }} />);
    await flush();
    expect(notifications).toHaveBeenCalledTimes(1);

    const first = FakeSocket.opened[0]!;
    expect(first.url.pathname).toBe("/api/v1/notifications/stream");
    expect(first.url.protocol).toBe("ws:");
    first.onopen!();
    expect(JSON.parse(first.sent[0]!)).toEqual({ type: "auth", token: "access-token" });

    await act(async () => first.onmessage!({ data: '{"type":"ready"}' }));
    expect(screen.getByTestId("inbox").textContent).toBe("0 live");
    expect(notifications).toHaveBeenCalledTimes(2);
    await act(async () => first.onmessage!({ data: '{"type":"changed"}' }));
    expect(notifications).toHaveBeenCalledTimes(3);

    // The stream drops: refetch at once, then retry with a growing delay.
    await act(async () => first.onclose!());
    expect(screen.getByTestId("inbox").textContent).toBe("0 down");
    expect(notifications).toHaveBeenCalledTimes(4);
    await act(async () => vi.advanceTimersByTime(1999));
    expect(FakeSocket.opened).toHaveLength(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(FakeSocket.opened).toHaveLength(2);
    await act(async () => FakeSocket.opened[1]!.onclose!());
    expect(notifications).toHaveBeenCalledTimes(5);
    await act(async () => vi.advanceTimersByTime(4000));
    expect(FakeSocket.opened).toHaveLength(3);
  });
});
