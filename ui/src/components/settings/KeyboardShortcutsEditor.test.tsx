// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultKeyboardSettings, type KeyboardSettings } from "../../settings";
import type { DynamicKeyboardActionDefinition } from "../../keyboard/dynamicActions";
import KeyboardShortcutsEditor from "./KeyboardShortcutsEditor";

const dynamicDefinitions: DynamicKeyboardActionDefinition[] = [
  {
    id: "custom-command.inspect-env",
    label: "Custom Command: Inspect environment",
    group: "Custom Commands",
    scopes: ["drawer"],
    safety: "safe",
    enabled: true,
    typeLabel: "Custom Command",
  },
  {
    id: "custom-action.restart-api",
    label: "Custom Action: Restart API",
    group: "Custom Actions",
    scopes: ["drawer"],
    safety: "dangerous",
    enabled: false,
    typeLabel: "Custom Action",
  },
];

function renderEditor(
  initial: KeyboardSettings = defaultKeyboardSettings(),
  dynamics: DynamicKeyboardActionDefinition[] = [],
) {
  let current = initial;
  const onChange = vi.fn((next: KeyboardSettings) => {
    current = next;
    view.rerender(<KeyboardShortcutsEditor settings={current} onChange={onChange} dynamicActions={dynamics} />);
  });
  const view = render(<KeyboardShortcutsEditor settings={current} onChange={onChange} dynamicActions={dynamics} />);
  return { ...view, onChange, settings: () => current };
}

function row(actionId: string): HTMLElement {
  return screen.getByTestId(`keyboard-action-${actionId}`);
}

function applyKeyboardChanges() {
  fireEvent.click(screen.getByText("Apply keyboard changes"));
}

function selectGroup(group: string) {
  fireEvent.click(screen.getByRole("tab", { name: new RegExp(`^${group} \\(\\d+\\)$`) }));
}

afterEach(cleanup);

describe("KeyboardShortcutsEditor", () => {
  it("changes preset while preserving overrides", () => {
    const initial = defaultKeyboardSettings();
    initial.overrides = { "help.open": [["f1"]] };
    const view = renderEditor(initial);

    fireEvent.mouseDown(screen.getByLabelText("Keyboard preset"));
    fireEvent.click(screen.getByRole("option", { name: "Vim/k9s" }));
    applyKeyboardChanges();

    expect(view.settings().preset).toBe("vim-k9s");
    expect(view.settings().overrides["help.open"]).toEqual([["f1"]]);
  });

  it("separates action groups into tabs and filters within the selected tab", () => {
    renderEditor();
    const search = screen.getByLabelText("Search keyboard actions");

    selectGroup("Navigation");
    fireEvent.change(search, { target: { value: "nav.pods" } });
    expect(screen.getByText("Go to Pods")).toBeTruthy();
    expect(screen.queryByText("Show keyboard shortcuts")).toBeNull();

    selectGroup("Global");
    fireEvent.change(search, { target: { value: "command.open" } });
    expect(screen.getByText("Open command suggestions")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /^Command Mode/ })).toBeNull();

    selectGroup("Table");
    fireEvent.change(search, { target: { value: "table" } });
    expect(screen.getByText("Move up in the table")).toBeTruthy();
  });

  it("uses standard table pagination controls", () => {
    renderEditor();
    selectGroup("Navigation");
    expect(screen.getByTitle("Go to previous page")).toBeTruthy();
    expect(screen.getByTitle("Go to next page")).toBeTruthy();
    expect(screen.queryByText("Previous actions")).toBeNull();
    expect(screen.queryByText("Next actions")).toBeNull();
  });

  it("enables Apply and Cancel only while the draft is dirty", () => {
    renderEditor();
    const cancel = screen.getByRole("button", { name: "Cancel keyboard changes" }) as HTMLButtonElement;
    const apply = screen.getByRole("button", { name: "Apply keyboard changes" }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
    expect(apply.disabled).toBe(true);

    fireEvent.mouseDown(screen.getByLabelText("Keyboard preset"));
    fireEvent.click(screen.getByRole("option", { name: "Browser Safe" }));
    expect(cancel.disabled).toBe(false);
    expect(apply.disabled).toBe(false);

    fireEvent.click(cancel);
    expect(cancel.disabled).toBe(true);
    expect(apply.disabled).toBe(true);
  });

  it("keeps the editor compact and omits redundant success and scope labels", () => {
    renderEditor();
    expect(screen.queryByText(/Choose a preset, then override individual actions/i)).toBeNull();
    expect(screen.queryByText("No keyboard shortcut conflicts detected.")).toBeNull();
    expect(screen.queryByText(/^Scope:/)).toBeNull();
  });

  it("records and adds a multi-chord binding from key events", () => {
    const view = renderEditor();
    fireEvent.click(within(row("help.open")).getByRole("button", { name: "Add binding for Show keyboard shortcuts" }));

    const recorder = screen.getByLabelText("Record shortcut sequence");
    fireEvent.keyDown(recorder, { key: "g" });
    fireEvent.keyDown(recorder, { key: "z" });
    expect(recorder.textContent).toContain("g z");
    fireEvent.keyDown(recorder, { key: "Enter" });
    applyKeyboardChanges();

    expect(view.settings().overrides["help.open"]).toContainEqual(["g", "z"]);
  });

  it("removes individual bindings, resets, and disables an action", () => {
    const initial = defaultKeyboardSettings();
    initial.overrides = { "help.open": [["f1"], ["g", "z"]] };
    const view = renderEditor(initial);

    fireEvent.click(within(row("help.open")).getByRole("button", { name: "Remove binding f1 from Show keyboard shortcuts" }));
    applyKeyboardChanges();
    expect(view.settings().overrides["help.open"]).toEqual([["g", "z"]]);

    fireEvent.click(within(row("help.open")).getByRole("button", { name: "Reset Show keyboard shortcuts to preset" }));
    applyKeyboardChanges();
    expect(view.settings().overrides).not.toHaveProperty("help.open");

    fireEvent.click(within(row("help.open")).getByRole("button", { name: "Disable Show keyboard shortcuts" }));
    applyKeyboardChanges();
    expect(view.settings().overrides["help.open"]).toEqual([]);
    expect(within(row("help.open")).getByText("Disabled")).toBeTruthy();
  });

  it("resets all built-in overrides while preserving dynamic overrides", () => {
    const initial = defaultKeyboardSettings();
    initial.overrides = {
      "help.open": [["f1"]],
      "custom-command.dynamic-one": [["ctrl+1"]],
    };
    const view = renderEditor(initial);

    fireEvent.click(screen.getByRole("button", { name: "Restore built-in shortcuts to preset defaults" }));
    applyKeyboardChanges();

    expect(view.settings().overrides).toEqual({ "custom-command.dynamic-one": [["ctrl+1"]] });
  });

  it("shows conflict and browser-reserved diagnostics in the summary and affected rows", () => {
    const initial = defaultKeyboardSettings();
    initial.overrides = {
      "help.open": [["ctrl+s"]],
      "search.focus": [["ctrl+s"]],
    };
    renderEditor(initial);
    fireEvent.mouseDown(screen.getByLabelText("Keyboard preset"));
    fireEvent.click(screen.getByRole("option", { name: "Vim/k9s" }));

    const attention = screen.getByTestId("keyboard-attention");
    expect(within(attention).getByText("Keyboard attention")).toBeTruthy();
    expect(within(attention).getByText(/assigned to both/i)).toBeTruthy();
    expect(within(attention).getAllByText(/reserved by browsers/i).length).toBeGreaterThan(0);
    expect(within(attention).getByText(/help\.open ↔ search\.focus/i)).toBeTruthy();
    expect(within(row("help.open")).getByText(/assigned to both/i)).toBeTruthy();
    expect(within(row("help.open")).getByText(/reserved by browsers/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply keyboard changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("cancels staged keyboard changes without calling the parent", () => {
    const view = renderEditor();
    fireEvent.mouseDown(screen.getByLabelText("Keyboard preset"));
    fireEvent.click(screen.getByRole("option", { name: "Browser Safe" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel keyboard changes" }));
    expect(screen.getByRole("combobox", { name: "Keyboard preset" }).textContent).toContain("Kview Classic");
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it("searches dynamic actions by name, stable ID, and type while showing status and safety", () => {
    renderEditor(defaultKeyboardSettings(), dynamicDefinitions);
    const search = screen.getByLabelText("Search keyboard actions");

    selectGroup("Custom Commands");
    for (const query of ["Inspect environment", "custom-command.inspect-env", "custom command"]) {
      fireEvent.change(search, { target: { value: query } });
      expect(screen.getByText("Custom Command: Inspect environment")).toBeTruthy();
    }
    expect(within(row("custom-command.inspect-env")).getByText("Unbound")).toBeTruthy();
    expect(within(row("custom-command.inspect-env")).getByText("Safety: safe")).toBeTruthy();

    selectGroup("Custom Actions");
    fireEvent.change(search, { target: { value: "restart api" } });
    expect(within(row("custom-action.restart-api")).getByText("Definition disabled")).toBeTruthy();
    expect(within(row("custom-action.restart-api")).getByText("Unbound")).toBeTruthy();
    expect(within(row("custom-action.restart-api")).getByText("Safety: dangerous")).toBeTruthy();
  });

  it("binds and resets a dynamic action back to unbound", () => {
    const initial = defaultKeyboardSettings();
    initial.overrides["custom-command.inspect-env"] = [["ctrl+e"]];
    const view = renderEditor(initial, dynamicDefinitions);
    selectGroup("Custom Commands");
    fireEvent.change(screen.getByLabelText("Search keyboard actions"), { target: { value: "inspect environment" } });

    expect(within(row("custom-command.inspect-env")).getByText("Override")).toBeTruthy();
    fireEvent.click(within(row("custom-command.inspect-env")).getByRole("button", { name: "Reset Custom Command: Inspect environment to unbound" }));
    applyKeyboardChanges();

    expect(view.settings().overrides).not.toHaveProperty("custom-command.inspect-env");
    expect(within(row("custom-command.inspect-env")).getByText("Unbound")).toBeTruthy();
  });

  it("blocks Apply when an enabled dynamic binding collides in drawer scope", () => {
    const initial = defaultKeyboardSettings();
    initial.overrides["custom-command.inspect-env"] = [["n"]];
    renderEditor(initial, dynamicDefinitions);
    fireEvent.mouseDown(screen.getByLabelText("Keyboard preset"));
    fireEvent.click(screen.getByRole("option", { name: "Vim/k9s" }));
    selectGroup("Custom Commands");
    fireEvent.change(screen.getByLabelText("Search keyboard actions"), { target: { value: "inspect environment" } });

    expect(screen.getByTestId("keyboard-attention")).toBeTruthy();
    expect(within(row("custom-command.inspect-env")).getByText(/assigned to both/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply keyboard changes" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("preserves deleted dynamic overrides when resetting built-ins", () => {
    const initial = defaultKeyboardSettings();
    initial.overrides = {
      "help.open": [["f1"]],
      "custom-command.deleted": [["ctrl+d"]],
    };
    const view = renderEditor(initial, dynamicDefinitions);

    fireEvent.click(screen.getByRole("button", { name: "Restore built-in shortcuts to preset defaults" }));
    applyKeyboardChanges();

    expect(view.settings().overrides).toEqual({ "custom-command.deleted": [["ctrl+d"]] });
  });
});
