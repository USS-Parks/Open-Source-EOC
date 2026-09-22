// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { Icon, LifelineIcon } from "../../src/design/icons/Icon.js";
import { IconGallery } from "../IconGallery.js";
import {
  ICON_SIZES,
  actionIconNames,
  destinationIconByKey,
  iconRegistry,
  lifelineIconByKey,
  lifelineIconNames,
  navigationIconNames,
} from "../../src/design/icons/registry.js";

afterEach(cleanup);

async function violations(container: Element) {
  const result = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return result.violations;
}

describe("icon registry", () => {
  it("contains the complete project-owned lifeline family", () => {
    expect(Object.keys(lifelineIconByKey)).toEqual([
      "safety_security",
      "food_hydration_shelter",
      "health_medical",
      "energy",
      "communications",
      "transportation",
      "hazardous_materials",
      "water_systems",
    ]);
    expect(lifelineIconNames).toHaveLength(8);
    expect(new Set(Object.values(lifelineIconByKey))).toEqual(new Set(lifelineIconNames));
    for (const name of lifelineIconNames) {
      expect(iconRegistry[name]).toMatchObject({
        category: "lifeline",
        license: "Apache-2.0",
        provenance: "Open Source EOC original artwork",
      });
    }
  });

  it("keeps navigation metadata and supported sizes explicit", () => {
    expect(navigationIconNames.length).toBeGreaterThanOrEqual(27);
    expect(ICON_SIZES).toEqual([16, 20, 24, 32, 40, 48]);
    for (const name of navigationIconNames) {
      const definition = iconRegistry[name];
      expect(definition.label.trim()).not.toBe("");
      expect(definition.intendedSizes.length).toBeGreaterThan(0);
      expect(definition.primitives.length).toBeGreaterThan(0);
    }
  });

  it("maps every current and planned destination to a stable icon", () => {
    expect(Object.keys(destinationIconByKey)).toHaveLength(25);
    for (const name of Object.values(destinationIconByKey)) {
      expect(iconRegistry[name]).toBeDefined();
    }
    expect(new Set(Object.values(destinationIconByKey)).size).toBe(25);
    expect(destinationIconByKey.smartForms).toBe("smartForms");
    expect(destinationIconByKey.boardCustomization).toBe("boardCustomization");
  });

  it("gives every named registry icon unique geometry", () => {
    const signatures = Object.entries(iconRegistry).map(([name, definition]) => ({
      name,
      signature: JSON.stringify(definition.primitives),
    }));
    const duplicates = signatures.filter(
      ({ signature }, index) => signatures.findIndex((item) => item.signature === signature) !== index,
    );
    expect(duplicates).toEqual([]);
  });
});

describe("icon accessibility and state", () => {
  it("gives meaningful standalone icons an accessible name", () => {
    const { container } = render(<Icon label="Open incident map" name="map" size={24} />);
    const image = screen.getByRole("img", { name: "Open incident map" });
    expect(image.getAttribute("width")).toBe("24");
    expect(image.getAttribute("height")).toBe("24");
    expect(container.querySelector("title")?.textContent).toBe("Open incident map");
  });

  it("removes decorative icons from the accessibility tree", () => {
    const { container } = render(
      <button type="button">
        <Icon decorative name="add" /> Add report
      </button>,
    );
    const icon = container.querySelector("svg");
    expect(screen.getByRole("button", { name: "Add report" })).toBeTruthy();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(icon?.hasAttribute("role")).toBe(false);
    expect(icon?.querySelector("title")).toBeNull();
  });

  it("keeps selected and disabled independent from the icon identity", () => {
    const { container, rerender } = render(
      <Icon decorative name="boards" selected size={20} />,
    );
    const selected = container.querySelector("svg");
    expect(selected?.getAttribute("data-icon")).toBe("boards");
    expect(selected?.getAttribute("data-selected")).toBe("true");
    expect(selected?.getAttribute("stroke-width")).toBe("2.15");

    rerender(<Icon decorative disabled name="boards" size={20} />);
    const disabled = container.querySelector("svg");
    expect(disabled?.getAttribute("data-icon")).toBe("boards");
    expect(disabled?.getAttribute("data-disabled")).toBe("true");
    expect(disabled?.hasAttribute("data-selected")).toBe(false);
    expect(disabled?.style.opacity).toBe("0.38");
  });

  it("maps every lifeline key to its registered silhouette", () => {
    const { container } = render(
      <>
        {Object.keys(lifelineIconByKey).map((lifeline) => (
          <LifelineIcon
            decorative
            key={lifeline}
            lifeline={lifeline as keyof typeof lifelineIconByKey}
          />
        ))}
      </>,
    );
    expect(
      [...container.querySelectorAll("svg")].map((element) => element.dataset.icon),
    ).toEqual(Object.values(lifelineIconByKey));
  });

  it("rejects an empty accessible name at runtime", () => {
    expect(() => render(<Icon label=" " name="map" />)).toThrow(
      "Meaningful icons require a non-empty label",
    );
  });
});

describe("icon gallery", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme} theme has no automated accessibility violations`, async () => {
      const { container } = render(<IconGallery />);
      if (theme === "dark") {
        fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
      }
      expect(
        container.querySelector(".d05-icon-gallery")?.getAttribute("data-review-theme"),
      ).toBe(theme);
      const result = await violations(container);
      const summary = result.map((item) => `${item.id}: ${item.nodes.length}`).join("; ");
      expect(result, summary).toHaveLength(0);
    }, 30000);
  }

  it("renders all lifelines and keeps status outside the SVG", () => {
    const { container } = render(<IconGallery />);
    expect(container.querySelectorAll(".d05-lifeline-card")).toHaveLength(8);
    expect(container.querySelectorAll(".d05-lifeline-card svg .d05-status")).toHaveLength(0);
    expect(container.querySelectorAll(".d05-lifeline-card .d05-status")).toHaveLength(8);
    expect(
      [...container.querySelectorAll('[data-compact-kind="navigation"] svg')].every(
        (icon) => icon.getAttribute("width") === "16",
      ),
    ).toBe(true);
    expect(container.querySelectorAll('[data-compact-kind="action"] svg')).toHaveLength(
      actionIconNames.length,
    );
    expect(
      [...container.querySelectorAll('[data-compact-kind="action"] svg')].every(
        (icon) => icon.getAttribute("width") === "16",
      ),
    ).toBe(true);
    expect(container.querySelectorAll('[data-compact-kind="lifeline"] svg')).toHaveLength(8);
    expect(
      [...container.querySelectorAll('[data-compact-kind="lifeline"] svg')].every(
        (icon) => icon.getAttribute("width") === "20",
      ),
    ).toBe(true);
  });
});
