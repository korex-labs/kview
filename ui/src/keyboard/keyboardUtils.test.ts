// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import {
  eventToBinding,
  isKeyboardOwnedOverlayTarget,
  matchKeySequence,
  shouldIgnoreContextShortcut,
  shouldIgnoreGlobalShortcut,
} from "./keyboardUtils";

describe("keyboardUtils", () => {
  it("normalizes printable shortcuts and modifiers", () => {
    expect(eventToBinding({ key: "?", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })).toBe("?");
    expect(eventToBinding({ key: ":", shiftKey: true, ctrlKey: false, metaKey: false, altKey: false })).toBe(":");
    expect(eventToBinding({ key: "k", shiftKey: false, ctrlKey: true, metaKey: false, altKey: false })).toBe("ctrl+k");
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
  });

  it("treats overlays as keyboard-owned surfaces", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const button = document.createElement("button");
    dialog.appendChild(button);
    document.body.appendChild(dialog);

    expect(isKeyboardOwnedOverlayTarget(button)).toBe(true);
    expect(shouldIgnoreContextShortcut(button)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(button)).toBe(true);
  });

  it("treats editable targets as shortcut-owned by the input", () => {
    const input = document.createElement("input");
    input.type = "text";

    expect(isKeyboardOwnedOverlayTarget(input)).toBe(false);
    expect(shouldIgnoreContextShortcut(input)).toBe(true);
    expect(shouldIgnoreGlobalShortcut(input)).toBe(true);
  });
});
