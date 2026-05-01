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
