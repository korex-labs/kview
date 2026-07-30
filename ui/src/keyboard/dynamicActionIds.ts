export type CustomCommandKeyboardActionId = `custom-command.${string}`;
export type CustomActionKeyboardActionId = `custom-action.${string}`;
export type DynamicKeyboardActionId = CustomCommandKeyboardActionId | CustomActionKeyboardActionId;

export function customCommandKeyboardActionId(id: string): CustomCommandKeyboardActionId {
  return `custom-command.${id}`;
}

export function customActionKeyboardActionId(id: string): CustomActionKeyboardActionId {
  return `custom-action.${id}`;
}
