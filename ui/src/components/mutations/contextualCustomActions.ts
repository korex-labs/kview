import type { ContextualKeyboardAction } from "../../keyboard/KeyboardProvider";
import { customActionKeyboardActionId } from "../../keyboard/dynamicActions";
import type { CustomActionDefinition, KeyboardSettings } from "../../settings";

export function buildCustomActionContextualActions({
  actions,
  overrides,
  disabled,
  run,
}: {
  actions: CustomActionDefinition[];
  overrides: KeyboardSettings["overrides"];
  disabled: boolean;
  run: (action: CustomActionDefinition) => void;
}): ContextualKeyboardAction[] {
  const seen = new Set<string>();
  return actions.flatMap((action) => {
    if (!action.enabled || seen.has(action.id)) return [];
    seen.add(action.id);
    const id = customActionKeyboardActionId(action.id);
    return [{
      id,
      label: action.name || "Custom action",
      bindings: overrides[id] ?? [],
      disabled,
      run: () => {
        if (disabled) return false;
        run(action);
        return true;
      },
    }];
  });
}
