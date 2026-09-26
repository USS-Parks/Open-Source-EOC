// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Theme } from "../../design/components.js";
import { createVault, unlockVault, type UnlockResult } from "../device-lock.js";
import { DevicePinCard, DevicePinOffer, DevicePinSettings, DeviceUnlock, type DevicePinNoticeProps } from "../DevicePin.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); });

const dana = { personId: "11111111-1111-4111-8111-111111111111", label: "Dana Reyes", proven: false };
/** A loaded machine can take longer than the 1 s default to read the device store. */
const WAIT = { timeout: 5_000 };
const clean = async (container: HTMLElement) => expect((await axe.run(container)).violations).toEqual([]);

function unlockScreen(overrides: Partial<Parameters<typeof DeviceUnlock>[0]> = {}) {
  const props = {
    lockedFor: dana,
    error: null,
    onUnlock: vi.fn(async (): Promise<UnlockResult> => ({ ok: false, reason: "wrong", waitMs: 0, attemptsLeft: 9 })),
    onUsePassword: vi.fn(),
    onErase: vi.fn(async () => undefined),
    ...overrides,
  };
  const view = render(<Theme name="light"><DeviceUnlock {...props} /></Theme>);
  return { ...props, view };
}

describe("the device PIN screen", () => {
  it("names whose work it keeps, refuses a wrong PIN with the tries left, and passes axe", async () => {
    const { view, onUnlock, onUsePassword } = unlockScreen();
    expect(screen.getByText("Dana Reyes")).not.toBeNull();
    const unlock = screen.getByRole("button", { name: "Unlock" }) as HTMLButtonElement;
    expect(unlock.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Device PIN"), { target: { value: "000000" } });
    fireEvent.click(unlock);
    await screen.findByText("That PIN is not right. 9 tries left before this device erases the work it keeps for Dana Reyes, including work not yet sent.", undefined, WAIT);
    expect(onUnlock).toHaveBeenCalledWith("000000");
    expect((screen.getByLabelText("Device PIN") as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: /Erase/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in with a password instead" }));
    expect(onUsePassword).toHaveBeenCalledOnce();
    await clean(view.container);
  });

  it("holds the Unlock button through a wait, including one from before a reload", async () => {
    await createVault(dana.personId, dana.label, "480913");
    const now = Date.now();
    for (const pin of ["000000", "000001", "000002"]) await unlockVault(dana.personId, pin, indexedDB, now);
    const { view } = unlockScreen();
    await screen.findByText(/^Too many wrong PINs: try again in (29|30) seconds\. 7 tries left/, undefined, WAIT);
    fireEvent.change(screen.getByLabelText("Device PIN"), { target: { value: "480913" } });
    expect((screen.getByRole("button", { name: "Unlock" }) as HTMLButtonElement).disabled).toBe(true);
    await clean(view.container);
  });

  it("offers erasing only after a password sign-in, and asks first", async () => {
    const { view, onErase } = unlockScreen({ lockedFor: { ...dana, proven: true } });
    fireEvent.click(screen.getByRole("button", { name: "Forgot the PIN? Erase this device's copy" }));
    const confirm = screen.getByRole("group", { name: "Erase this device's copy" });
    expect(confirm.textContent).toContain("including work not yet sent");
    await clean(view.container);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(onErase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Forgot the PIN? Erase this device's copy" }));
    fireEvent.click(screen.getByRole("button", { name: "Erase and continue" }));
    expect(onErase).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Sign in as someone else" })).not.toBeNull();
  });
});

describe("the unprotected notice and setting a device PIN", () => {
  const notice = (overrides: Partial<DevicePinNoticeProps> = {}): DevicePinNoticeProps => ({
    devicePin: false, offer: true, onSet: vi.fn(async () => undefined), onLock: vi.fn(), onDismiss: vi.fn(), ...overrides,
  });

  it("says the dock's copy is unprotected, checks the PIN, sets it, and passes axe", async () => {
    const props = notice();
    const view = render(<Theme name="light"><DevicePinCard {...props} /></Theme>);
    expect(screen.getByRole("heading", { name: "Kept unprotected" })).not.toBeNull();
    expect(screen.getByText(/Anyone who uses this device can read the drafts and queued work/)).not.toBeNull();
    await clean(view.container);
    fireEvent.click(screen.getByRole("button", { name: "Set device PIN" }));
    const pin = screen.getByLabelText("New device PIN");
    expect(pin.getAttribute("autocomplete")).toBe("off");
    fireEvent.change(pin, { target: { value: "4809" } });
    fireEvent.change(screen.getByLabelText("Repeat the PIN"), { target: { value: "4809" } });
    fireEvent.click(screen.getByRole("button", { name: "Set device PIN" }));
    await screen.findByText("A device PIN has at least 6 digits or characters.", undefined, WAIT);
    fireEvent.change(pin, { target: { value: "480913" } });
    fireEvent.click(screen.getByRole("button", { name: "Set device PIN" }));
    await screen.findByText("The two PINs do not match.", undefined, WAIT);
    fireEvent.change(screen.getByLabelText("Repeat the PIN"), { target: { value: "480913" } });
    fireEvent.click(screen.getByRole("button", { name: "Set device PIN" }));
    await waitFor(() => expect(props.onSet).toHaveBeenCalledWith("480913"), WAIT);
    expect(props.onSet).toHaveBeenCalledOnce();
    await clean(view.container);
  });

  it("offers the PIN above the console at sign-in, never requires it, and goes on Not now", async () => {
    const props = notice();
    const view = render(<Theme name="light"><DevicePinOffer {...props} /></Theme>);
    const offer = screen.getByRole("region", { name: "Device PIN" });
    expect(offer.textContent).toContain("This device keeps your work unprotected.");
    await clean(view.container);
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
    view.rerender(<Theme name="light"><DevicePinOffer {...props} offer={false} /></Theme>);
    expect(screen.queryByRole("region", { name: "Device PIN" })).toBeNull();
    view.rerender(<Theme name="light"><DevicePinCard {...props} offer={false} /></Theme>);
    expect(screen.queryByRole("region", { name: "This device" })).toBeNull();
  });

  it("keeps the PIN one click away in settings, with Not now only while the offer stands", async () => {
    const props = notice();
    const view = render(<Theme name="light"><DevicePinSettings {...props} /></Theme>);
    const section = screen.getByRole("group", { name: "Device PIN" });
    expect(section.textContent).toContain("Not set.");
    expect(screen.getByRole("button", { name: "Not now" })).not.toBeNull();
    await clean(view.container);
    view.rerender(<Theme name="light"><DevicePinSettings {...props} offer={false} /></Theme>);
    expect(screen.queryByRole("button", { name: "Not now" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set device PIN" }));
    expect(screen.getByLabelText("New device PIN")).not.toBeNull();
  });

  it("says the work is sealed and locks on request", async () => {
    const props = notice({ devicePin: true, offer: false });
    const view = render(<Theme name="dark"><DevicePinCard {...props} /></Theme>);
    expect(screen.getByRole("heading", { name: "Kept under your device PIN" })).not.toBeNull();
    expect(screen.getByText(/after 15 minutes without use/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Lock now" }));
    expect(props.onLock).toHaveBeenCalledOnce();
    await clean(view.container);
    view.rerender(<Theme name="dark"><DevicePinOffer {...props} /></Theme>);
    expect(screen.queryByRole("region", { name: "Device PIN" })).toBeNull();
  });
});
