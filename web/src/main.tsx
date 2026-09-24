import { createRoot } from "react-dom/client";
import "./design/base.css";
import { App } from "./app/App.js";
import { registerFieldWorker } from "./offline/register.js";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
// A built bundle carries the service worker and its precache list; the dev server does not.
if (!import.meta.hot) window.addEventListener("load", () => void registerFieldWorker());
