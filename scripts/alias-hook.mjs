import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

// A bare specifier may name a directory (".../providers/aloc"), so only real
// files count; directories fall through to their index module.
function firstExisting(base) {
  if (isFile(base)) return base;
  for (const extension of EXTENSIONS) {
    if (isFile(base + extension)) return base + extension;
  }
  for (const extension of EXTENSIONS) {
    const candidate = resolvePath(base, "index" + extension);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/**
 * Lets plain Node run the app's TypeScript modules the way the bundler does:
 * resolves the "@/" path alias, adds the extension that bundler-style imports
 * omit, and stubs "server-only" (a Next.js build-time marker with no runtime).
 */
export function registerAliasHook() {
  registerHooks({
    resolve(specifier, context, next) {
      if (specifier === "server-only") {
        return { url: "data:text/javascript,export {}", shortCircuit: true };
      }

      if (specifier.startsWith("@/")) {
        const target = firstExisting(resolvePath(ROOT, specifier.slice(2)));
        if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
      }

      if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
        const target = firstExisting(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier));
        if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
      }

      return next(specifier, context);
    },
  });
}
