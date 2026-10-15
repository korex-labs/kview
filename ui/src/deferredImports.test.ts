import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));

// Follow runtime static imports/re-exports, including helper/barrel backdoors.
// Dynamic import() and erased type-only imports intentionally stop the traversal.
function eagerDependencies(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  function visit(file: string) {
    if (files.has(file)) return;
    files.add(file);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
          && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((item) => item.isTypeOnly)) continue;
      } else if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const name = specifier.text;
      if (!name.startsWith(".")) { packages.add(name); continue; }
      const base = resolve(dirname(file), name);
      const dependency = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]
        .find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
      if (dependency) visit(dependency);
    }
  }
  visit(resolve(sourceRoot, entry));
  return { files: [...files].map((file) => file.slice(sourceRoot.length)), packages: [...packages] };
}

describe("frontend deferred import contracts", () => {
  it("does not pull concrete resource drawers, terminal, or highlighting into the shell", () => {
    const eager = eagerDependencies("App.tsx");
    expect(eager.files.filter((file) => /components\/resources\/.*Drawer\.tsx$/.test(file))).toEqual([]);
    expect(eager.files.filter((file) => /TerminalSessionView\.tsx$/.test(file) && !file.endsWith("DeferredTerminalSessionView.tsx"))).toEqual([]);
    expect(eager.packages.filter((name) => /^(?:@xterm\/|react-syntax-highlighter|refractor)/.test(name))).toEqual([]);
  });

  it("does not fetch highlighting just to render a CodeBlock or editor module", () => {
    for (const entry of ["components/shared/CodeBlock.tsx", "components/shared/YamlEditDialog.tsx", "components/settings/SettingsView.tsx"]) {
      expect(eagerDependencies(entry).packages.filter((name) => /^(?:react-syntax-highlighter|refractor)/.test(name))).toEqual([]);
    }
  });
});
