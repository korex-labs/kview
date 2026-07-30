import type { KeyboardActionScope, KeySequence } from "./actions";
import { canonicalizeKeyChord } from "./keyboardUtils";

export type ValidatableKeyboardAction = {
  id: string;
  label: string;
  scopes: KeyboardActionScope[];
  bindings: KeySequence[];
  maxSequenceLength?: number;
};

export type KeymapDiagnosticCode =
  | "malformed-binding"
  | "duplicate-binding"
  | "exact-collision"
  | "prefix-collision"
  | "browser-reserved";

export type KeymapDiagnostic = {
  code: KeymapDiagnosticCode;
  severity: "error" | "warning";
  message: string;
  actionId: string;
  conflictingActionId?: string;
  binding: KeySequence;
};

const browserReserved = new Set([
  "ctrl+l", "meta+l", "ctrl+t", "meta+t", "ctrl+n", "meta+n", "ctrl+w", "meta+w",
  "ctrl+r", "meta+r", "ctrl+f", "meta+f", "ctrl+s", "meta+s", "ctrl+p", "meta+p", "ctrl+k", "meta+q",
]);

export function isValidKeyChord(chord: string): boolean {
  return canonicalizeKeyChord(chord) !== null;
}

function sequenceKey(sequence: KeySequence): string {
  return sequence.join(" ");
}

function isPrefix(left: KeySequence, right: KeySequence): boolean {
  return left.length < right.length && left.every((part, index) => part === right[index]);
}

export function keyboardScopesCanOverlap(left: KeyboardActionScope[], right: KeyboardActionScope[]): boolean {
  if (left.some((scope) => right.includes(scope))) return true;
  return (left.includes("pod-drawer") && right.includes("drawer"))
    || (left.includes("drawer") && right.includes("pod-drawer"));
}

export function validateKeymap(actions: readonly ValidatableKeyboardAction[]): KeymapDiagnostic[] {
  const diagnostics: KeymapDiagnostic[] = [];
  const validBindings = new Map<ValidatableKeyboardAction, KeySequence[]>();

  for (const action of actions) {
    const seen = new Set<string>();
    const valid: KeySequence[] = [];
    for (const binding of action.bindings) {
      if (action.maxSequenceLength !== undefined && binding.length > action.maxSequenceLength) {
        diagnostics.push({
          code: "malformed-binding",
          severity: "error",
          message: `${action.label} accepts at most ${action.maxSequenceLength} chord${action.maxSequenceLength === 1 ? "" : "s"}.`,
          actionId: action.id,
          binding: [...binding],
        });
        continue;
      }
      const canonical = binding.map(canonicalizeKeyChord);
      if (!binding.length || canonical.some((chord) => chord === null)) {
        diagnostics.push({
          code: "malformed-binding",
          severity: "error",
          message: `Malformed binding “${sequenceKey(binding)}” for ${action.label}.`,
          actionId: action.id,
          binding: [...binding],
        });
        continue;
      }
      const normalizedBinding = canonical as string[];
      const key = sequenceKey(normalizedBinding);
      if (seen.has(key)) {
        diagnostics.push({
          code: "duplicate-binding",
          severity: "error",
          message: `Duplicate binding “${key}” for ${action.label}.`,
          actionId: action.id,
          binding: [...normalizedBinding],
        });
        continue;
      }
      seen.add(key);
      valid.push(normalizedBinding);
      if (browserReserved.has(normalizedBinding[0])) {
        diagnostics.push({
          code: "browser-reserved",
          severity: "warning",
          message: `“${normalizedBinding[0]}” is commonly reserved by browsers.`,
          actionId: action.id,
          binding: [...normalizedBinding],
        });
      }
    }
    for (let leftIndex = 0; leftIndex < valid.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < valid.length; rightIndex += 1) {
        if (!isPrefix(valid[leftIndex], valid[rightIndex]) && !isPrefix(valid[rightIndex], valid[leftIndex])) continue;
        const prefix = valid[leftIndex].length < valid[rightIndex].length ? valid[leftIndex] : valid[rightIndex];
        diagnostics.push({
          code: "prefix-collision",
          severity: "error",
          message: `“${sequenceKey(prefix)}” is a prefix of another binding for ${action.label}.`,
          actionId: action.id,
          binding: [...prefix],
        });
      }
    }
    validBindings.set(action, valid);
  }

  for (let leftIndex = 0; leftIndex < actions.length; leftIndex += 1) {
    const left = actions[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < actions.length; rightIndex += 1) {
      const right = actions[rightIndex];
      if (!keyboardScopesCanOverlap(left.scopes, right.scopes)) continue;
      for (const leftBinding of validBindings.get(left) ?? []) {
        for (const rightBinding of validBindings.get(right) ?? []) {
          const exact = sequenceKey(leftBinding) === sequenceKey(rightBinding);
          const prefix = isPrefix(leftBinding, rightBinding) || isPrefix(rightBinding, leftBinding);
          if (!exact && !prefix) continue;
          const binding = exact || leftBinding.length < rightBinding.length ? leftBinding : rightBinding;
          diagnostics.push({
            code: exact ? "exact-collision" : "prefix-collision",
            severity: "error",
            message: exact
              ? `“${sequenceKey(binding)}” is assigned to both ${left.label} and ${right.label}.`
              : `“${sequenceKey(binding)}” is a prefix of another binding shared by ${left.label} and ${right.label}.`,
            actionId: left.id,
            conflictingActionId: right.id,
            binding: [...binding],
          });
        }
      }
    }
  }
  return diagnostics;
}
