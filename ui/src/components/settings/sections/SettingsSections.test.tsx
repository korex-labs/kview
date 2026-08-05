// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultUserSettings,
  newCustomActionDefinition,
  newCustomCommandDefinition,
  type KviewUserSettingsV2,
} from "../../../settings";
import CustomActionsSettingsSection from "./CustomActionsSettingsSection";
import PodToolsSettingsSection from "./PodToolsSettingsSection";

const invalidRegexSource = String.fromCharCode(91);

function command(id: string, name: string, containerPattern = "") {
  return { ...newCustomCommandDefinition(), id, name, command: "echo test", containerPattern };
}

function action(id: string, name: string, containerPattern = "") {
  return { ...newCustomActionDefinition(), id, name, containerPattern };
}

function Harness({
  initial,
  section,
}: {
  initial: KviewUserSettingsV2;
  section: "commands" | "actions";
}) {
  const [settings, setSettings] = React.useState(initial);
  return section === "commands" ? (
    <PodToolsSettingsSection settings={settings} setSettings={setSettings} />
  ) : (
    <CustomActionsSettingsSection settings={settings} setSettings={setSettings} />
  );
}

function inputValues(label: string): string[] {
  return screen.getAllByRole("textbox", { name: new RegExp(`^${label}`) }).map((element) =>
    (element as HTMLInputElement).value
  );
}

function errorMessage(work: () => void, fallback: string): string {
  try {
    work();
    return "";
  } catch (error) {
    return (error as Error).message || fallback;
  }
}

afterEach(cleanup);

describe("PodToolsSettingsSection", () => {
  it("adds, reorders, and removes commands", () => {
    const settings = defaultUserSettings();
    settings.customCommands.commands = [command("first", "First"), command("second", "Second")];
    render(<Harness initial={settings} section="commands" />);

    fireEvent.click(screen.getByRole("button", { name: "Move command 2 up" }));
    expect(inputValues("Name")).toEqual(["Second", "First"]);

    fireEvent.click(screen.getByRole("button", { name: "Add command" }));
    expect(inputValues("Name")).toEqual(["Second", "First", "New command"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove command 2" }));
    expect(inputValues("Name")).toEqual(["Second", "New command"]);
  }, 30_000);

  it("preserves the command regex validation message", () => {
    const settings = defaultUserSettings();
    settings.customCommands.commands = [command("invalid", "Invalid", invalidRegexSource)];
    render(<Harness initial={settings} section="commands" />);

    expect(screen.getByText(errorMessage(() => new RegExp(invalidRegexSource), "Invalid regex."))).toBeTruthy();
  });
});

describe("CustomActionsSettingsSection", () => {
  it("adds, reorders, and removes actions", () => {
    const settings = defaultUserSettings();
    settings.customActions.actions = [action("first", "First"), action("second", "Second")];
    render(<Harness initial={settings} section="actions" />);

    fireEvent.click(screen.getByRole("button", { name: "Move action 1 down" }));
    expect(inputValues("Name")).toEqual(["Second", "First"]);

    fireEvent.click(screen.getByRole("button", { name: "Add action" }));
    expect(inputValues("Name")).toEqual(["Second", "First", "New action"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove action 1" }));
    expect(inputValues("Name")).toEqual(["First", "New action"]);
  });

  it("preserves the action regex validation message", () => {
    const settings = defaultUserSettings();
    settings.customActions.actions = [action("invalid", "Invalid", invalidRegexSource)];
    render(<Harness initial={settings} section="actions" />);

    expect(screen.getByText(errorMessage(() => new RegExp(invalidRegexSource), "Invalid regex."))).toBeTruthy();
  });

  it("preserves required and malformed JSON patch validation messages", () => {
    const settings = defaultUserSettings();
    settings.customActions.actions = [
      { ...action("required", "Required body"), action: "patch", patchBody: "" },
      { ...action("invalid", "Invalid body"), action: "patch", patchBody: "{" },
    ];
    render(<Harness initial={settings} section="actions" />);

    expect(screen.getByText("Patch body is required.")).toBeTruthy();
    expect(screen.getByText(errorMessage(() => JSON.parse("{"), "Invalid JSON patch body."))).toBeTruthy();
  });
});
