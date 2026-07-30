# Keyboard Shortcuts

kview provides configurable keyboard shortcuts for navigation, resource tables,
drawers, Custom Commands, and Custom Actions. Runtime dispatch, **Keyboard**
Settings, and <kbd>?</kbd> Help use the same effective keymap.

## What This Is For

Use keyboard presets for a familiar starting point, then remap individual
actions to fit your browser, keyboard layout, and operator workflow.

## Presets

Choose a starting point in **Settings → Keyboard**:

- **Kview Classic** preserves the familiar kview navigation and table controls.
- **Vim / k9s** emphasizes home-row movement and resource navigation sequences.
- **Browser Safe** uses modifier-first global shortcuts to reduce browser
  conflicts.

Changing presets keeps your per-action overrides. Reset an action to inherit its
current preset again.

## Editing Bindings

The searchable action catalog is split into tabs such as **Global**,
**Navigation**, **Table**, and **Drawer**, with additional tabs for other action
groups and configured Custom Commands or Custom Actions. Each row shows the
action's stable ID, safety classification, source, and effective bindings.
Long tabs use the same standard pagination controls as resource tables.

- An action can have multiple bindings.
- A binding may contain one to four chords.
- **Add binding** starts the recorder.
- <kbd>Backspace</kbd> removes the most recently recorded chord.
- <kbd>Enter</kbd> saves the recorded sequence.
- <kbd>Escape</kbd> cancels recording.
- **Disable** stores an explicit empty binding for that action.
- **Reset** removes the override and restores the preset binding. Custom
  definitions return to **Unbound** because they have no preset binding.
- **Restore preset defaults** removes overrides for built-in actions and restores
  the selected preset. It preserves Custom Command, Custom Action, and
  unavailable-definition bindings.

Changes remain local to the editor until **Apply keyboard changes** is selected.
**Cancel keyboard changes** discards the draft. Both buttons are enabled only
while the editor contains unsaved changes; Apply also remains disabled while a
blocking conflict exists.

## Validation

kview blocks **Apply keyboard changes** when the effective keymap contains an
invalid sequence, duplicate binding, exact collision, or ambiguous prefix.
Warnings identify browser-reserved shortcuts but do not block Apply.
This includes <kbd>Ctrl+K</kbd>, which some browsers or extensions reserve.
The **Keyboard attention** panel lists every conflict or warning, including the
binding, affected action names, and stable IDs. The same diagnostic is also shown
on each affected action row.

Bindings use semantic keys. For example, use <kbd>Shift+!</kbd> rather than a
layout-dependent <kbd>Shift+1</kbd>. The plus key is shown as `plus`.

## Context And Focus

Global shortcuts are suppressed while an input, editor, terminal, menu, dialog,
or another keyboard-owning overlay has focus. Drawer actions take precedence
while a resource drawer is active. <kbd>Escape</kbd> remains owned by the topmost
active surface.

Press <kbd>?</kbd> to see current effective shortcuts. **Current Resource** is
shown only for bound actions registered by the active drawer or resource.
Unavailable actions with a binding may appear disabled.

## Custom Commands And Actions

Configured Custom Commands and Custom Actions appear in the Keyboard catalog
with stable IDs such as `custom-command.inspect` and
`custom-action.restart-api`. They start **Unbound**.

A shortcut does not bypass the normal workflow:

- Custom Commands are available only for matching actionable Pod containers.
  If several containers match, kview asks which container to use.
- Custom Actions are available only for matching resources and remain subject to
  capability and RBAC checks.
- Safe operations use normal confirmation. Dangerous operations retain typed
  confirmation.
- Runtime parameters, output handling, target validation, and success handling
  are identical to invoking the action from its visible menu.

Disabled or deleted definitions cannot run. Their saved keyboard override is
retained so temporarily unavailable definitions can be restored without losing
the binding.

## Import And Profiles

The selected preset and overrides are part of User Settings and Operator
Profiles. **Keyboard Shortcuts** can also be selected explicitly in a transfer
bundle. Import and export preserve unknown or temporarily unavailable dynamic
action IDs. Imported duplicate definition IDs are normalized with a deterministic
first-definition-wins policy. If persisted or imported enabled actions collide,
kview fails safe by explicitly disabling every action involved; disabled or
deleted definitions do not participate in collision checks.

## Related Settings

- **Keyboard**
- **Custom Commands**
- **Custom Actions**
- **Operator Profiles**
- **Import / Export**
