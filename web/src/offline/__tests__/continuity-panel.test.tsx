// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../../design/components.js";
import { ContinuityStateCard } from "../ContinuityPanel.js";
import type { ContinuitySnapshot } from "../continuity.js";

afterEach(cleanup);

const scope = { personId: "person-a", incidentId: "incident-a" };
const queued: ContinuitySnapshot = {
  scope,
  phase: "queued",
  pendingBoardIds: ["board-a"],
  pendingTaskOperationIds: ["task-op-a"],
  conflicts: 0,
  lastError: null,
};

function renderCard(overrides: Partial<ComponentProps<typeof ContinuityStateCard>> = {}) {
  const defaults: ComponentProps<typeof ContinuityStateCard> = {
    snapshot: queued,
    conflict: null,
    online: true,
    storageError: null,
    busy: null,
    onReconnect: vi.fn(),
    onRecoverSession: vi.fn(),
    onOpenBoards: vi.fn(),
  };
  return render(<Theme name="light"><ContinuityStateCard {...defaults} {...overrides} /></Theme>);
}

describe("continuity presentation", () => {
  it("distinguishes locally queued board and task work from a server receipt", () => {
    const reconnect = vi.fn();
    renderCard({ onReconnect: reconnect });
    expect(screen.getAllByText("Queued locally")).toHaveLength(2);
    expect(screen.getByText("1 board draft and 1 task completion saved locally.")).not.toBeNull();
    expect(screen.getByText("Pending confirmation.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect and reconcile" }));
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it("retains a receipt conflict after the queue is empty and sends the operator to the existing board workflow", () => {
    const openBoards = vi.fn();
    renderCard({ snapshot: { ...queued, phase: "synced", pendingBoardIds: [], pendingTaskOperationIds: [] }, conflict: {
      conflicts: 1,
      receipt: { seq: 7, conflicts: 1, operationId: "operation-a", exact: true },
    }, onOpenBoards: openBoards });
    expect(screen.getAllByText("Resolution required")).toHaveLength(2);
    expect(screen.getByText("A receipt reported a conflict.")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open boards to resolve" }));
    expect(openBoards).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Reconnect and reconcile" })).toBeNull();
  });

  it("keeps exact retained conflict receipts visible after reload", () => {
    renderCard({ snapshot: { ...queued, phase: "synced", pendingBoardIds: [], pendingTaskOperationIds: [] }, conflict: {
      entries: [{
        boardId: "board-a", operationId: "operation-a", conflicts: 2,
        receipt: { seq: 8, conflicts: 2, operationId: "operation-a", exact: true },
      }],
    } });
    expect(screen.getByText("2 submissions require review.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open boards to resolve" })).not.toBeNull();
  });

  it("offers session recovery without discarding queued work", () => {
    const recover = vi.fn();
    renderCard({ snapshot: { ...queued, phase: "auth_required", lastError: "incident access expired" }, onRecoverSession: recover });
    expect(screen.getAllByText("Session recovery required")).toHaveLength(2);
    expect(screen.getByText("1 board draft and 1 task completion saved locally.")).not.toBeNull();
    expect(screen.getByText("incident access expired")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore session" }));
    expect(recover).toHaveBeenCalledOnce();
  });

  it("labels an offline local state without claiming a successful server receipt", () => {
    renderCard({ online: false, snapshot: { ...queued, phase: "offline", pendingTaskOperationIds: [] } });
    expect(screen.getByText("Offline")).not.toBeNull();
    expect(screen.getByText("Network unavailable. Local drafts and queued work remain on this device.")).not.toBeNull();
    expect(screen.getByText("Pending confirmation.")).not.toBeNull();
    expect((screen.getByRole("button", { name: "Reconnect and reconcile" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
