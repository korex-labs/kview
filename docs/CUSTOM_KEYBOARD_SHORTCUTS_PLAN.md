# Custom Keyboard Shortcuts Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan in coherent tranches with spec and quality review after each tranche.

**Goal:** Provide a complete, scope-aware Action Registry and configurable Keymaps, including bindable Custom Commands and Custom Actions without bypassing existing confirmation, RBAC, or mutation safety workflows.

**Architecture:** Separate stable action definitions, runtime handlers, and persisted keymaps. Compile built-in defaults, the selected preset, user overrides, active UI scope, and currently available handlers into one effective registry used by keyboard dispatch, Settings, Help, and command suggestions. Preserve existing behavior through normalization/migration and apply keymap changes atomically only after validation.

**Tech Stack:** React, TypeScript, MUI, Vitest/Testing Library, existing local user-settings/operator-profile storage, Docker-backed Make verification.

---

## Product Decisions

- Use stable typed action IDs rather than free-form command strings.
- A keymap preset is distinct from an Operator Profile. Operator Profiles snapshot the selected preset and overrides with the rest of the operator settings.
- Initial presets:
  - `kview-classic`: current `g …`, `/`, `:`, `Ctrl+K`, activity, table, Vim, and home-row behavior;
  - `vim-k9s`: navigation-oriented bindings with Vim table movement and `g …` sequences;
  - `browser-safe`: modifier-first bindings and no single-letter global bindings.
- An omitted override inherits from the selected preset; a non-empty binding list replaces inherited bindings; an empty list disables the action; Reset deletes the override.
- Exact collisions and prefix collisions in simultaneously active scopes are errors. Collisions across mutually exclusive scopes are allowed. Browser/OS-reserved combinations are warnings.
- Editable controls, MUI overlays, dialogs, and terminal surfaces retain their current ownership rules. Shortcut customization must not break normal typing or terminal input.
- Dangerous Custom Commands/Actions always open their existing confirmation workflow. Keyboard execution never invokes mutation APIs directly and never bypasses RBAC/capability checks.
- Help and Settings display the compiled effective registry, not raw defaults or unvalidated settings.

## Target Model

```ts
type KeyboardScopeKind = "app" | "list" | "drawer" | "dialog" | "settings" | "terminal";

type KeyboardActionDefinition = {
  id: KeyboardActionId;
  label: string;
  group: KeyboardActionGroup;
  scopes: KeyboardScopeKind[];
  defaultBindings: Record<KeyboardPresetId, KeySequence[]>;
  customizable: boolean;
  safety: "safe" | "confirm" | "dangerous";
};

type KeyboardSettings = {
  preset: KeyboardPresetId;
  overrides: Record<string, KeySequence[]>;
};
```

Runtime registration supplies `run`, `enabled`, and optional unavailable reason for an action ID. The compiled registry retains origin, effective bindings, active scope, availability, conflict diagnostics, and safety metadata.

## Action Inventory Contract

### Application and navigation

- Help, search, command mode, Settings.
- Dashboard and every resource section generated from the authoritative section/resource descriptor list.
- Context and namespace command entry.
- Activity panel toggle and Activities, Work, Terminals, Port Forwards, and Logs tabs.

### Resource lists

- Focus filter and grid, row/cell movement, previous/next page, open selected row, and refresh where available.
- Existing grid-local arrow semantics remain available even when optional Vim/home-row aliases are disabled.

### Drawers

- Close/back and stable semantic tab IDs.
- Refresh, YAML, edit/patch, and resource-specific actions.
- Replace DOM-label-derived action IDs with semantic IDs; UI labels remain presentation only.

### Custom definitions

- `custom-command.<definition-id>` actions are registered only where a matching Pod/container target is available and execute through the existing Pod command mutation dialog/result workflow.
- `custom-action.<definition-id>` actions are registered only for matching resources and execute through the existing mutation dialog, including typed confirmation for dangerous definitions and capability-derived disabled states.
- Disabled or deleted definitions leave imported bindings harmlessly unavailable; they do not execute another action with a reused label.

---

## Tranche 1: Registry, Keymap Compiler, Migration, and Validation

**Files:**

- Create: `ui/src/keyboard/actions.ts`
- Create: `ui/src/keyboard/keymaps.ts`
- Create: `ui/src/keyboard/keymapValidation.ts`
- Create tests beside each new module.
- Modify: `ui/src/settings.ts`
- Modify: `ui/src/settings.test.ts`
- Modify: `ui/src/keyboard/shortcuts.ts`
- Modify: `ui/src/keyboard/KeyboardProvider.tsx`
- Modify: `ui/src/keyboard/KeyboardProvider.test.tsx`
- Modify: `ui/src/keyboard/help.ts`
- Modify: `ui/src/keyboard/help.test.ts`

**Steps:**

1. Add failing tests for preset compilation, overrides, disabled bindings, exact conflicts, prefix conflicts, mutually exclusive scopes, and invalid imported bindings.
2. Define action/preset/binding types and the built-in action catalog.
3. Implement deterministic keymap compilation and validation.
4. Change `KeyboardSettings` to `preset + overrides`; normalize legacy boolean settings into behavior-equivalent overrides/preset state during parsing.
5. Preserve operator-profile snapshot normalization and existing stored user settings.
6. Replace the provider command switch with action handler registration/dispatch while preserving sequence timeout, focus scopes, input suppression, Escape ownership, and focus retry behavior.
7. Make Help consume compiled actions and active contextual handlers.
8. Run targeted keyboard/settings tests and UI typecheck.

## Tranche 2: Settings Editor, Presets, and Discoverability

**Files:**

- Create: `ui/src/components/settings/KeyboardSettingsEditor.tsx`
- Create: `ui/src/components/settings/KeyboardSettingsEditor.test.tsx`
- Modify: `ui/src/components/settings/SettingsView.tsx`
- Modify keyboard Help dialog/components as needed.

**Steps:**

1. Add failing component tests for preset switching, recording a chord, replacing/removing/disabling/resetting bindings, and blocked Apply on errors.
2. Add a searchable grouped action table showing action, scope, effective binding, source, availability, and conflict state.
3. Add a keyboard recorder that captures normalized `KeyboardEvent.key` bindings using the same normalization as dispatch.
4. Provide per-action Reset, reset-all, and preset switching with a clear overrides warning.
5. Show exact/prefix conflicts as errors and browser-reserved combinations as warnings before applying.
6. Update `?` Help to show effective bindings and active contextual availability.
7. Run targeted Settings/keyboard tests and typecheck.

## Tranche 3: Complete Built-In Action Inventory

**Files:**

- Modify: `ui/src/keyboard/commands.ts`
- Modify: `ui/src/components/search/GlobalSearchInput.tsx`
- Modify: `ui/src/components/shared/ResourceListPage.tsx`
- Modify: `ui/src/components/shared/ResourceDrawerShell.tsx`
- Modify: `ui/src/components/resources/pods/PodDrawer.tsx`
- Modify activity panel/event wiring and focused tests as required.

**Steps:**

1. Generate navigation actions from the authoritative resource/section descriptors so every section is covered automatically.
2. Register list actions through stable action IDs and runtime handlers.
3. Register activity actions through stable IDs instead of provider-specific event switch cases.
4. Replace drawer tab label IDs and DOM-text action discovery with semantic action registration at shared component boundaries.
5. Keep command mode and keyboard shortcuts on the same action definitions and execution path.
6. Add tests for representative global, list, drawer, modal suppression, activity, and command-mode execution paths.

## Tranche 4: Bindable Custom Commands and Custom Actions

**Files:**

- Modify: `ui/src/components/resources/pods/PodDrawer.tsx`
- Modify: `ui/src/components/mutations/ResourceActions.tsx`
- Extract shared execution callbacks/hooks if necessary rather than duplicating dialog descriptors.
- Add focused tests for custom action registration and safety behavior.

**Steps:**

1. Extract the existing Custom Command dialog execution path into a reusable callback registered under `custom-command.<id>`.
2. Define target-selection behavior: if one matching container exists, use it; if several exist, open the existing selection/menu workflow instead of guessing.
3. Register matching enabled Custom Actions under `custom-action.<id>` using the same callback used by menu clicks.
4. Prove safe actions still confirm normally, dangerous actions still require typed confirmation, unavailable/RBAC-denied actions do not execute, and disabled/deleted definitions remain unavailable.
5. Include dynamic action definitions in Settings search and effective Help only when their current scope/target is applicable; retain configured bindings in profiles when temporarily unavailable.

## Tranche 5: Transfer, Documentation, and Verification

**Files:**

- Modify settings transfer/profile tests and UI where needed.
- Create: `docs/user/keyboard-shortcuts.md`
- Modify: `docs/user/manifest.json`
- Modify: `docs/KEYBOARD_FOCUS.md`
- Modify: `docs/ROADMAP.md`

**Steps:**

1. Verify full settings and Operator Profiles preserve preset and overrides. Add an explicit keyboard transfer section only if current full-profile/settings transfer does not already cover it.
2. Document presets, recording bindings, conflicts, reset/disable behavior, scopes, and Custom Command/Action safety.
3. Update the engineering ownership contract and roadmap status.
4. Run focused Vitest suites and typecheck.
5. Run `make check DOCKER_BUILD=0` once.
6. Run `make build DOCKER_BUILD=0` once.
7. Run `git diff --check` and inspect the final diff for secrets/generated artifacts.
8. Perform spec-compliance and code-quality reviews; fix all critical/important findings.
9. Leave the verified worktree uncommitted until explicit approval.

## Acceptance Criteria

- Existing stored settings load without losing current keyboard behavior.
- Every built-in user-intent action in the agreed inventory has a stable ID and effective binding metadata even if unbound.
- Users can select a preset, add multiple bindings/chords, replace, disable, and reset bindings from Settings.
- Conflicts are deterministic and visible before Apply.
- `?` Help, Settings, keyboard dispatch, and command mode use the same effective action registry.
- Global shortcuts remain suppressed in editable, overlay, dialog, settings, and terminal contexts according to current ownership rules.
- Custom Commands and Custom Actions can be mapped but retain target selection, confirmation, dangerous typed confirmation, and RBAC/capability enforcement.
- Operator Profiles and settings transfer preserve keymaps.
- Targeted tests, full check, and production build pass.
