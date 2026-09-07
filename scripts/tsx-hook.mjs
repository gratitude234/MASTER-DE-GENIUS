import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/**
 * Node's built-in type stripping handles ".ts" but cannot compile JSX, so
 * component tests run ".tsx" through the TypeScript compiler the project
 * already ships. No extra toolchain, and the same compiler the build uses.
 */
export function registerTsxHook() {
  registerHooks({
    load(url, context, next) {
      if (!url.startsWith("file:") || !url.endsWith(".tsx")) return next(url, context);

      const filename = fileURLToPath(url);
      const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          jsx: ts.JsxEmit.ReactJSX,
        },
      });

      return { format: "module", shortCircuit: true, source: outputText };
    },
  });
}
