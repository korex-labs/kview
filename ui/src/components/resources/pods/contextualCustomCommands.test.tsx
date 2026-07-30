// @vitest-environment jsdom

import React, { useMemo } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import KeyboardProvider, { useContextualKeyboardActions, useKeyboardScope, type KeyboardFocusScope } from "../../../keyboard/KeyboardProvider";
import { defaultKeyboardSettings, type CustomCommandDefinition } from "../../../settings";
import {
  buildCustomCommandContextualActions,
  customCommandTargets,
  resolveCustomCommandChooserTarget,
} from "./contextualCustomCommands";

const drawerScope: KeyboardFocusScope = { id: "drawer-test", label: "Drawer", kind: "drawer", suppressGlobalShortcuts: true };
function DrawerScope() { useKeyboardScope(drawerScope); return null; }

const command = (overrides: Partial<CustomCommandDefinition> = {}): CustomCommandDefinition => ({
  id: "inspect",
  enabled: true,
  name: "Inspect",
  containerPattern: "",
  workdir: "",
  command: "env",
  outputType: "text",
  codeLanguage: "",
  fileName: "",
  compress: false,
  safety: "safe",
  ...overrides,
});

function Registrar({ actions }: { actions: ReturnType<typeof buildCustomCommandContextualActions> }) {
  useContextualKeyboardActions(useMemo(() => actions, [actions]));
  return null;
}

function renderWithProvider(actions: ReturnType<typeof buildCustomCommandContextualActions>) {
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

describe("custom command contextual actions", () => {
  it("deduplicates definitions by id while retaining all actionable matching containers", () => {
    expect(customCommandTargets([command(), command()], ["api", "worker"])).toEqual([
      { command: command(), containerNames: ["api", "worker"] },
    ]);
    expect(customCommandTargets([command({ enabled: false })], ["api"])).toEqual([]);
  });

  it("invalidates a chooser request when the pod identity changes", () => {
    const targets = customCommandTargets([command()], ["api", "worker"]);
    const request = { commandId: "inspect", context: "cluster-a", namespace: "apps", podName: "pod-a" };
    expect(resolveCustomCommandChooserTarget(request, "cluster-a", "apps", "pod-a", targets)).toEqual(targets[0]);
    expect(resolveCustomCommandChooserTarget(request, "cluster-b", "apps", "pod-a", targets)).toBeNull();
    expect(resolveCustomCommandChooserTarget(request, "cluster-a", "apps", "pod-b", targets)).toBeNull();
    expect(resolveCustomCommandChooserTarget(request, "cluster-a", "other", "pod-a", targets)).toBeNull();
  });

  it("dispatches a single target directly with the configured id and binding", () => {
    const runCommand = vi.fn();
    const chooseContainer = vi.fn();
    const actions = buildCustomCommandContextualActions({
      targets: customCommandTargets([command({ containerPattern: "^api$" })], ["api", "worker"]),
      overrides: { "custom-command.inspect": [["g", "i"]] },
      disabled: false,
      runCommand,
      chooseContainer,
    });
    expect(actions[0]).toMatchObject({ id: "custom-command.inspect", bindings: [["g", "i"]], disabled: false });
    renderWithProvider(actions);

    fireEvent.keyDown(window, { key: "g" });
    fireEvent.keyDown(window, { key: "i" });

    expect(runCommand).toHaveBeenCalledWith("api", expect.objectContaining({ id: "inspect" }));
    expect(chooseContainer).not.toHaveBeenCalled();
  });

  it("opens explicit selection for multiple targets and does not run while disabled", () => {
    const runCommand = vi.fn();
    const chooseContainer = vi.fn();
    const targets = customCommandTargets([command()], ["api", "worker"]);
    const actions = buildCustomCommandContextualActions({
      targets,
      overrides: { "custom-command.inspect": [["i"]] },
      disabled: false,
      runCommand,
      chooseContainer,
    });
    renderWithProvider(actions);
    fireEvent.keyDown(window, { key: "i" });
    expect(chooseContainer).toHaveBeenCalledWith(expect.objectContaining({ id: "inspect" }), ["api", "worker"]);
    expect(runCommand).not.toHaveBeenCalled();

    cleanup();
    renderWithProvider(buildCustomCommandContextualActions({
      targets,
      overrides: { "custom-command.inspect": [["i"]] },
      disabled: true,
      runCommand,
      chooseContainer,
    }));
    fireEvent.keyDown(window, { key: "i" });
    expect(runCommand).not.toHaveBeenCalled();
    expect(chooseContainer).toHaveBeenCalledTimes(1);
  });
});
