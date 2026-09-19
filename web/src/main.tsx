import { createRoot } from "react-dom/client";
import "maplibre-gl/dist/maplibre-gl.css";
import "./design/base.css";
import { App } from "./app/App.js";

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
