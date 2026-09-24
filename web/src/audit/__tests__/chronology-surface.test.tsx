// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient } from "../../app/api/client.js";
import { ChronologySurface } from "../ChronologySurface.js";

afterEach(cleanup);

it("makes the event table the panel the selected view tab names", async () => {
  const client = { listChronology: vi.fn(async () => ({ entries: [], nextCursor: null })) };
  render(<ChronologySurface client={client as unknown as ApiClient} jurisdictionId="j-1" incidentId={null} incidentName={null} isAdmin={false} />);
  await screen.findByText("No events match these filters");
  for (const name of ["Significant events", "All events"]) {
    const tab = screen.getByRole("tab", { name });
    fireEvent.click(tab);
    const panel = document.getElementById(tab.getAttribute("aria-controls")!);
    expect(panel?.getAttribute("role")).toBe("tabpanel");
    expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
  }
});
