// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SitrepRow } from "@openeoc/shared";
import type { ApiClient, SitrepListItem } from "../../app/api/client.js";
import { Theme } from "../../design/components.js";
import { JicPreparation } from "../JicPreparation.js";
import { SitrepWorkspace } from "../SitrepWorkspace.js";

const archived: SitrepRow = {
  id: "sitrep-a",
  period: "OP 4",
  composedAt: "2026-09-21T18:00:00Z",
  composedBy: "Planning lead",
  incidentId: "10000000-0000-4000-8000-000000000001",
  incidentName: "North Fork Flood",
  revision: 2,
  sourceTime: "2026-09-21T17:55:00Z",
  content: {
    period: "OP 4",
    composedAt: "2026-09-21T18:00:00Z",
    incident: { id: "10000000-0000-4000-8000-000000000001", name: "North Fork Flood" },
    revision: 2,
    sourceTime: "2026-09-21T17:55:00Z",
    lifelines: [{ lifeline: "energy", status: "unstable", note: "Substation offline", at: "2026-09-21T17:30:00Z" }],
    esfs: [],
    boards: [],
    significantEvents: [],
    talkingPoints: [{ topic: "Road access", point: "Use the signed detour.", recordedAt: "2026-09-21T17:40:00Z" }],
    rumorControl: [{ rumor: "Dam failed", status: "false", response: "The dam remains intact.", recordedAt: "2026-09-21T17:42:00Z" }],
  },
};

const listed: SitrepListItem = {
  id: archived.id,
  period: archived.period,
  composedAt: archived.composedAt,
  composedBy: archived.composedBy,
  incidentId: archived.incidentId!,
  incidentName: archived.incidentName!,
  revision: archived.revision!,
  sourceTime: archived.sourceTime!,
};

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    listSitreps: vi.fn().mockResolvedValue([listed]),
    composeSitrep: vi.fn().mockResolvedValue(archived),
    draftJicRelease: vi.fn().mockResolvedValue({ id: "20000000-0000-4000-8000-000000000002" }),
    submitJicRelease: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  } as unknown as ApiClient;
}

afterEach(cleanup);

describe("incident SITREP composition and JIC preparation", () => {
  it("loads only the selected incident and composes the selected period", async () => {
    const api = client();
    const open = vi.fn();
    render(
      <Theme name="light">
        <SitrepWorkspace
          client={api}
          jurisdictionId="jurisdiction-a"
          incidentId={archived.incidentId!}
          incidentName={archived.incidentName!}
          period="OP 4"
          onOpen={open}
        />
      </Theme>,
    );
    await screen.findByText("North Fork Flood");
    expect(api.listSitreps).toHaveBeenCalledWith("jurisdiction-a", archived.incidentId);
    fireEvent.click(screen.getByRole("button", { name: "Compose and freeze" }));
    await waitFor(() => expect(api.composeSitrep).toHaveBeenCalledWith("jurisdiction-a", {
      incidentId: archived.incidentId,
      period: "OP 4",
    }));
    expect((await screen.findByRole("status")).textContent).toContain("Revision 2 frozen");
    fireEvent.click(await screen.findByRole("button", { name: /OP 4/ }));
    expect(open).toHaveBeenCalledWith(archived.id);
  });

  it("does not carry an earlier incident archive across a scope change", async () => {
    const api = client();
    const view = render(
      <Theme name="light">
        <SitrepWorkspace
          client={api}
          jurisdictionId="jurisdiction-a"
          incidentId={archived.incidentId!}
          incidentName={archived.incidentName!}
          period="OP 4"
          onOpen={() => undefined}
        />
      </Theme>,
    );
    await screen.findByText("North Fork Flood");
    view.rerender(
      <Theme name="light">
        <SitrepWorkspace
          client={api}
          jurisdictionId="jurisdiction-a"
          incidentId={null}
          incidentName={null}
          period={null}
          onOpen={() => undefined}
        />
      </Theme>,
    );
    expect(screen.getByText("Select an incident to compose a situation report.")).toBeTruthy();
    expect(screen.queryByText("North Fork Flood")).toBeNull();
  });

  it("seeds a controlled draft from approved public material and submits it for review", async () => {
    const api = client();
    render(<Theme name="dark"><JicPreparation client={api} jurisdictionId="jurisdiction-a" sitrep={archived} /></Theme>);
    const body = screen.getByRole("textbox", { name: "Draft statement" }) as HTMLTextAreaElement;
    expect(body.value).toContain("Use the signed detour.");
    expect(body.value).toContain("The dam remains intact.");
    expect(body.value).not.toContain("Substation offline");
    fireEvent.change(screen.getByRole("textbox", { name: "Required reviewing agencies" }), {
      target: { value: "County PIO, Public Health" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save JIC draft" }));
    await waitFor(() => expect(api.draftJicRelease).toHaveBeenCalledWith("jurisdiction-a", {
      incidentId: archived.incidentId,
      title: "North Fork Flood public information update",
      body: "Use the signed detour.\n\nThe dam remains intact.",
      requiredAgencies: ["County PIO", "Public Health"],
    }));
    expect(await screen.findByText(/saved, not published/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Submit for review" }) as HTMLButtonElement;
    fireEvent.change(body, { target: { value: "Unsaved operator edit" } });
    expect(submit.disabled).toBe(true);
    fireEvent.click(submit);
    expect(api.submitJicRelease).not.toHaveBeenCalled();
    fireEvent.change(body, { target: { value: "Use the signed detour.\n\nThe dam remains intact." } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(api.submitJicRelease).toHaveBeenCalled());
    expect(await screen.findByText(/submitted for review/)).toBeTruthy();
  });

  it("keeps operator text after a rejected draft save", async () => {
    const api = client({ draftJicRelease: vi.fn().mockRejectedValue(new Error("requires JIC writer")) as ApiClient["draftJicRelease"] });
    render(<Theme name="light"><JicPreparation client={api} jurisdictionId="jurisdiction-a" sitrep={archived} /></Theme>);
    const body = screen.getByRole("textbox", { name: "Draft statement" }) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Operator-edited public statement" } });
    fireEvent.click(screen.getByRole("button", { name: "Save JIC draft" }));
    expect(await screen.findByText("requires JIC writer")).toBeTruthy();
    expect(body.value).toBe("Operator-edited public statement");
  });
});
