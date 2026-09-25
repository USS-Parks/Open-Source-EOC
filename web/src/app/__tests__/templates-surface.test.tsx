// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { STANDARD_TEMPLATES } from "@openeoc/shared";
import { ApiError, type ApiClient, type BoardListItem } from "../api/client.js";
import { TemplatesSurface } from "../surfaces/TemplatesSurface.js";

afterEach(cleanup);

const template = STANDARD_TEMPLATES.find((item) => item.key === "shelters")!;
const board: BoardListItem = {
  id: "board-1",
  title: "County shelters",
  templateKey: template.key,
  templateVersion: template.version,
  hasGeometry: false,
};

function client(overrides: Partial<Record<keyof ApiClient, unknown>> = {}) {
  return {
    getBoard: vi.fn().mockResolvedValue({
      ...board,
      role: "admin",
      canContribute: true,
      fields: template.fields,
      views: template.views,
    }),
    getTemplateVersion: vi.fn().mockResolvedValue(template),
    listTemplateVersions: vi.fn().mockResolvedValue([
      { key: template.key, version: template.version, title: template.title },
    ]),
    listPositions: vi.fn().mockResolvedValue([
      { id: "position-1", key: "planning_chief", title: "Planning Section Chief" },
    ]),
    publishTemplate: vi.fn().mockResolvedValue({ key: template.key, version: 2 }),
    createBoard: vi.fn().mockResolvedValue({ id: "created-board" }),
    upgradeBoard: vi.fn().mockResolvedValue({ dropped: [] }),
    listTemplates: vi.fn().mockResolvedValue([
      { key: "activity_log", version: 1, title: "Activity Log" },
      { key: template.key, version: template.version, title: template.title },
    ]),
    ...overrides,
  } as unknown as ApiClient;
}

describe("board template lifecycle surface", () => {
  it("does not advertise global publication to a jurisdiction-only administrator", async () => {
    const api = client();
    render(<TemplatesSurface client={api} jurisdictionId="jurisdiction-1" boards={[board]}
      isInstanceAdmin={false} isJurisdictionAdmin={true} boardId={board.id}
      onOpenBoard={() => undefined} onDesignBoard={() => undefined} />);
    expect(screen.getByText("Board customization is unavailable for this account.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Publish/ })).toBeNull();
  });

  it("lets a jurisdiction-only administrator create a board from a published template", async () => {
    const api = client();
    render(<TemplatesSurface client={api} jurisdictionId="jurisdiction-1" boards={[board]}
      isInstanceAdmin={false} isJurisdictionAdmin={true}
      onOpenBoard={() => undefined} onDesignBoard={() => undefined} />);
    expect(await screen.findByRole("region", { name: "Create a board from a published template" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Create template" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Customize" })).toBeNull();
  });

  it("publishes an immutable version and applies it to the selected board", async () => {
    const api = client();
    const onOpenBoard = vi.fn();
    render(<TemplatesSurface client={api} jurisdictionId="jurisdiction-1" boards={[board]}
      isInstanceAdmin isJurisdictionAdmin boardId={board.id}
      onOpenBoard={onOpenBoard} onDesignBoard={() => undefined} />);

    await screen.findByRole("heading", { name: "Customize Shelters" });
    fireEvent.click(screen.getByRole("button", { name: "Publish and apply version 2" }));
    await waitFor(() => expect(api.publishTemplate).toHaveBeenCalledTimes(1));
    expect(api.upgradeBoard).toHaveBeenCalledWith(board.id, 2);
    expect(onOpenBoard).toHaveBeenCalledWith(board.id);
  });

  it("keeps the board on its current version and explains record migration failures", async () => {
    const upgradeBoard = vi.fn()
      .mockRejectedValueOnce(new ApiError(409,
        'template upgrade incompatible with records: [{"id":"record-7","issues":["capacity is required"]}]'))
      .mockResolvedValueOnce({ dropped: [] });
    const api = client({
      upgradeBoard,
    });
    const onOpenBoard = vi.fn();
    render(<TemplatesSurface client={api} jurisdictionId="jurisdiction-1" boards={[board]}
      isInstanceAdmin isJurisdictionAdmin boardId={board.id}
      onOpenBoard={onOpenBoard} onDesignBoard={() => undefined} />);

    await screen.findByRole("heading", { name: "Customize Shelters" });
    fireEvent.click(screen.getByRole("button", { name: "Publish and apply version 2" }));
    expect(await screen.findByText("Version 2 published; board unchanged")).toBeTruthy();
    expect(screen.getByText(/Record record-7: capacity is required/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry applying version 2" }));
    await waitFor(() => expect(upgradeBoard).toHaveBeenCalledTimes(2));
    expect(onOpenBoard).toHaveBeenCalledWith(board.id);
  });

  it("routes template index actions without replacing the records workspace", async () => {
    const api = client();
    const onDesignBoard = vi.fn();
    render(<TemplatesSurface client={api} jurisdictionId="jurisdiction-1" boards={[board]}
      isInstanceAdmin isJurisdictionAdmin onOpenBoard={() => undefined}
      onDesignBoard={onDesignBoard} />);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    expect(onDesignBoard).toHaveBeenCalledWith(board.id);
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    expect(await screen.findByRole("heading", { name: "Create board template" })).toBeTruthy();
  });

  it("creates a board from a template already published and has the board lists read again", async () => {
    const api = client();
    const onOpenBoard = vi.fn();
    const onBoardsChanged = vi.fn();
    render(<TemplatesSurface client={api} jurisdictionId="jurisdiction-1" boards={[board]}
      isInstanceAdmin isJurisdictionAdmin onOpenBoard={onOpenBoard} onBoardsChanged={onBoardsChanged}
      onDesignBoard={() => undefined} />);
    const section = await screen.findByRole("region", { name: "Create a board from a published template" });
    fireEvent.change(await within(section).findByLabelText("Published template"), { target: { value: template.key } });
    fireEvent.change(within(section).getByLabelText("Board title"), { target: { value: "South county shelters" } });
    fireEvent.click(within(section).getByRole("button", { name: "Create board" }));
    await waitFor(() => expect(onOpenBoard).toHaveBeenCalledWith("created-board"));
    expect(api.createBoard).toHaveBeenCalledWith("jurisdiction-1",
      { templateKey: template.key, version: template.version, title: "South county shelters" });
    expect(onBoardsChanged).toHaveBeenCalledTimes(1);
  });

  it("has the board lists read again after publishing a new template creates its board", async () => {
    const api = client({ publishTemplate: vi.fn().mockResolvedValue({ key: "roads", version: 1 }) });
    const onBoardsChanged = vi.fn();
    const onOpenBoard = vi.fn();
    render(<TemplatesSurface client={api} jurisdictionId="jurisdiction-1" boards={[]}
      isInstanceAdmin isJurisdictionAdmin onOpenBoard={onOpenBoard} onBoardsChanged={onBoardsChanged}
      onDesignBoard={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "Create template" }));
    await screen.findByRole("heading", { name: "Create board template" });
    fireEvent.change(screen.getByLabelText("Board key"), { target: { value: "roads" } });
    fireEvent.change(screen.getByLabelText("Board title"), { target: { value: "Roads" } });
    fireEvent.change(screen.getByLabelText("Field key"), { target: { value: "road" } });
    fireEvent.change(screen.getByLabelText("Field label"), { target: { value: "Road" } });
    fireEvent.click(screen.getByRole("button", { name: "Add field" }));
    fireEvent.click(screen.getByRole("tab", { name: "Views" }));
    fireEvent.change(screen.getByLabelText("View key"), { target: { value: "all" } });
    fireEvent.change(screen.getByLabelText("View title"), { target: { value: "All roads" } });
    fireEvent.click(within(screen.getByRole("group", { name: "View columns" })).getByRole("checkbox", { name: "road" }));
    fireEvent.click(screen.getByRole("button", { name: "Add view" }));
    fireEvent.click(screen.getByRole("button", { name: "Publish and create board" }));
    await waitFor(() => expect(onOpenBoard).toHaveBeenCalledWith("created-board"));
    expect(onBoardsChanged).toHaveBeenCalledTimes(1);
  });

  it("does not apply a completed publication to a board selected afterward", async () => {
    let resolvePublish!: (value: { key: string; version: number }) => void;
    const api = client({
      publishTemplate: vi.fn().mockReturnValue(new Promise((resolve) => { resolvePublish = resolve; })),
    });
    const common = { client: api, jurisdictionId: "jurisdiction-1", boards: [board],
      isInstanceAdmin: true, isJurisdictionAdmin: true,
      onOpenBoard: vi.fn(), onDesignBoard: vi.fn() };
    const { rerender } = render(<TemplatesSurface {...common} boardId="board-1" />);
    await screen.findByRole("heading", { name: "Customize Shelters" });
    fireEvent.click(screen.getByRole("button", { name: "Publish and apply version 2" }));
    rerender(<TemplatesSurface {...common} boardId="board-2" />);
    resolvePublish({ key: template.key, version: 2 });
    await waitFor(() => expect(api.publishTemplate).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(api.upgradeBoard).not.toHaveBeenCalled();
  });
});
