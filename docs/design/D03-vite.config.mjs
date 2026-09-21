import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import webConfig from "../../web/vite.config.ts";

const laneRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const webModules = resolve(laneRoot, "web/node_modules");

export default {
  ...webConfig,
  root: laneRoot,
  resolve: {
    ...webConfig.resolve,
    alias: {
      ...(webConfig.resolve?.alias ?? {}),
      react: resolve(webModules, "react"),
      "react-dom": resolve(webModules, "react-dom"),
    },
    dedupe: [...new Set([...(webConfig.resolve?.dedupe ?? []), "react", "react-dom"])],
  },
};
