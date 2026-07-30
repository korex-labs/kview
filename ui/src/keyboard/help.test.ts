import { describe, expect, it } from "vitest";
import { buildShortcutHelpSections } from "./help";
import { shortcutCommandsForSettings } from "./shortcuts";
import { defaultKeyboardSettings, normalizeKeyboardSettings, type KeyboardSettings } from "../settings";

const enabled: KeyboardSettings = defaultKeyboardSettings();

function helpBindings(settings: KeyboardSettings, commandId: string): string[] {
  return buildShortcutHelpSections(shortcutCommandsForSettings(settings), [])
    .flatMap((section) => section.rows)
    .find((row) => row.id === commandId)
    ?.bindings.map((binding) => binding.join(" ")) ?? [];
}

describe("buildShortcutHelpSections", () => {
  it("uses the active keyboard settings for optional bindings", () => {
    const disabled = normalizeKeyboardSettings({
      vimTableNavigation: false,
      homeRowTableNavigation: false,
      singleLetterGlobalSearch: false,
    });

    expect(helpBindings(enabled, "search.focus")).toEqual(["ctrl+k", "s"]);
    expect(helpBindings(disabled, "search.focus")).toEqual(["ctrl+k"]);
    expect(helpBindings(disabled, "table.cell.up")).toEqual(["arrowup"]);
    expect(helpBindings(disabled, "table.cell.down")).toEqual(["arrowdown"]);
  });

  it("shows compiled override bindings rather than static defaults", () => {
    const settings: KeyboardSettings = {
      ...defaultKeyboardSettings(),
      overrides: { "help.open": [["g", "?"]], "nav.settings": [] },
    };

    expect(helpBindings(settings, "help.open")).toEqual(["g ?"]);
    expect(helpBindings(settings, "nav.settings")).toEqual([]);
  });

  it("adds current resource actions after global sections", () => {
    const sections = buildShortcutHelpSections(shortcutCommandsForSettings(enabled), [
      {
        id: "pod.logs",
        label: "Open logs",
        bindings: [["l"]],
        disabled: true,
      },
    ]);

    expect(sections[sections.length - 1]).toEqual({
      title: "Current Resource",
      rows: [
        {
          id: "pod.logs",
          label: "Open logs",
          bindings: [["l"]],
          disabled: true,
        },
      ],
    });
  });

  it("omits unbound contextual actions from effective Help", () => {
    const sections = buildShortcutHelpSections(shortcutCommandsForSettings(enabled), [
      { id: "custom-command.unbound", label: "Unbound", bindings: [], disabled: true },
    ]);
    expect(sections.find((section) => section.title === "Current Resource")).toBeUndefined();
  });
});
