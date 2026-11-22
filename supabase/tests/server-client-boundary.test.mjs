// The React server / client boundary, checked statically over the whole website.
//
// THE DEFECT THIS GUARDS AGAINST (found on the first hosted use of the order workflow v2, 2026-11-22): the staff order page is a SERVER
// component and imported `fulfillmentLabel` from `components/admin/forms.tsx`, a "use client" module, and CALLED it while rendering an order that
// is on the current workflow. Next.js turns every export of a client module into a client reference when it is imported from server code;
// a client reference can be rendered as a component or passed as a prop to a client component, but CALLING it on the server throws
//   "Attempted to call fulfillmentLabel() from the server but fulfillmentLabel is on the client."
// The page then fell to the admin error boundary ("This page could not load"). Nothing before the browser catches it: TypeScript, lint and
// `next build` all accept the call, and the unit tests import the modules in plain Node, where there is no boundary.
//
// The rule: a module that is not itself a client module must not CALL anything it imports from a client module. (Rendering one as a JSX element,
// or handing it to a client component as a prop, is what the boundary is for, and is allowed.) A function a server page needs belongs in a plain module
// that both sides import.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(ROOT, "src");
const ts = createRequire(import.meta.url)("typescript");

const EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, name.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

/** True when the file opens with the "use client" directive (comments before it are allowed). */
export function isClientModule(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

/**
 * `files` maps a path to its source text. Returns one finding per call a non-client module makes to something it imported from a client module.
 * `resolveImport(fromPath, specifier)` returns the path the specifier names, or null for a package.
 */
export function findClientCallsOnTheServer(files, resolveImport) {
  const parsed = new Map([...files].map(([path, text]) => [path, parse(path, text)]));
  const client = new Set([...parsed].filter(([, sf]) => isClientModule(sf)).map(([path]) => path));
  const findings = [];
  for (const [path, sf] of parsed) {
    if (client.has(path)) continue;
    const bound = new Map(); // local name -> { module, namespace }
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.importClause?.isTypeOnly) continue;
      const target = resolveImport(path, statement.moduleSpecifier.text);
      if (!target || !client.has(target)) continue;
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) bound.set(clause.name.text, { module: target, namespace: false });
      const named = clause.namedBindings;
      if (named && ts.isNamespaceImport(named)) bound.set(named.name.text, { module: target, namespace: true });
      if (named && ts.isNamedImports(named)) for (const element of named.elements) if (!element.isTypeOnly) bound.set(element.name.text, { module: target, namespace: false });
    }
    if (bound.size === 0) continue;
    const visit = (node) => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const callee = node.expression;
        let name = null;
        if (ts.isIdentifier(callee) && bound.has(callee.text) && !bound.get(callee.text).namespace) name = callee.text;
        if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && bound.get(callee.expression.text)?.namespace) name = `${callee.expression.text}.${callee.name.text}`;
        if (name) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
          const root = name.split(".")[0];
          findings.push({ path, line: line + 1, name, module: bound.get(root).module });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return findings;
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts") ? [full] : [];
  });
}

function realResolve(from, specifier) {
  const base = specifier.startsWith("@/") ? join(SRC, specifier.slice(2)) : specifier.startsWith(".") ? resolve(dirname(from), specifier) : null;
  if (!base) return null;
  for (const extension of EXTENSIONS) if (existsSync(base + extension) && statSync(base + extension).isFile()) return base + extension;
  return existsSync(base) && statSync(base).isFile() ? base : null;
}

describe("the server / client boundary: a server module never calls a client module's export", () => {
  it("the detector flags the exact defect (a server page calling a function from a client module)", () => {
    const files = new Map([
      ["/s/forms.tsx", `"use client";\nexport const fulfillmentLabel = (t) => t;\nexport function TransitionForm() { return null; }`],
      ["/s/page.tsx", `import { TransitionForm, fulfillmentLabel } from "./forms";\nexport default function Page() {\n  return <p>{fulfillmentLabel("x")}<TransitionForm /></p>;\n}`],
    ]);
    const found = findClientCallsOnTheServer(files, (from, spec) => (spec === "./forms" ? "/s/forms.tsx" : null));
    assert.equal(found.length, 1);
    assert.deepEqual([found[0].path, found[0].line, found[0].name], ["/s/page.tsx", 3, "fulfillmentLabel"]);
  });

  it("the detector also flags a namespace import, a default import and `new`, and ignores rendering, prop passing and type imports", () => {
    const files = new Map([
      ["/s/c.tsx", `// a comment first\n"use client";\nexport default function Box() { return null; }\nexport const helper = () => 1;\nexport type Shape = { a: number };`],
      ["/s/ns.tsx", `import * as c from "./c";\nexport const x = () => c.helper();`],
      ["/s/def.tsx", `import Box from "./c";\nexport const y = () => Box();`],
      ["/s/ok.tsx", `import Box, { helper } from "./c";\nimport type { Shape } from "./c";\nconst z: Shape = { a: 1 };\nexport default function Page() { return <Box render={helper} shape={z} />; }`],
      ["/s/clientcaller.tsx", `"use client";\nimport { helper } from "./c";\nexport const w = () => helper();`],
    ]);
    const found = findClientCallsOnTheServer(files, (from, spec) => (spec === "./c" ? "/s/c.tsx" : null));
    assert.deepEqual(found.map((f) => `${f.path}:${f.name}`).sort(), ["/s/def.tsx:Box", "/s/ns.tsx:c.helper"]);
  });

  it("no module in src/ that is not a client module calls a function it imported from a client module", () => {
    const files = new Map(walk(SRC).map((path) => [path, readFileSync(path, "utf8")]));
    assert.ok(files.size > 100, "the scan must see the whole website");
    const clientCount = [...files].filter(([path, text]) => isClientModule(parse(path, text))).length;
    assert.ok(clientCount >= 10, "the scan must recognise the website's client modules");
    const found = findClientCallsOnTheServer(files, realResolve);
    const lines = found.map((f) => `${relative(ROOT, f.path)}:${f.line} calls ${f.name}() from the client module ${relative(ROOT, f.module)}`);
    assert.deepEqual(lines, [], `a server module calls a client module's export, which Next.js refuses at run time:\n  ${lines.join("\n  ")}`);
  });
});
