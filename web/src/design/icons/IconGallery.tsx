import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "../components.js";
import type { ThemeName } from "../tokens.js";
import { Icon, LifelineIcon } from "./Icon.js";
import {
  iconRegistry,
  lifelineIconByKey,
  navigationIconNames,
  type LifelineKey,
} from "./registry.js";
import "./styles.css";

const lifelineLabels: Readonly<Record<LifelineKey, string>> = {
  safety_security: "Safety and Security",
  food_hydration_shelter: "Food, Hydration, Shelter",
  health_medical: "Health and Medical",
  energy: "Energy",
  communications: "Communications",
  transportation: "Transportation",
  hazardous_materials: "Hazardous Materials",
  water_systems: "Water Systems",
};

const statusSamples = [
  { label: "Stable", className: "stable" },
  { label: "Watch", className: "watch" },
  { label: "Critical", className: "critical" },
  { label: "Unknown", className: "unknown" },
] as const;

export function IconGallery() {
  const [theme, setTheme] = useState<ThemeName>("light");
  return (
    <Theme name={theme}>
      <main className="d05-icon-gallery" data-review-theme={theme}>
        <header className="d05-gallery-header">
          <div>
            <p className="d05-eyebrow">Open Source EOC design system · D05</p>
            <h1>Operational icon family</h1>
            <p>
              Compact, project-owned SVG symbols. Every mark uses currentColor, so theme and
              context control color without changing meaning.
            </p>
          </div>
          <button
            className="d05-theme-button"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            type="button"
          >
            <Icon decorative name="theme" size={20} />
            Use {theme === "light" ? "dark" : "light"} theme
          </button>
        </header>

        <section aria-labelledby="d05-navigation-heading" className="d05-gallery-panel">
          <h2 id="d05-navigation-heading">Navigation</h2>
          <p>Meaningful standalone examples expose the registry label as their accessible name.</p>
          <div className="d05-icon-grid">
            {navigationIconNames.map((name) => (
              <div className="d05-icon-tile" key={name}>
                <Icon label={iconRegistry[name].label} name={name} size={24} />
                <span>{iconRegistry[name].label}</span>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="d05-lifeline-heading" className="d05-gallery-panel">
          <h2 id="d05-lifeline-heading">Community lifelines</h2>
          <p>
            The eight silhouettes follow the canonical card shapes while status stays in a
            separate, text-labelled indicator.
          </p>
          <div className="d05-lifeline-grid">
            {(Object.keys(lifelineIconByKey) as LifelineKey[]).map((lifeline, index) => {
              const status = statusSamples[index % statusSamples.length]!;
              return (
                <article
                  className="d05-lifeline-card"
                  data-lifeline={lifeline}
                  key={lifeline}
                >
                  <LifelineIcon
                    decorative
                    lifeline={lifeline}
                    selected={lifeline === "energy"}
                    size={40}
                  />
                  <div>
                    <h3>{lifelineLabels[lifeline]}</h3>
                    <span className={`d05-status d05-status-${status.className}`}>
                      <span aria-hidden="true" className="d05-status-dot" />
                      {status.label}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="d05-compact-heading" className="d05-gallery-panel">
          <h2 id="d05-compact-heading">Smallest intended sizes</h2>
          <p>Every silhouette remains present at the compact rail and dense-list sizes.</p>
          <div aria-label="Navigation icons at 16 pixels" className="d05-compact-strip">
            {navigationIconNames.map((name) => (
              <span data-compact-kind="navigation" key={name} title={iconRegistry[name].label}>
                <Icon decorative name={name} size={16} />
              </span>
            ))}
          </div>
          <div aria-label="Lifeline icons at 20 pixels" className="d05-compact-strip">
            {(Object.keys(lifelineIconByKey) as LifelineKey[]).map((lifeline) => (
              <span data-compact-kind="lifeline" key={lifeline} title={lifelineLabels[lifeline]}>
                <LifelineIcon decorative lifeline={lifeline} size={20} />
              </span>
            ))}
          </div>
        </section>

        <section aria-labelledby="d05-states-heading" className="d05-gallery-panel">
          <h2 id="d05-states-heading">Interaction states</h2>
          <p>
            Selected and disabled change interaction presentation. Operational status remains a
            separate labelled value and never changes the icon definition.
          </p>
          <div className="d05-state-row">
            <button className="d05-state-button" type="button">
              <Icon decorative name="boards" size={24} /> Default
            </button>
            <button aria-pressed="true" className="d05-state-button selected" type="button">
              <Icon decorative name="boards" selected size={24} /> Selected
            </button>
            <button className="d05-state-button" disabled type="button">
              <Icon decorative disabled name="boards" size={24} /> Disabled
            </button>
          </div>
        </section>

        <section aria-labelledby="d05-access-heading" className="d05-gallery-panel">
          <h2 id="d05-access-heading">Accessible use</h2>
          <div className="d05-access-examples">
            <div>
              <strong>Meaningful standalone icon</strong>
              <Icon label="Compare revisions" name="compare" size={24} />
            </div>
            <button className="d05-state-button" type="button">
              <Icon decorative name="add" size={20} /> Add report
            </button>
          </div>
        </section>
      </main>
    </Theme>
  );
}

export function mountIconGallery(element: Element) {
  createRoot(element).render(<IconGallery />);
}
