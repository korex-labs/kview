import { describe, expect, it } from "vitest";
import { compileKeymap, keymapPresets } from "./keymaps";
import { validateKeymap } from "./keymapValidation";

describe("keymap presets and compiler", () => {
  it("provides three stable presets", () => {
    expect(keymapPresets.map((preset) => preset.id)).toEqual(["kview-classic", "vim-k9s", "browser-safe"]);
  });

  it("validates every built-in preset without errors", () => {
    for (const preset of keymapPresets) {
      expect(validateKeymap(compileKeymap(preset.id, {})).filter((item) => item.severity === "error"), preset.id).toEqual([]);
    }
  });

  it("compiles deterministically in registry order", () => {
    const first = compileKeymap("kview-classic", {});
    const second = compileKeymap("kview-classic", {});
    expect(first).toEqual(second);
    expect(first.find((action) => action.id === "search.focus")?.bindings).toEqual([["ctrl+k"], ["s"]]);
  });

  it("inherits missing overrides, replaces with non-empty overrides, and disables with empty overrides", () => {
    const compiled = compileKeymap("kview-classic", {
      "search.focus": [["meta+k"], ["g", "f"]],
      "nav.pods": [],
    });
    expect(compiled.find((action) => action.id === "search.focus")?.bindings).toEqual([["meta+k"], ["g", "f"]]);
    expect(compiled.find((action) => action.id === "nav.pods")?.bindings).toEqual([]);
    expect(compiled.find((action) => action.id === "nav.services")?.bindings).toEqual([["g", "s"]]);
  });

  it("returns fresh binding arrays", () => {
    const first = compileKeymap("kview-classic", {});
    first[0].bindings[0][0] = "mutated";
    expect(compileKeymap("kview-classic", {})[0].bindings[0][0]).not.toBe("mutated");
  });

  it("keeps browser-safe app bindings modifier-first and valid", () => {
    const modifier = new Set(["ctrl", "meta", "alt"]);
    const compiled = compileKeymap("browser-safe", {});
    const appBindings = compiled
      .filter((action) => action.scopes.includes("app"))
      .flatMap((action) => action.bindings.map((binding) => ({ actionId: action.id, binding })));
    expect(appBindings.every(({ actionId, binding }) =>
      (actionId === "table.row.open" && binding.join(" ") === "enter")
      || binding[0].split("+").some((piece) => modifier.has(piece)),
    )).toBe(true);
    expect(validateKeymap(compiled).filter((item) => item.severity === "error")).toEqual([]);
  });
});
