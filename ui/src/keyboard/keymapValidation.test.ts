import { describe, expect, it } from "vitest";
import type { EffectiveKeyboardAction } from "./actions";
import { validateKeymap, type KeymapDiagnostic, type ValidatableKeyboardAction } from "./keymapValidation";

function action(id: EffectiveKeyboardAction["id"], scopes: EffectiveKeyboardAction["scopes"], bindings: string[][]): EffectiveKeyboardAction {
  return { id, label: id, group: "Global", scopes, safety: "safe", bindings };
}

describe("keymap validation", () => {
  it("returns structured malformed-binding diagnostics", () => {
    const diagnostics = validateKeymap([
      action("search.focus", ["app"], [["ctrl+"], ["ctrl+shift+k"], ["no such key"]]),
    ]);
    expect(diagnostics.filter((item) => item.code === "malformed-binding")).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({ severity: "error", actionId: "search.focus", binding: ["ctrl+"] });
  });

  it("reports exact and prefix collisions in simultaneous scopes", () => {
    const diagnostics = validateKeymap([
      action("search.focus", ["app"], [["g"]]),
      action("nav.pods", ["app"], [["g"], ["g", "p"]]),
    ]);
    expect(diagnostics.map((item) => item.code)).toContain("exact-collision");
    expect(diagnostics.map((item) => item.code)).toContain("prefix-collision");
  });

  it("reports duplicate bindings within one action", () => {
    expect(validateKeymap([
      action("search.focus", ["app"], [["ctrl+k"], ["Ctrl+K"]]),
    ])).toContainEqual(expect.objectContaining({ code: "duplicate-binding", actionId: "search.focus" }));
  });

  it("reports prefix collisions within one action", () => {
    expect(validateKeymap([
      action("search.focus", ["app"], [["g"], ["g", "p"]]),
    ])).toContainEqual(expect.objectContaining({ code: "prefix-collision", actionId: "search.focus", binding: ["g"] }));
  });

  it("rejects sequences longer than the action runtime supports", () => {
    const directional = action("table.cell.up", ["table"], [["g", "u"]]);
    directional.maxSequenceLength = 1;
    expect(validateKeymap([directional])).toContainEqual(expect.objectContaining({
      code: "malformed-binding",
      actionId: "table.cell.up",
      binding: ["g", "u"],
    }));
  });

  it("allows collisions in mutually exclusive scopes", () => {
    expect(validateKeymap([
      action("search.focus", ["app"], [["s"]]),
      action("table.cell.down", ["table"], [["s"]]),
    ]).filter((item) => item.code.includes("collision"))).toEqual([]);
  });

  it("warns when the first chord is commonly browser-reserved", () => {
    const diagnostics = validateKeymap([
      action("search.focus", ["app"], [["ctrl+l"], ["ctrl+r", "x"], ["ctrl+k"]]),
    ]);
    expect(diagnostics.filter((item: KeymapDiagnostic) => item.code === "browser-reserved")).toHaveLength(3);
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "browser-reserved",
      severity: "warning",
      binding: ["ctrl+r", "x"],
    }));
    expect(diagnostics).toContainEqual(expect.objectContaining({
      code: "browser-reserved",
      severity: "warning",
      binding: ["ctrl+k"],
    }));
  });

  it("validates Pod-drawer dynamic actions against overlapping typed drawer built-ins", () => {
    const dynamic: ValidatableKeyboardAction = {
      id: "custom-command.inspect-env",
      label: "Custom Command: Inspect environment",
      scopes: ["pod-drawer"],
      bindings: [["n"]],
    };
    expect(validateKeymap([
      action("drawer.tab.notes", ["drawer"], [["n"]]),
      dynamic,
    ])).toContainEqual(expect.objectContaining({
      code: "exact-collision",
      actionId: "drawer.tab.notes",
      conflictingActionId: "custom-command.inspect-env",
    }));
  });
});
