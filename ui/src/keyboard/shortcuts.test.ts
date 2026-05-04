import { describe, expect, it } from "vitest";
import { shortcutCommandsForSettings } from "./shortcuts";
import type { KeyboardSettings } from "../settings";

const enabled: KeyboardSettings = {
  vimTableNavigation: true,
  homeRowTableNavigation: true,
  singleLetterGlobalSearch: true,
};

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
    expect(bindingsFor(enabled, "table.cell.navigate")).toEqual(["Arrow keys", "h/j/k/l", "a/s/d/f"]);
  });

  it("removes disabled optional bindings while keeping core shortcuts", () => {
    const disabled: KeyboardSettings = {
      vimTableNavigation: false,
      homeRowTableNavigation: false,
      singleLetterGlobalSearch: false,
    };

    expect(bindingsFor(disabled, "search.focus")).toEqual(["ctrl+k"]);
    expect(bindingsFor(disabled, "table.cell.navigate")).toEqual(["Arrow keys"]);
  });
});
