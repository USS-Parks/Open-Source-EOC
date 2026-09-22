import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(repoRoot, "package.json"));
const ts = require("typescript");

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".") && specifier.endsWith(".js") && context.parentURL) {
        const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate.href, context);
      }
      throw error;
    }
  },
  load(url, context, nextLoad) {
    const applicationSource = !url.includes("/node_modules/")
      || url.includes("/node_modules/@openeoc/shared/");
    if (url.startsWith("file:") && url.endsWith(".ts") && applicationSource) {
      const filename = fileURLToPath(url);
      const source = readFileSync(filename, "utf8");
      const output = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
        fileName: relative(repoRoot, filename),
      }).outputText;
      return { format: "module", shortCircuit: true, source: output };
    }
    return nextLoad(url, context);
  },
});
