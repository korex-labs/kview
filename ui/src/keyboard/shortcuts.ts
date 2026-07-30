import type { Section } from "../state";
import { normalizeKeyboardSettings, type KeyboardSettings } from "../settings";
import {
  type EffectiveKeyboardAction,
  type KeyboardActionGroup,
  type KeyboardActionId,
} from "./actions";
import { compileKeymap } from "./keymaps";

export type ShortcutGroup = KeyboardActionGroup;
export type ShortcutCommandId = KeyboardActionId;

export type ShortcutCommand = {
  id: ShortcutCommandId;
  label: string;
  group: ShortcutGroup;
  bindings: string[][];
  section?: Section;
};

function toShortcutCommand(action: EffectiveKeyboardAction): ShortcutCommand {
  return {
    id: action.id,
    label: action.label,
    group: action.group,
    bindings: action.bindings,
    ...(action.section ? { section: action.section } : {}),
  };
}

export const shortcutCommands: ShortcutCommand[] = compileKeymap("kview-classic", {}).map(toShortcutCommand);

export function shortcutCommandsForSettings(settings: KeyboardSettings): ShortcutCommand[] {
  const normalized = normalizeKeyboardSettings(settings);
  return compileKeymap(normalized.preset, normalized.overrides).map(toShortcutCommand);
}

export type TableNavigationDirection = "up" | "down" | "left" | "right";

const tableDirectionActions: Array<{ id: KeyboardActionId; direction: TableNavigationDirection }> = [
  { id: "table.cell.up", direction: "up" },
  { id: "table.cell.down", direction: "down" },
  { id: "table.cell.left", direction: "left" },
  { id: "table.cell.right", direction: "right" },
];

export function tableNavigationDirectionForBinding(
  settings: KeyboardSettings,
  binding: string,
): TableNavigationDirection | null {
  const normalized = normalizeKeyboardSettings(settings);
  const compiled = compileKeymap(normalized.preset, normalized.overrides);
  for (const { id, direction } of tableDirectionActions) {
    const action = compiled.find((candidate) => candidate.id === id);
    if (action?.bindings.some((sequence) => sequence.length === 1 && sequence[0] === binding)) return direction;
  }
  return null;
}

export function formatBinding(binding: string[]): string {
  return binding
    .map((part) => part.split("+").map((piece) => {
      if (piece === "ctrl") return "Ctrl";
      if (piece === "meta") return "Meta";
      if (piece === "alt") return "Alt";
      if (piece === "shift") return "Shift";
      if (piece === "enter") return "Enter";
      return piece.length === 1 ? piece : piece[0].toUpperCase() + piece.slice(1);
    }).join("+"))
    .join(" then ");
}
