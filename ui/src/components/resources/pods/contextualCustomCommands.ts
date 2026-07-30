import type { ContextualKeyboardAction } from "../../../keyboard/KeyboardProvider";
import { customCommandKeyboardActionId } from "../../../keyboard/dynamicActions";
import {
  customCommandsForContainer,
  type CustomCommandDefinition,
  type KeyboardSettings,
} from "../../../settings";

export type CustomCommandTarget = {
  command: CustomCommandDefinition;
  containerNames: string[];
};

export type CustomCommandChooserRequest = {
  commandId: string;
  context: string;
  namespace: string;
  podName: string;
};

export function resolveCustomCommandChooserTarget(
  request: CustomCommandChooserRequest | null,
  context: string,
  namespace: string,
  podName: string,
  targets: CustomCommandTarget[],
): CustomCommandTarget | null {
  if (
    !request
    || request.context !== context
    || request.namespace !== namespace
    || request.podName !== podName
  ) return null;
  return targets.find(({ command }) => command.id === request.commandId) || null;
}

export function customCommandTargets(
  commands: CustomCommandDefinition[],
  containerNames: string[],
): CustomCommandTarget[] {
  const targetsById = new Map<string, CustomCommandTarget>();
  for (const containerName of containerNames) {
    for (const command of customCommandsForContainer(commands, containerName)) {
      const existing = targetsById.get(command.id);
      if (existing) {
        if (!existing.containerNames.includes(containerName)) existing.containerNames.push(containerName);
      } else {
        targetsById.set(command.id, { command, containerNames: [containerName] });
      }
    }
  }
  return Array.from(targetsById.values());
}

export function buildCustomCommandContextualActions({
  targets,
  overrides,
  disabled,
  runCommand,
  chooseContainer,
}: {
  targets: CustomCommandTarget[];
  overrides: KeyboardSettings["overrides"];
  disabled: boolean;
  runCommand: (containerName: string, command: CustomCommandDefinition) => void;
  chooseContainer: (command: CustomCommandDefinition, containerNames: string[]) => void;
}): ContextualKeyboardAction[] {
  return targets.map(({ command, containerNames }) => {
    const id = customCommandKeyboardActionId(command.id);
    return {
      id,
      label: command.name || command.command,
      bindings: overrides[id] ?? [],
      disabled,
      run: () => {
        if (disabled || containerNames.length === 0) return false;
        if (containerNames.length === 1) {
          runCommand(containerNames[0], command);
        } else {
          chooseContainer(command, containerNames);
        }
        return true;
      },
    };
  });
}
