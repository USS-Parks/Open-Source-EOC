// @vitest-environment jsdom
import { useRef, useState } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../components.js";
import { Drawer, ModalDialog } from "../overlays.js";

afterEach(cleanup);

function DrawerHarness(props: { readonly unsaved: boolean; readonly onDiscard?: () => void | Promise<void> }) {
  const [open, setOpen] = useState(false);
  const initialRef = useRef<HTMLInputElement>(null);
  return (
    <Theme name="light">
      <button type="button" onClick={() => setOpen(true)}>Open drawer</button>
      <Drawer
        open={open}
        title="Edit request"
        unsaved={props.unsaved}
        initialFocusRef={initialRef}
        onClose={() => setOpen(false)}
        {...(props.onDiscard ? { onDiscard: props.onDiscard } : {})}
      >
        <label>Summary<input ref={initialRef} /></label>
        <button type="button">Last action</button>
      </Drawer>
    </Theme>
  );
}

describe("drawer focus and unsaved handling", () => {
  it("focuses the requested control, traps Tab, closes with Escape, and restores focus", async () => {
    const view = render(<DrawerHarness unsaved={false} />);
    const opener = view.getByRole("button", { name: "Open drawer" });
    opener.focus();
    fireEvent.click(opener);
    const summary = view.getByLabelText("Summary");
    expect(document.activeElement).toBe(summary);
    const last = view.getByRole("button", { name: "Last action" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(view.getByRole("button", { name: "Close Edit request" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Edit request" })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("requires explicit discard, traps confirmation focus, and keeps editing on Escape", async () => {
    const discard = vi.fn(async () => undefined);
    const view = render(<DrawerHarness unsaved onDiscard={discard} />);
    const opener = view.getByRole("button", { name: "Open drawer" });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(view.getByLabelText("Summary"), { key: "Escape" });
    expect(view.getByRole("alertdialog", { name: "Discard unsaved changes?" })).not.toBeNull();
    const keep = view.getByRole("button", { name: "Keep editing" });
    expect(document.activeElement).toBe(keep);
    fireEvent.keyDown(keep, { key: "Shift", shiftKey: true });
    fireEvent.keyDown(keep, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(view.getByRole("button", { name: "Discard changes" }));
    fireEvent.click(keep);
    await waitFor(() => expect(document.activeElement).toBe(view.getByLabelText("Summary")));
    expect(view.queryByRole("alertdialog")).toBeNull();
    const dialog = view.getByRole("dialog", { name: "Edit request" });
    dialog.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(view.getByRole("button", { name: "Last action" }));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    fireEvent.keyDown(view.getByRole("button", { name: "Keep editing" }), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(view.getByRole("button", { name: "Last action" })));
    fireEvent.click(view.getByRole("button", { name: "Close Edit request" }));
    fireEvent.click(view.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(discard).toHaveBeenCalledOnce());
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Edit request" })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("keeps the guard open and reports a failed discard", async () => {
    const view = render(<DrawerHarness unsaved onDiscard={async () => { throw new Error("Draft storage failed"); }} />);
    fireEvent.click(view.getByRole("button", { name: "Open drawer" }));
    fireEvent.click(view.getByRole("button", { name: "Close Edit request" }));
    fireEvent.click(view.getByRole("button", { name: "Discard changes" }));
    expect((await view.findByRole("alert")).textContent).toContain("Draft storage failed");
    expect(view.getByRole("dialog", { name: "Edit request" })).not.toBeNull();
  });
});

describe("modal dialog", () => {
  it("uses the same focus and backdrop-close contract", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <Theme name="dark"><button type="button" onClick={() => setOpen(true)}>Open modal</button><ModalDialog open={open} title="Confirm action" onClose={() => setOpen(false)}><button type="button">Confirm</button></ModalDialog></Theme>;
    }
    const view = render(<Harness />);
    fireEvent.click(view.getByRole("button", { name: "Open modal" }));
    const dialog = view.getByRole("dialog", { name: "Confirm action" });
    expect(dialog).not.toBeNull();
    fireEvent.mouseDown(dialog.parentElement!);
    await waitFor(() => expect(view.queryByRole("dialog", { name: "Confirm action" })).toBeNull());
  });
});
