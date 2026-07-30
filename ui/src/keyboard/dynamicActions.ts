import type {
  KeyboardActionSafety,
  KeyboardActionScope,
  KeySequence,
} from "./actions";
import type {
  CustomActionDefinition,
  CustomCommandDefinition,
  KeyboardSettings,
} from "../settings";
import {
  customActionKeyboardActionId,
  customCommandKeyboardActionId,
  type DynamicKeyboardActionId,
} from "./dynamicActionIds";

export {
  customActionKeyboardActionId,
  customCommandKeyboardActionId,
  type CustomActionKeyboardActionId,
  type CustomCommandKeyboardActionId,
  type DynamicKeyboardActionId,
} from "./dynamicActionIds";
export type DynamicKeyboardActionGroup = "Custom Commands" | "Custom Actions";
export type DynamicKeyboardActionTypeLabel = "Custom Command" | "Custom Action";

export type DynamicKeyboardActionDefinition = {
  id: DynamicKeyboardActionId;
  label: string;
  group: DynamicKeyboardActionGroup;
  scopes: KeyboardActionScope[];
  safety: KeyboardActionSafety;
  enabled: boolean;
  typeLabel: DynamicKeyboardActionTypeLabel;
  maxSequenceLength?: number;
};

export type EffectiveDynamicKeyboardAction = DynamicKeyboardActionDefinition & {
  bindings: KeySequence[];
};

function commandDefinition(command: CustomCommandDefinition): DynamicKeyboardActionDefinition {
  return {
    id: customCommandKeyboardActionId(command.id),
    label: `Custom Command: ${command.name}`,
    group: "Custom Commands",
    scopes: ["pod-drawer"],
    safety: command.safety,
    enabled: command.enabled,
    typeLabel: "Custom Command",
  };
}

function actionDefinition(action: CustomActionDefinition): DynamicKeyboardActionDefinition {
  return {
    id: customActionKeyboardActionId(action.id),
    label: `Custom Action: ${action.name}`,
    group: "Custom Actions",
    scopes: ["drawer"],
    safety: action.safety,
    enabled: action.enabled,
    typeLabel: "Custom Action",
  };
}

export function dynamicKeyboardActionDefinitions(
  customCommands: readonly CustomCommandDefinition[],
  customActions: readonly CustomActionDefinition[],
): DynamicKeyboardActionDefinition[] {
  return [
    ...customCommands.map(commandDefinition),
    ...customActions.map(actionDefinition),
  ];
}

function cloneBindings(bindings: KeySequence[]): KeySequence[] {
  return bindings.map((sequence) => [...sequence]);
}

export function effectiveDynamicKeyboardActions(
  definitions: readonly DynamicKeyboardActionDefinition[],
  overrides: KeyboardSettings["overrides"],
): EffectiveDynamicKeyboardAction[] {
  return definitions.map((definition) => ({
    ...definition,
    scopes: [...definition.scopes],
    bindings: cloneBindings(Object.prototype.hasOwnProperty.call(overrides, definition.id)
      ? overrides[definition.id] ?? []
      : []),
  }));
}
