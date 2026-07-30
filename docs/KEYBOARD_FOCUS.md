# Keyboard And Focus Ownership

This document defines how kview surfaces should register keyboard shortcuts,
Escape handling, and focus restoration.

## Ownership Model

`KeyboardProvider` is the application-owned keyboard registry. App-level
shortcuts, contextual shortcuts, active focus scopes, Escape ownership, shortcut
help metadata, and focus retry requests should go through this provider.

Built-in actions have stable IDs and typed definitions in the Action Registry.
Preset bindings and user overrides compile into one effective keymap used by
runtime dispatch, Settings, and Help. Keep action definitions, preset bindings,
and runtime handlers separate. Never derive persisted IDs from visible labels.

Use direct component `onKeyDown` handlers only for input-local behavior, for
example submitting a dialog text field on <kbd>Enter</kbd> or clearing a text
input on <kbd>Escape</kbd>. Do not add direct `window` keydown listeners for
app shortcuts.

## Focus Scopes

Register a focus scope with `useKeyboardScope` when a surface should change
which shortcuts are active.

Common scopes:

- `drawer`: suppresses global shortcuts while a resource drawer is active.
- `dialog`: suppresses global and contextual shortcuts for modal workflows.
- `settings`: owns Settings Escape behavior and suppresses app shortcuts.
- `terminal`: reserved for xterm-like surfaces that need raw keyboard input.

Only the top active scope should own Escape. Nested MUI dialogs, menus,
popovers, autocompletes, and listboxes are treated as keyboard-owned overlays;
Escape from those targets is left to the overlay.

## Contextual Actions

Register drawer- or view-local shortcuts with `useContextualKeyboardActions`.
Actions must be memoized by the caller so registration is stable.

Contextual actions should describe visible controls or actions in the current
surface. Avoid registering generic app behavior such as navigation or search
from a component; those belong in `shortcutCommands`.

Known built-in contextual IDs receive bindings from the compiled effective
keymap. Dynamic IDs use the `custom-command.<definition-id>` and
`custom-action.<definition-id>` namespaces and have no default binding. A
contextual handler must call the same execution callback as its visible control;
it must not bypass availability, RBAC, confirmation, target selection, or output
handling.

When an action can target more than one resource or container, capture and
validate the complete target identity, including Kubernetes context, before
executing a selection made in a later render.

## Table Controls

Resource lists should register table behavior with `useTableKeyboardControls`.
The provider owns the global bindings for table filter focus, grid focus,
pagination, and opening the selected row. List components own the actual grid
implementation details.

## Focus Restoration

Use `requestKeyboardFocus` for app-owned focus restoration. It retries focus
after render and layout so callers do not need scattered `requestAnimationFrame`
and `setTimeout` chains.

Good uses:

- returning focus to a table after closing a drawer
- focusing the global search input after a shortcut
- focusing a drawer shell after it opens
- focusing an active terminal session

Avoid using it for browser-native focus changes inside a single input control.

## New Surface Checklist

- Register a `useKeyboardScope` if the surface is modal, drawer-like, terminal,
  or should suppress global shortcuts.
- Register `useContextualKeyboardActions` for visible local actions only.
- Use `requestKeyboardFocus` for focus that depends on rendering or layout.
- Keep input-local <kbd>Enter</kbd> and <kbd>Escape</kbd> handling local.
- Add tests when a surface owns Escape, suppresses shortcuts, or restores focus.
