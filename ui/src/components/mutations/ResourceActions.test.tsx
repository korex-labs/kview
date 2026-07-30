// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveContextProvider } from "../../activeContext";
import { defaultUserSettings, type CustomActionDefinition } from "../../settings";
import KeyboardProvider, { useKeyboardScope, type KeyboardFocusScope } from "../../keyboard/KeyboardProvider";
import { MutationCtx, type OpenMutationParams } from "./MutationProvider";

const mocks = vi.hoisted(() => ({
  settings: undefined as ReturnType<typeof defaultUserSettings> | undefined,
  caps: { delete: true, update: true, patch: true, create: true },
}));

vi.mock("../../settingsContext", () => ({
  useUserSettings: () => ({ settings: mocks.settings }),
}));
vi.mock("./useResourceCapabilities", () => ({
  useResourceCapabilities: () => mocks.caps,
  canPatchOrUpdate: (caps: typeof mocks.caps | null) => Boolean(caps?.patch || caps?.update),
  RBAC_DISABLED_REASON: "Not permitted by RBAC",
}));

import { WorkloadRestartDeleteActions } from "./ResourceActions";

const drawerScope: KeyboardFocusScope = { id: "drawer-test", label: "Drawer", kind: "drawer", suppressGlobalShortcuts: true };
function DrawerScope() { useKeyboardScope(drawerScope); return null; }

const customAction = (overrides: Partial<CustomActionDefinition> = {}): CustomActionDefinition => ({
  id: "restart-sidecar",
  enabled: true,
  name: "Restart sidecar",
  resources: ["daemonsets"],
  action: "set",
  target: "env",
  key: "RESTARTED_AT",
  value: "now",
  runtimeValue: true,
  containerPattern: "sidecar",
  patchType: "merge",
  patchBody: "",
  safety: "safe",
  ...overrides,
});

const config = {
  group: "apps",
  resource: "daemonsets",
  kind: "DaemonSet",
  apiVersion: "apps/v1",
  restartId: "daemonset.restart",
  restartTitle: "Restart",
  restartDescription: "Restart daemonset",
  deleteId: "daemonset.delete",
  deleteTitle: "Delete",
  deleteDescription: "Delete daemonset",
};

function renderActions(open: (params: OpenMutationParams) => void) {
  const settings = mocks.settings!;
  return render(
    <ActiveContextProvider value="prod">
      <MutationCtx.Provider value={{ open }}>
        <KeyboardProvider
          settingsOpen={false}
          keyboardSettings={settings.keyboard}
          onFocusGlobalSearch={vi.fn()}
          onSelectSection={vi.fn()}
          onOpenSettings={vi.fn()}
        >
          <DrawerScope />
          <WorkloadRestartDeleteActions
            token="token"
            namespace="default"
            name="agents"
            onRefresh={vi.fn()}
            onDeleted={vi.fn()}
            config={config}
          />
        </KeyboardProvider>
      </MutationCtx.Provider>
    </ActiveContextProvider>,
  );
}

beforeEach(() => {
  mocks.caps = { delete: true, update: true, patch: true, create: true };
  mocks.settings = defaultUserSettings();
  mocks.settings.customActions.actions = [customAction()];
  mocks.settings.keyboard.overrides = { "custom-action.restart-sidecar": [["r"]] };
});

afterEach(cleanup);

describe("ResourceActions custom action runtime", () => {
  it("uses the same guarded dialog path for menu and keyboard while preserving safe runtime params", () => {
    const open = vi.fn();
    renderActions(open);

    fireEvent.click(screen.getByRole("button", { name: "Custom actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Restart sidecar" }));
    const menuRequest = open.mock.calls[0][0];

    open.mockClear();
    fireEvent.keyDown(window, { key: "r" });
    const keyboardRequest = open.mock.calls[0][0];

    expect(keyboardRequest).toEqual(menuRequest);
    expect(keyboardRequest).toMatchObject({
      token: "token",
      targetRef: { context: "prod", kind: "DaemonSet", name: "agents", namespace: "default" },
      descriptor: {
        id: "custom.workload",
        risk: "medium",
        confirmSpec: { mode: "simple" },
        paramSpecs: [{ key: "value", required: true, defaultValue: "now" }],
      },
      params: { op: "set", target: "env", key: "RESTARTED_AT", value: "now", containerPattern: "sidecar" },
      initialParams: { value: "now" },
    });
  });

  it("preserves dangerous typed confirmation and blocks RBAC-denied keyboard dispatch", () => {
    mocks.settings!.customActions.actions = [customAction({ safety: "dangerous", runtimeValue: false })];
    const open = vi.fn();
    const view = renderActions(open);

    fireEvent.keyDown(window, { key: "r" });
    expect(open.mock.calls[0][0].descriptor).toMatchObject({
      risk: "high",
      confirmSpec: { mode: "typed", requiredValue: "agents" },
    });

    open.mockClear();
    mocks.caps = { delete: false, update: false, patch: false, create: false };
    view.rerender(
      <ActiveContextProvider value="prod">
        <MutationCtx.Provider value={{ open }}>
          <KeyboardProvider
            settingsOpen={false}
            keyboardSettings={mocks.settings!.keyboard}
            onFocusGlobalSearch={vi.fn()}
            onSelectSection={vi.fn()}
            onOpenSettings={vi.fn()}
          >
            <WorkloadRestartDeleteActions
              token="token"
              namespace="default"
              name="agents"
              onRefresh={vi.fn()}
              onDeleted={vi.fn()}
              config={config}
            />
          </KeyboardProvider>
        </MutationCtx.Provider>
      </ActiveContextProvider>,
    );
    fireEvent.keyDown(window, { key: "r" });
    expect(open).not.toHaveBeenCalled();
  });
});
