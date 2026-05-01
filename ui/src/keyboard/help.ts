import type { ShortcutCommand, ShortcutGroup } from "./shortcuts";

type ContextualKeyboardActionHelp = {
  id: string;
  label: string;
  binding: string[];
  disabled?: boolean;
};

export type ShortcutHelpRow = {
  id: string;
  label: string;
  bindings: string[][];
  disabled?: boolean;
};

export type ShortcutHelpSection = {
  title: string;
  rows: ShortcutHelpRow[];
};

export function buildShortcutHelpSections(
  commands: ShortcutCommand[],
  contextActions: ContextualKeyboardActionHelp[],
): ShortcutHelpSection[] {
  const groups: Record<ShortcutGroup, ShortcutCommand[]> = {
    Global: [],
    Navigation: [],
    Table: [],
    "Command Mode": [],
  };
  for (const command of commands) groups[command.group].push(command);

  const entries: ShortcutHelpSection[] = (Object.keys(groups) as ShortcutGroup[]).map((group) => ({
    title: group,
    rows: groups[group].map((command) => ({
      id: command.id,
      label: command.label,
      bindings: command.bindings,
    })),
  }));

  if (contextActions.length) {
    entries.push({
      title: "Current Resource",
      rows: contextActions.map((action) => ({
        id: action.id,
        label: action.label,
        bindings: [action.binding],
        disabled: action.disabled,
      })),
    });
  }

  return entries;
}
