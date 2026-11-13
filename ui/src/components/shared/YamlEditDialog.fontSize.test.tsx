// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UserSettingsProvider } from "../../settingsContext";
import YamlEditDialog from "./YamlEditDialog";

// No network action is needed to preview a local diff.
vi.mock("../../api", async (original) => ({ ...await original<typeof import("../../api")>(), apiPostWithContext: vi.fn() }));
afterEach(() => { cleanup(); localStorage.clear(); });

it("zooms the read-only diff without changing the editable YAML or its overlay alignment", async () => {
  const initialYaml = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: fixture\ndata:\n  key: before";
  const edited = initialYaml.replace("before", "after");
  await act(async () => { render(<UserSettingsProvider><YamlEditDialog open onClose={() => {}} token="fixture-token"
    target={{ kind: "ConfigMap", group: "", resource: "configmaps", apiVersion: "v1", name: "fixture" }} initialYaml={initialYaml} />
  </UserSettingsProvider>); });
  const editor = screen.getByRole("textbox", { name: "Patch YAML" }) as HTMLTextAreaElement;
  const editorSize = getComputedStyle(editor).fontSize;
  fireEvent.change(editor, { target: { value: edited } });
  fireEvent.click(screen.getByRole("button", { name: "Diff from loaded YAML" }));
  const controls = screen.getByRole("group", { name: "Text viewer font size" });
  const diff = controls.parentElement!.querySelector("pre")!;
  const payload = diff.textContent;
  fireEvent.click(within(controls).getByRole("button", { name: "Increase text size" }));
  expect(getComputedStyle(diff).fontSize).toBe("14px");
  expect(diff.textContent).toBe(payload);
  expect(diff.contains(controls)).toBe(false);
  expect(controls.textContent).toBe("");
  expect(getComputedStyle(controls).position).toBe("absolute");
  expect(getComputedStyle(diff.parentElement!).position).toBe("relative");
  expect(getComputedStyle(diff).paddingBottom).toBe("52px");
  expect(getComputedStyle(diff).maxHeight).toBe(`${window.innerHeight / 2}px`);
  expect(editor.value).toBe(edited);
  expect(getComputedStyle(editor).fontSize).toBe(editorSize);
  expect(editor.parentElement!.querySelector("pre")!.style.fontSize).toBe("0.85rem");
});
