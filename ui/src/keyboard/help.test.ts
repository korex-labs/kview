import { describe, expect, it } from "vitest";
import { buildShortcutHelpSections } from "./help";
import { shortcutCommandsForSettings } from "./shortcuts";
import type { KeyboardSettings } from "../settings";

const enabled: KeyboardSettings = {
  vimTableNavigation: true,
  homeRowTableNavigation: true,
  singleLetterGlobalSearch: true,
};

function helpBindings(settings: KeyboardSettings, commandId: string): string[] {
  return buildShortcutHelpSections(shortcutCommandsForSettings(settings), [])
    .flatMap((section) => section.rows)
    .find((row) => row.id === commandId)
    ?.bindings.map((binding) => binding.join(" ")) ?? [];
}

describe("buildShortcutHelpSections", () => {
  it("uses the active keyboard settings for optional bindings", () => {
    const disabled: KeyboardSettings = {
      vimTableNavigation: false,
      homeRowTableNavigation: false,
      singleLetterGlobalSearch: false,
    };

    expect(helpBindings(enabled, "search.focus")).toEqual(["ctrl+k", "s"]);
    expect(helpBindings(disabled, "search.focus")).toEqual(["ctrl+k"]);
    expect(helpBindings(disabled, "table.cell.navigate")).toEqual(["Arrow keys"]);
  });

  it("adds current resource actions after global sections", () => {
    const sections = buildShortcutHelpSections(shortcutCommandsForSettings(enabled), [
      {
        id: "pod.logs",
        label: "Open logs",
        binding: ["l"],
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
});
