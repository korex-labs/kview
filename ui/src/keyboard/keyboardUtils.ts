import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type NormalizedKey = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

export type KeyboardTargetScope = "app" | "editable" | "overlay" | "drawer" | "terminal";

type KeyboardLike = Pick<KeyboardEvent | ReactKeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

const modifierOrder = ["ctrl", "meta", "alt", "shift"] as const;
const modifierSet = new Set<string>(modifierOrder);
const canonicalNamedKeys = new Set([
  "enter", "escape", "tab", "backspace", "delete", "home", "end", "pageup", "pagedown",
  "arrowup", "arrowdown", "arrowleft", "arrowright", "space", "plus",
]);

function canonicalKeyName(value: string): string {
  const key = value.toLowerCase();
  if (key === " " || key === "spacebar") return "space";
  if (key === "+") return "plus";
  if (key === "esc") return "escape";
  if (key === "return") return "enter";
  return key;
}

export function canonicalizeKeyChord(chord: string): string | null {
  const raw = chord === " " ? "space" : chord === "+" ? "plus" : chord.trim().toLowerCase();
  if (!raw || /\s/.test(raw)) return null;
  const pieces = raw.split("+");
  if (pieces.some((piece) => !piece)) return null;
  const key = canonicalKeyName(pieces[pieces.length - 1]);
  const modifiers = pieces.slice(0, -1);
  if (modifiers.some((piece) => !modifierSet.has(piece))) return null;
  if (new Set(modifiers).size !== modifiers.length || modifierSet.has(key)) return null;
  if (!(key.length === 1 || canonicalNamedKeys.has(key) || /^f(?:[1-9]|1[0-2])$/.test(key))) return null;
  // KeyboardEvent.key reports the produced character, not the physical key.
  // Reject layout-dependent Shift+physical-punctuation forms that could never
  // match semantic event output; the recorder stores reachable forms such as
  // `shift+!`, while `?` and `:` intentionally omit their implicit Shift.
  if (modifiers.includes("shift") && /^[0-9`\-=[\]\\;',./]$/.test(key)) return null;
  const normalizedModifiers = modifierOrder.filter((modifier) => modifiers.includes(modifier));
  const effectiveModifiers = key === "?" || key === ":"
    ? normalizedModifiers.filter((modifier) => modifier !== "shift")
    : normalizedModifiers;
  return [...effectiveModifiers, key].join("+");
}

const ignoredInputTypes = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "radio",
  "range",
  "reset",
  "submit",
]);

const overlaySurfaceSelector = [
  ".MuiAutocomplete-popper",
  ".MuiMenu-root",
  ".MuiPopover-root",
  ".MuiDialog-root",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
].join(",");

const drawerSurfaceSelector = ".MuiDrawer-root";
const terminalSurfaceSelector = ".xterm";
const ignoreShortcutSurfaceSelector = "[data-kview-ignore-shortcuts='true']";

export function normalizeKeyboardEvent(event: KeyboardLike): NormalizedKey {
  const key = canonicalKeyName(event.key);
  const printableShortcut = key === "?" || key === ":";
  return {
    key,
    ctrl: !!event.ctrlKey,
    meta: !!event.metaKey,
    alt: !!event.altKey,
    shift: printableShortcut ? false : !!event.shiftKey,
  };
}

export function normalizedKeyToBinding(key: NormalizedKey): string {
  const parts: string[] = [];
  if (key.ctrl) parts.push("ctrl");
  if (key.meta) parts.push("meta");
  if (key.alt) parts.push("alt");
  if (key.shift) parts.push("shift");
  parts.push(key.key);
  return parts.join("+");
}

export function eventToBinding(event: KeyboardLike): string {
  return normalizedKeyToBinding(normalizeKeyboardEvent(event));
}

export function isEditableElement(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  if (tagName === "textarea" || tagName === "select") return true;
  if (tagName !== "input") return false;
  const type = target.getAttribute("type")?.toLowerCase() || "text";
  return !ignoredInputTypes.has(type);
}

export function shouldIgnoreGlobalShortcut(target: EventTarget | null): boolean {
  return keyboardTargetScope(target) !== "app";
}

export function isKeyboardOwnedOverlayTarget(target: EventTarget | null): boolean {
  return keyboardTargetScope(target) === "overlay";
}

export function shouldIgnoreContextShortcut(target: EventTarget | null): boolean {
  const scope = keyboardTargetScope(target);
  return scope === "editable" || scope === "overlay" || scope === "terminal";
}

export function keyboardTargetScope(target: EventTarget | null): KeyboardTargetScope {
  if (typeof HTMLElement === "undefined") return "app";
  if (!(target instanceof HTMLElement)) return "app";
  if (isEditableElement(target)) return "editable";
  if (target.closest(ignoreShortcutSurfaceSelector)) return "editable";
  const drawer = target.closest(drawerSurfaceSelector);
  const overlay = target.closest(overlaySurfaceSelector);
  // MUI Drawer papers carry role="dialog". Treat that paper as the drawer
  // surface, while preserving ownership for a real nested dialog/menu.
  if (overlay && !(drawer && overlay.classList.contains("MuiDrawer-paper"))) return "overlay";
  if (drawer) return "drawer";
  if (target.closest(terminalSurfaceSelector)) return "terminal";
  return "app";
}

export type SequenceMatch = "matched" | "partial" | "none";

export function matchKeySequence(sequence: string[], pressed: string[]): SequenceMatch {
  if (pressed.length > sequence.length) return "none";
  for (let i = 0; i < pressed.length; i += 1) {
    if (sequence[i] !== pressed[i]) return "none";
  }
  return pressed.length === sequence.length ? "matched" : "partial";
}
