import { describe, expect, it } from "vitest";
import type { CustomActionDefinition, CustomCommandDefinition } from "../settings";
import {
  customActionKeyboardActionId,
  customCommandKeyboardActionId,
  dynamicKeyboardActionDefinitions,
  effectiveDynamicKeyboardActions,
} from "./dynamicActions";

const command = (patch: Partial<CustomCommandDefinition> = {}): CustomCommandDefinition => ({
  id: "inspect-env",
  enabled: true,
  name: "Inspect environment",
  containerPattern: "",
  workdir: "",
  command: "/bin/env",
  outputType: "text",
  codeLanguage: "",
  fileName: "",
  compress: false,
  safety: "safe",
  ...patch,
});

const action = (patch: Partial<CustomActionDefinition> = {}): CustomActionDefinition => ({
  id: "restart-api",
  enabled: false,
  name: "Restart API",
  resources: ["deployments"],
  action: "set",
  target: "env",
  key: "RESTARTED_AT",
  value: "now",
  runtimeValue: false,
  containerPattern: "",
  patchType: "merge",
  patchBody: "{}",
  safety: "dangerous",
  ...patch,
});

describe("dynamic keyboard actions", () => {
  it("uses stored definition IDs so labels can be renamed without changing action identity", () => {
    expect(customCommandKeyboardActionId("inspect-env")).toBe("custom-command.inspect-env");
    expect(customActionKeyboardActionId("restart-api")).toBe("custom-action.restart-api");

    const before = dynamicKeyboardActionDefinitions([command()], []);
    const after = dynamicKeyboardActionDefinitions([command({ name: "Renamed command" })], []);
    expect(before[0].id).toBe(after[0].id);
    expect(after[0].label).toBe("Custom Command: Renamed command");
  });

  it("includes enabled and disabled definitions with type, runtime scope, and mapped safety", () => {
    expect(dynamicKeyboardActionDefinitions([command()], [action()])).toEqual([
      expect.objectContaining({
        id: "custom-command.inspect-env",
        label: "Custom Command: Inspect environment",
        group: "Custom Commands",
        scopes: ["pod-drawer"],
        safety: "safe",
        enabled: true,
        typeLabel: "Custom Command",
      }),
      expect.objectContaining({
        id: "custom-action.restart-api",
        label: "Custom Action: Restart API",
        group: "Custom Actions",
        scopes: ["drawer"],
        safety: "dangerous",
        enabled: false,
        typeLabel: "Custom Action",
      }),
    ]);
  });

  it("treats missing overrides as unbound and clones configured overrides", () => {
    const definitions = dynamicKeyboardActionDefinitions([command()], [action({ enabled: true })]);
    expect(effectiveDynamicKeyboardActions(definitions, {})).toEqual([
      expect.objectContaining({ id: "custom-command.inspect-env", bindings: [] }),
      expect.objectContaining({ id: "custom-action.restart-api", bindings: [] }),
    ]);

    const overrides = { "custom-command.inspect-env": [["g", "e"]] };
    const effective = effectiveDynamicKeyboardActions(definitions, overrides);
    expect(effective[0].bindings).toEqual([["g", "e"]]);
    expect(effective[1].bindings).toEqual([]);
    expect(effective[0].bindings).not.toBe(overrides["custom-command.inspect-env"]);
  });

  it("omits deleted definitions without touching their persisted overrides", () => {
    const overrides = { "custom-command.deleted": [["ctrl+d"]] };
    expect(effectiveDynamicKeyboardActions(dynamicKeyboardActionDefinitions([], []), overrides)).toEqual([]);
    expect(overrides).toEqual({ "custom-command.deleted": [["ctrl+d"]] });
  });
});
