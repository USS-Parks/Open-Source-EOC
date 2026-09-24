// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlaceResult, PlaceSearch as PlaceSearchResponse } from "../../api/client.js";
import { PlaceSearch } from "../PlaceSearch.js";

afterEach(cleanup);

const address: PlaceResult = { kind: "address", label: "816 3rd Street", detail: "Eureka", lon: -124.16261, lat: 40.80401, zoom: 18 };
const street: PlaceResult = { kind: "street", label: "3rd Street", detail: "Eureka", lon: -124.15693, lat: 40.80493, zoom: 16 };

function mount(answer: () => Promise<PlaceSearchResponse>) {
  const searchPlaces = vi.fn(answer);
  const onChoose = vi.fn();
  const view = render(<PlaceSearch client={{ searchPlaces }} onChoose={onChoose} />);
  const input = view.getByRole("combobox", { name: "Search addresses and places" });
  return { view, input, searchPlaces, onChoose };
}

describe("command bar place search", () => {
  it("searches after two characters, near the jurisdiction's map extent", async () => {
    const { view, input, searchPlaces } = mount(() => Promise.resolve({ available: true, results: [address, street] }));
    fireEvent.change(input, { target: { value: "8" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searchPlaces).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "816 3rd st " } });
    await waitFor(() => expect(view.getAllByRole("option")).toHaveLength(2));
    expect(searchPlaces).toHaveBeenCalledTimes(1);
    expect(searchPlaces).toHaveBeenCalledWith("816 3rd st", [expect.closeTo(-119.3), expect.closeTo(37.255)]);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(view.getByRole("option", { name: /816 3rd Street/ }).textContent).toContain("Address · Eureka");
  });

  it("moves through results with the arrow keys and chooses with Enter", async () => {
    const { view, input, onChoose } = mount(() => Promise.resolve({ available: true, results: [address, street] }));
    fireEvent.change(input, { target: { value: "3rd street" } });
    await waitFor(() => expect(view.getAllByRole("option")).toHaveLength(2));
    const [first, second] = view.getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(first!.id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(second!.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(second!.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChoose).toHaveBeenCalledWith(street);
    expect((input as HTMLInputElement).value).toBe("3rd Street");
    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("chooses a result with a click", async () => {
    const { view, input, onChoose } = mount(() => Promise.resolve({ available: true, results: [address] }));
    fireEvent.change(input, { target: { value: "816" } });
    fireEvent.click(await view.findByRole("option", { name: /816 3rd Street/ }));
    expect(onChoose).toHaveBeenCalledWith(address);
  });

  it("closes on Escape, then clears the box on a second Escape", async () => {
    const { view, input } = mount(() => Promise.resolve({ available: true, results: [address] }));
    fireEvent.change(input, { target: { value: "816" } });
    await view.findByRole("option");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input.getAttribute("aria-expanded")).toBe("false");
    expect((input as HTMLInputElement).value).toBe("816");
    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
  });

  it.each([
    ["no match", () => Promise.resolve({ available: true, results: [] }), "No matching address or place."],
    ["no gazetteer", () => Promise.resolve({ available: false, results: [] }), "Offline address search is unavailable on this server."],
    ["a failed request", () => Promise.reject(new Error("offline")), "Search failed. Try again."],
  ])("says so plainly on %s", async (_case, answer, message) => {
    const { view, input } = mount(answer as () => Promise<PlaceSearchResponse>);
    fireEvent.change(input, { target: { value: "nowhere" } });
    await waitFor(() => expect(view.getByRole("status").textContent).toBe(message));
    expect(view.queryAllByRole("option")).toHaveLength(0);
  });

  it("has no automated accessibility violations with results open", async () => {
    const { view, input } = mount(() => Promise.resolve({ available: true, results: [address, street] }));
    fireEvent.change(input, { target: { value: "3rd" } });
    await waitFor(() => expect(view.getAllByRole("option")).toHaveLength(2));
    const result = await axe.run(view.container, { rules: { "color-contrast": { enabled: false } } });
    const summary = result.violations.map((item) => `${item.id}: ${item.nodes.length}`).join("; ");
    expect(result.violations, summary).toHaveLength(0);
  }, 30000);
});
