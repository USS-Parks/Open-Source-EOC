// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BoardsIndex } from "../surfaces/lists.js";

afterEach(cleanup);

it("marks a board on the map with a label, not a lowercase key", () => {
  render(<BoardsIndex boards={[{ id: "b1", title: "Road Closures", templateKey: "road_closures", templateVersion: 1, hasGeometry: true }]} onOpen={() => undefined} />);
  expect(screen.getByText("Layer", { exact: true })).toBeTruthy();
});
