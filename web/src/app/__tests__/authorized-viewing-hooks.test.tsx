// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../api/client.js";
import { useAsync } from "../data/hooks.js";

afterEach(cleanup);

function Probe(props: { load: () => Promise<string>; context?: string }) {
  const state = useAsync(props.load, [props.context ?? "same"]);
  return (
    <div>
      {state.data ? <span data-testid="data">{state.data}</span> : null}
      {state.error ? <span role="alert">{state.error}</span> : null}
      <button type="button" onClick={state.reload}>Reload</button>
    </div>
  );
}

describe("authorized viewing data freshness", () => {
  it("clears protected last-good data when a refresh is denied", async () => {
    let calls = 0;
    render(
      <Probe
        load={() => {
          calls += 1;
          return calls === 1
            ? Promise.resolve("protected incident data")
            : Promise.reject(new ApiError(404, "incident not found"));
        }}
      />,
    );
    await screen.findByText("protected incident data");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await screen.findByRole("alert");
    await waitFor(() => expect(screen.queryByTestId("data")).toBeNull());
  });

  it("retains last-good data for a transport failure", async () => {
    let calls = 0;
    render(
      <Probe
        load={() => {
          calls += 1;
          return calls === 1
            ? Promise.resolve("offline last-good data")
            : Promise.reject(new Error("network unavailable"));
        }}
      />,
    );
    await screen.findByText("offline last-good data");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await screen.findByRole("alert");
    expect(screen.getByTestId("data").textContent).toBe("offline last-good data");
  });

  it("does not expose a previous context while the next context fails", async () => {
    const { rerender } = render(
      <Probe context="incident-a" load={() => Promise.resolve("incident A protected data")} />,
    );
    await screen.findByText("incident A protected data");
    rerender(
      <Probe context="incident-b" load={() => Promise.reject(new Error("network unavailable"))} />,
    );
    await screen.findByRole("alert");
    expect(screen.queryByTestId("data")).toBeNull();
  });
});
