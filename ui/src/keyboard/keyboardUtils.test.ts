// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  canonicalizeKeyChord,
  eventToBinding,
  isKeyboardOwnedOverlayTarget,
  keyboardTargetScope,
  matchKeySequence,
  shouldIgnoreContextShortcut,
  shouldIgnoreGlobalShortcut,
} from "./keyboardUtils";

describe("keyboardUtils", () => {
  it("normalizes printable shortcuts and modifiers", () => {
    expect(eventToBinding({ key: "?", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })).toBe("?");
    expect(eventToBinding({ key: ":", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })).toBe(":");
    expect(eventToBinding({ key: "k", shiftKey: false, ctrlKey: true, metaKey: false, altKey: false })).toBe("ctrl+k");
    expect(eventToBinding({ key: " ", shiftKey: false, ctrlKey: true, metaKey: false, altKey: false })).toBe("ctrl+space");
    expect(canonicalizeKeyChord("Shift+Ctrl+K")).toBe("ctrl+shift+k");
    expect(canonicalizeKeyChord("ctrl+space")).toBe("ctrl+space");
    expect(canonicalizeKeyChord("shift+1")).toBeNull();
    expect(canonicalizeKeyChord("shift+/")).toBeNull();
    expect(canonicalizeKeyChord("shift+!")).toBe("shift+!");
    expect(eventToBinding({ key: "!", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })).toBe("shift+!");
    expect(canonicalizeKeyChord("+")).toBe("plus");
    expect(canonicalizeKeyChord("shift+plus")).toBe("shift+plus");
    expect(eventToBinding({ key: "+", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })).toBe("shift+plus");
  });

  it("matches full and partial key sequences", () => {
    expect(matchKeySequence(["g", "p"], ["g"])).toBe("partial");
    expect(matchKeySequence(["g", "p"], ["g", "p"])).toBe("matched");
    expect(matchKeySequence(["g", "p"], ["g", "x"])).toBe("none");
  });

  it("does not ignore a missing target", () => {
    expect(shouldIgnoreGlobalShortcut(null)).toBe(false);
    expect(shouldIgnoreContextShortcut(null)).toBe(false);
    expect(isKeyboardOwnedOverlayTarget(null)).toBe(false);
    expect(keyboardTargetScope(null)).toBe("app");
  });

  it("treats overlays as keyboard-owned surfaces", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);

    expect(isKeyboardOwnedOverlayTarget(button)).toBe(true);
    expect(keyboardTargetScope(button)).toBe("overlay");
    expect(shouldIgnoreContextShortcut(button)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(button)).toBe(true);
  });

  it("treats editable targets as shortcut-owned by the input", () => {
    const input = document.createElement("input");
    input.type = "text";

    expect(isKeyboardOwnedOverlayTarget(input)).toBe(false);
    expect(keyboardTargetScope(input)).toBe("editable");
    expect(shouldIgnoreContextShortcut(input)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(input)).toBe(true);
  });

  it("classifies drawers and terminals separately", () => {
    const drawer = document.createElement("div");
    drawer.className = "MuiDrawer-root";
    const drawerPaper = document.createElement("div");
    drawerPaper.className = "MuiDrawer-paper";
    drawerPaper.setAttribute("role", "dialog");
    const drawerButton = document.createElement("button");
    drawerPaper.appendChild(drawerButton);
    drawer.appendChild(drawerPaper);
    document.body.appendChild(drawer);

    const nestedDialog = document.createElement("div");
    nestedDialog.setAttribute("role", "dialog");
    const nestedDialogButton = document.createElement("button");
    nestedDialog.appendChild(nestedDialogButton);
    drawerPaper.appendChild(nestedDialog);

    const terminal = document.createElement("div");
    terminal.className = "xterm";
    const terminalCell = document.createElement("div");
    terminal.appendChild(terminalCell);
    document.body.appendChild(terminal);

    expect(keyboardTargetScope(drawerButton)).toBe("drawer");
    expect(shouldIgnoreContextShortcut(drawerButton)).toBe(false);
    expect(shouldIgnoreGlobalShortcut(drawerButton)).toBe(true);
    expect(keyboardTargetScope(nestedDialogButton)).toBe("overlay");
    expect(shouldIgnoreContextShortcut(nestedDialogButton)).toBe(true);

    expect(keyboardTargetScope(terminalCell)).toBe("terminal");
    expect(shouldIgnoreContextShortcut(terminalCell)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(terminalCell)).toBe(true);
  });
});
