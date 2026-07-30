import { describe, expect, it } from "vitest";
import { shortcutCommandsForSettings, tableNavigationDirectionForBinding } from "./shortcuts";
import { defaultKeyboardSettings, normalizeKeyboardSettings, type KeyboardSettings } from "../settings";

const enabled: KeyboardSettings = defaultKeyboardSettings();

function bindingsFor(settings: KeyboardSettings, id: string): string[] {
  const command = shortcutCommandsForSettings(settings).find((item) => item.id === id);
  return command?.bindings.map((binding) => binding.join(" ")) ?? [];
}

describe("shortcutCommandsForSettings", () => {
  it("keeps all keyboard convenience bindings enabled by default", () => {
    expect(bindingsFor(enabled, "search.focus")).toEqual(["ctrl+k", "s"]);
    expect(bindingsFor(enabled, "activity.panel.toggle")).toEqual(["alt+a", "g a"]);
    expect(bindingsFor(enabled, "activity.panel.activities")).toEqual(["alt+1", "g 1"]);
    expect(bindingsFor(enabled, "activity.panel.work")).toEqual(["alt+2", "g 2"]);
    expect(bindingsFor(enabled, "activity.panel.terminals")).toEqual(["alt+3", "g 3"]);
    expect(bindingsFor(enabled, "activity.panel.portForwards")).toEqual(["alt+4", "g 4"]);
    expect(bindingsFor(enabled, "activity.panel.logs")).toEqual(["alt+5", "g 5"]);
    expect(bindingsFor(enabled, "table.cell.up")).toEqual(["arrowup", "k", "d"]);
    expect(bindingsFor(enabled, "table.cell.down")).toEqual(["arrowdown", "j", "s"]);
  });

  it("uses compiled preset overrides on the compatibility surface", () => {
    const settings: KeyboardSettings = {
      ...defaultKeyboardSettings(),
      preset: "browser-safe",
      overrides: { "nav.pods": [["p"]], "activity.panel.toggle": [] },
    };

    expect(bindingsFor(settings, "search.focus")).toEqual(["ctrl+k"]);
    expect(bindingsFor(settings, "nav.pods")).toEqual(["p"]);
    expect(bindingsFor(settings, "activity.panel.toggle")).toEqual([]);
  });

  it("removes disabled optional bindings while keeping core shortcuts", () => {
    const disabled = normalizeKeyboardSettings({
      vimTableNavigation: false,
      homeRowTableNavigation: false,
      singleLetterGlobalSearch: false,
    });

    expect(bindingsFor(disabled, "search.focus")).toEqual(["ctrl+k"]);
    expect(bindingsFor(disabled, "table.cell.up")).toEqual(["arrowup"]);
    expect(bindingsFor(disabled, "table.cell.down")).toEqual(["arrowdown"]);
  });

  it("maps partial, arbitrary, and disabled directional overrides at runtime", () => {
    const settings = normalizeKeyboardSettings({
      preset: "browser-safe",
      overrides: { "table.cell.up": [["x"]], "table.cell.down": [] },
    });
    expect(tableNavigationDirectionForBinding(settings, "x")).toBe("up");
    expect(tableNavigationDirectionForBinding(settings, "arrowup")).toBeNull();
    expect(tableNavigationDirectionForBinding(settings, "arrowdown")).toBeNull();
    expect(tableNavigationDirectionForBinding(settings, "arrowleft")).toBe("left");
  });
});
