// Test-only module resolver. The website's TypeScript imports its own code as "@/lib/..." (a path alias that Next.js
// and tsc understand). Node does not, so the unit tests register this loader to map "@/x" to "src/x.ts".
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export async function resolve(specifier, context, nextResolve) {
  // `server-only` is a build-time marker that Next.js resolves itself; outside Next.js it is an empty module.
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  // A relative import without an extension inside the website's TypeScript ("./gateway"): Node needs the file name.
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.endsWith(".ts")) {
    const base = join(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  if (specifier.startsWith("@/")) {
    const base = join(ROOT, "src", specifier.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
