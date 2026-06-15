import type { KeyboardEvent as ReactKeyboardEvent } from "react";

export type NormalizedKey = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

type KeyboardLike = Pick<KeyboardEvent | ReactKeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

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

const keyboardOwnedSurfaceSelector = [
  "[contenteditable='true']",
  "[data-kview-ignore-shortcuts='true']",
  ".xterm",
  ".MuiAutocomplete-popper",
  ".MuiDrawer-root",
  ".MuiMenu-root",
  ".MuiPopover-root",
  ".MuiDialog-root",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
].join(",");

const overlaySurfaceSelector = [
  ".MuiAutocomplete-popper",
  ".MuiMenu-root",
  ".MuiPopover-root",
  ".MuiDialog-root",
  "[role='dialog']",
  "[role='menu']",
  "[role='listbox']",
].join(",");

export function normalizeKeyboardEvent(event: KeyboardLike): NormalizedKey {
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
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
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  if (isEditableElement(target)) return true;
  return !!target.closest(keyboardOwnedSurfaceSelector);
}

export function isKeyboardOwnedOverlayTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest(overlaySurfaceSelector);
}

export function shouldIgnoreContextShortcut(target: EventTarget | null): boolean {
  if (isEditableElement(target)) return true;
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest([
    overlaySurfaceSelector,
    ".xterm",
  ].join(","));
}

export type SequenceMatch = "matched" | "partial" | "none";

export function matchKeySequence(sequence: string[], pressed: string[]): SequenceMatch {
  if (pressed.length > sequence.length) return "none";
  for (let i = 0; i < pressed.length; i += 1) {
    if (sequence[i] !== pressed[i]) return "none";
  }
  return pressed.length === sequence.length ? "matched" : "partial";
}
