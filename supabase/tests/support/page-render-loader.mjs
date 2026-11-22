// Test-only module loader: renders the website's own SERVER PAGES (TSX) in plain Node, with the real components, the real helpers
// and real data, and without a running Next.js server.
//
// What is REAL: every component, helper and formatter the page imports (src/**), React's server renderer, the data (a database that has the real
// migrations; the tests feed the page what admin.get_order returned).
// What is STUBBED, because it needs a running Next.js server, a browser session or a second factor: the staff session (`requireStaff`),
// `next/link`, and the server actions (the forms only hand them to React; none is called while a page renders).
//
// ONE RULE OF NEXT.JS IS EMULATED, because it is what the first hosted use of order workflow v2 tripped over and nothing else in the test
// suite can see: when a SERVER module imports from a "use client" module, every export becomes a client reference. It can be rendered as a
// component, but CALLING it on the server throws. Here a client module's exports are given to server importers like this:
//   - a name that starts with a capital letter (a component) is the real thing, so it renders;
//   - any other name (a function, a hook, a helper) throws Next's own error when it is called.
// (The static test in server-client-boundary.test.mjs checks the same rule over every file without running anything.)
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve as aliasResolve } from "./alias-loader.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const ts = createRequire(import.meta.url)("typescript");

const FILE_STUBS = new Map([
  ["next/link", join(HERE, "next-link-stub.mjs")],
  ["@/lib/staff/session", join(HERE, "staff-session-stub.mjs")],
]);
// Server-action modules: replaced by stubs with the same export names (a form only passes them to React while a page renders).
const ACTION_MODULES = new Map([
  ["@/lib/staff/actions", join(ROOT, "src", "lib", "staff", "actions.ts")],
  ["@/lib/staff/mfa-actions", join(ROOT, "src", "lib", "staff", "mfa-actions.ts")],
  ["@/lib/accounts/server/actions", join(ROOT, "src", "lib", "accounts", "server", "actions.ts")],
]);

const textCache = new Map();
const textOf = (path) => {
  if (!textCache.has(path)) textCache.set(path, readFileSync(path, "utf8"));
  return textCache.get(path);
};
const isClientText = (text) => /^(?:\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*["']use client["']/.test(text);
const pathOf = (url) => fileURLToPath(url.split("?")[0]);
const scriptKind = (name) => (name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function bindingNames(node, into) {
  if (ts.isIdentifier(node)) into.add(node.text);
  else for (const element of node.elements ?? []) if (!ts.isOmittedExpression(element)) bindingNames(element.name, into);
}

/** The run-time (value) exports of a TypeScript module. */
function exportNames(text, fileName) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, scriptKind(fileName));
  const names = new Set();
  let hasDefault = false;
  for (const statement of sf.statements) {
    const modifiers = ts.canHaveModifiers(statement) ? (ts.getModifiers(statement) ?? []) : [];
    const exported = modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportAssignment(statement) || (exported && modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword))) hasDefault = true;
    else if (exported && (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) names.add(statement.name.text);
    else if (exported && ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) bindingNames(d.name, names);
    else if (exported && ts.isEnumDeclaration(statement) && !modifiers.some((m) => m.kind === ts.SyntaxKind.ConstKeyword)) names.add(statement.name.text);
    else if (ts.isExportDeclaration(statement) && !statement.isTypeOnly && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) if (!element.isTypeOnly) names.add(element.name.text);
    }
  }
  return { names: [...names], hasDefault };
}

const clientCallError = (name) =>
  `Attempted to call ${name}() from the server but ${name} is on the client. It's not possible to invoke a client function from the server, it can only be rendered as a Component or passed to props of a Client Component.`;

export async function resolve(specifier, context, nextResolve) {
  if (FILE_STUBS.has(specifier)) return { url: pathToFileURL(FILE_STUBS.get(specifier)).href, shortCircuit: true };
  if (ACTION_MODULES.has(specifier)) return { url: `${pathToFileURL(ACTION_MODULES.get(specifier)).href}?actions-stub`, shortCircuit: true };

  let resolved;
  // A relative import without an extension inside the website's own code ("./use-idempotency-key"): Node needs the file name.
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.startsWith("file:") && pathOf(context.parentURL).startsWith(join(ROOT, "src"))) {
    const base = join(dirname(pathOf(context.parentURL)), specifier);
    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
      if (existsSync(candidate)) {
        resolved = { url: pathToFileURL(candidate).href, shortCircuit: true };
        break;
      }
    }
  }
  resolved ??= await aliasResolve(specifier, context, nextResolve);

  // The server / client boundary: a server module importing a client module gets client references.
  if (resolved.url.startsWith("file:") && !resolved.url.includes("?") && /\.tsx?$/.test(resolved.url) && context.parentURL?.startsWith("file:")) {
    const target = pathOf(resolved.url);
    const parent = pathOf(context.parentURL);
    if (target.startsWith(join(ROOT, "src")) && parent.startsWith(join(ROOT, "src")) && isClientText(textOf(target)) && !isClientText(textOf(parent))) {
      return { url: `${resolved.url}?rsc=server`, shortCircuit: true };
    }
  }
  return resolved;
}

export async function load(url, context, nextLoad) {
  if (url.includes("?actions-stub")) {
    const path = pathOf(url);
    const { names, hasDefault } = exportNames(textOf(path), path);
    const body = names.map((n) => `export const ${n} = async () => ({ status: "idle" });`).join("\n") + (hasDefault ? "\nexport default async () => ({});" : "");
    return { format: "module", source: body, shortCircuit: true };
  }
  if (url.includes("?rsc=server")) {
    const real = url.split("?")[0];
    const path = pathOf(url);
    const { names, hasDefault } = exportNames(textOf(path), path);
    const lines = [`import * as real from ${JSON.stringify(real)};`];
    for (const name of names) {
      lines.push(/^[A-Z]/.test(name) ? `export const ${name} = real.${name};` : `export const ${name} = function ${name}() { throw new Error(${JSON.stringify(clientCallError(name))}); };`);
    }
    if (hasDefault) lines.push("export default real.default;");
    return { format: "module", source: lines.join("\n"), shortCircuit: true };
  }
  if (url.startsWith("file:") && url.endsWith(".tsx") && pathOf(url).startsWith(join(ROOT, "src"))) {
    const out = ts.transpileModule(readFileSync(pathOf(url), "utf8"), {
      fileName: pathOf(url),
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    return { format: "module", source: out, shortCircuit: true };
  }
  return nextLoad(url, context);
}
