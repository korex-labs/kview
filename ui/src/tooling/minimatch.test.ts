import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Resolve from the consumer, not from this test: a nested vulnerable copy must
// not be hidden by a healthy root copy. typescript-estree's project-service
// matcher uses the named minimatch export with { dot: true }.
// Keep these contracts when removing the scoped override once an upstream
// parent supports minimatch 11 without changing our native/legacy TS bridge.
const require = createRequire(import.meta.url);
const fromEstree = createRequire(require.resolve("@typescript-eslint/typescript-estree"));
const { minimatch } = fromEstree("minimatch") as typeof import("minimatch");

describe("typescript-estree minimatch contract", () => {
  it.each<[string, string, boolean]>([
    // ESLint file/ignore patterns and Vite test/coverage patterns.
    ["src/main.tsx", "**/*.tsx", true],
    ["src/main.tsx", "**/*.ts", false],
    ["src/vite-env.d.ts", "**/*.d.ts", true],
    ["dist/assets/main.js", "dist/**", true],
    ["node_modules/example/index.js", "node_modules/**", true],
    ["src/utils/example.test.ts", "src/**/*.test.ts", true],
    ["src/components/Example.test.tsx", "src/**/*.test.tsx", true],
    ["src/main.tsx", "src/**/*.{ts,tsx}", true],
    ["src/example.test.tsx", "src/**/*.test.{ts,tsx}", true],
    ["e2e/example.test.ts", "src/**/*.test.ts", false],
    // Project-service dot:true includes hidden files and hidden directories.
    [".config.ts", "*.ts", true],
    ["src/.hidden/example.ts", "src/**/*.ts", true],
    ["src/a/b.ts", "src/*.ts", false],
    ["src/example.ts", "src/@(example|other).ts", true],
    ["src/third.ts", "src/@(example|other).ts", false],
    // v11 intentionally does not let extglobs consume empty trailing portions.
    ["a/b/", "a/b/?(x)", false],
    ["a/b/", "a/b/*(x)", false],
    ["a/b/", "a/b/*", false],
    ["a/b/", "a/b/", true],
    ["a/b/x", "a/b/?(x)", true],
    // Globstar sections of different lengths must not drop valid matches.
    ["root/a/b/c/middle/d/end.ts", "**/a/b/c/**/d/**", true],
  ])("matches %s against %s: %s", (file, pattern, expected) => {
    expect(minimatch(file, pattern, { dot: true })).toBe(expected);
  });

  it.each<[string, string, boolean]>([
    ["C:/project/.config.ts", "c:/project/*.ts", true],
    ["//HOST/SHARE/project/file.ts", "//host/share/project/*.ts", true],
    ["//?/UNC/host/share/project/file.ts", "//host/share/project/*.ts", true],
    ["x", "C:/a/../../x", false],
  ])("keeps Windows roots for %s against %s: %s", (file, pattern, expected) => {
    // Explicit platform exercises Windows rules in the Linux verification image.
    // These forward-slash inputs do not promise backslash normalization by the
    // parent, which passes path.relative output without extra minimatch options.
    expect(minimatch(file, pattern, { dot: true, platform: "win32" })).toBe(expected);
  });
});
