// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AssessmentRelationships } from "../surfaces/AssessmentRelationships.js";

afterEach(cleanup);

describe("relationship picker", () => {
  it("offers board records and tasks from every page, not only the first", async () => {
    const task = (id: string, item: string) => ({ id, item, status: "open" });
    const client = {
      listOperationalRelationships: vi.fn(async () => []),
      listIncidentTasks: vi.fn(async (_incident: string, _filters: unknown, page?: { cursor?: string }) => page?.cursor
        ? { tasks: [task("t2", "Later task")], nextCursor: null }
        : { tasks: [task("t1", "First task")], nextCursor: "t-next" }),
      getBoard: vi.fn(async () => ({ views: [{ key: "all" }] })),
      boardView: vi.fn(async (_board: string, _view: string, _incident: string, page?: { cursor?: string }) => page?.cursor
        ? { records: [{ id: "r2", name: "Older shelter" }], nextCursor: null }
        : { records: [{ id: "r1", name: "Newer shelter" }], nextCursor: "r-next" }),
    };
    render(<AssessmentRelationships client={client as never} incidentId="i1" boards={[{ id: "b1", title: "Shelters" }]}
      source={{ domain: "lifeline", framework: "fema", definitionKey: "safety_security" }} />);

    await waitFor(() => expect(screen.getByRole("option", { name: "Later task · open" })).toBeTruthy());
    expect(screen.getByRole("option", { name: "First task · open" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Link type"), { target: { value: "board_record" } });
    await waitFor(() => expect(screen.getByRole("option", { name: "Shelters: Older shelter" })).toBeTruthy());
    expect(screen.getByRole("option", { name: "Shelters: Newer shelter" })).toBeTruthy();
    expect(client.boardView).toHaveBeenLastCalledWith("b1", "all", "i1", { cursor: "r-next", limit: 500 });
  });
});
