// @vitest-environment jsdom

import React, { useMemo } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KeyboardProvider, { useContextualKeyboardActions, useKeyboardScope, type KeyboardFocusScope } from "../../keyboard/KeyboardProvider";
import { defaultKeyboardSettings, type CustomActionDefinition } from "../../settings";
import { buildCustomActionContextualActions } from "./contextualCustomActions";

const drawerScope: KeyboardFocusScope = { id: "drawer-test", label: "Drawer", kind: "drawer", suppressGlobalShortcuts: true };
function DrawerScope() { useKeyboardScope(drawerScope); return null; }

const action = (overrides: Partial<CustomActionDefinition> = {}): CustomActionDefinition => ({
  id: "restart-sidecar",
  enabled: true,
  name: "Restart sidecar",
  resources: ["deployments"],
  action: "set",
  target: "env",
  key: "RESTARTED_AT",
  value: "now",
  runtimeValue: false,
  containerPattern: "",
  patchType: "merge",
  patchBody: "",
  safety: "safe",
  ...overrides,
});

function Registrar({ actions }: { actions: ReturnType<typeof buildCustomActionContextualActions> }) {
  useContextualKeyboardActions(useMemo(() => actions, [actions]));
  return null;
}

function renderWithProvider(actions: ReturnType<typeof buildCustomActionContextualActions>) {
  render(
    <KeyboardProvider
      settingsOpen={false}
      keyboardSettings={defaultKeyboardSettings()}
      onFocusGlobalSearch={vi.fn()}
      onSelectSection={vi.fn()}
      onOpenSettings={vi.fn()}
    >
      <DrawerScope />
      <Registrar actions={actions} />
    </KeyboardProvider>,
  );
}

afterEach(cleanup);

describe("custom action contextual actions", () => {
  it("uses stable dynamic ids/bindings, deduplicates ids, and dispatches through the shared runner", () => {
    const run = vi.fn();
    const actions = buildCustomActionContextualActions({
      actions: [action(), action()],
      overrides: { "custom-action.restart-sidecar": [["g", "r"]] },
      disabled: false,
      run,
    });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: "custom-action.restart-sidecar",
      bindings: [["g", "r"]],
      disabled: false,
    });
    renderWithProvider(actions);

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "r" });

    expect(run).toHaveBeenCalledWith(expect.objectContaining({ id: "restart-sidecar" }));
  });

  it("keeps RBAC-denied and disabled/deleted definitions inert", () => {
    const run = vi.fn();
    const denied = buildCustomActionContextualActions({
      actions: [action()],
      overrides: { "custom-action.restart-sidecar": [["r"]] },
      disabled: true,
      run,
    });
    renderWithProvider(denied);
    fireEvent.keyDown(window, { key: "r" });
    expect(run).not.toHaveBeenCalled();

    expect(buildCustomActionContextualActions({
      actions: [action({ enabled: false })],
      overrides: { "custom-action.restart-sidecar": [["r"]] },
      disabled: false,
      run,
    })).toEqual([]);
    expect(buildCustomActionContextualActions({
      actions: [],
      overrides: { "custom-action.restart-sidecar": [["r"]] },
      disabled: false,
      run,
    })).toEqual([]);
  });
});
