# User Documentation Contract

This contract applies to markdown files in `docs/user/`. These files are the
canonical source for in-app Help and future website/user documentation.

## Audience

Write for kview users operating Kubernetes clusters. Assume the reader knows
basic Kubernetes terms, but do not assume they already know where kview exposes
a feature or how optional behavior changes the UI.

## Accuracy Rules

- Document current behavior only.
- Use the visible UI labels from the app when naming settings, tabs, buttons,
  columns, panels, and actions.
- State whether behavior is default, optional, enabled by default, disabled by
  default, permission-dependent, or data-dependent.
- For optional settings, describe exactly what changes when enabled and what
  remains available when disabled.
- Do not describe internal settings fields unless the user can observe or
  change the behavior in the UI.
- Avoid broad claims such as "controls everything" or "all resources" unless
  verified from the implementation.

## Page Structure

Use this structure when it fits the page:

```markdown
# Page Title

Short purpose paragraph.

## What This Is For

## Main Controls

## Optional Behavior

## Common Workflows

## Permission And Data Notes

## Related Settings
```

Small pages may omit sections that do not apply, but keep headings predictable
and task-oriented. Resource-specific pages should prefer:

```markdown
# Resource Name

## What This View Is For

## List Columns And Filters

## Drawer Tabs

## Actions

## Signals And Warnings

## Permission And Data Notes
```

## Formatting

- Keep paragraphs short.
- Use bullets for lists of controls, tabs, settings, or behaviors.
- Use `**Visible UI Label**` for setting names, tab names, button labels, and
  important on-screen labels.
- Use `<kbd>Key</kbd>` for keyboard shortcuts, including sequences such as
  `<kbd>g p</kbd>`.
- Use backticks for commands, file paths, literal filter syntax, API-ish names,
  and examples such as `tag:prod`.
- Prefer active, specific wording: "When enabled, kview shows..." instead of
  "This can be used to...".
- Keep line wrapping readable in source. Wrapped bullet continuation lines must
  be indented by two spaces so in-app Help renders them as one bullet.

## Manifest Rules

When adding, renaming, or removing a user-doc page:

- update `docs/user/manifest.json`
- choose a stable `id`
- set the same title as the page `# H1`
- choose the correct category
- include `"app"` in `surfaces` only for pages useful inside the product

## What Not To Include In App Help

Keep these outside in-app Help unless they directly help users operate kview:

- internal architecture details
- AI agent instructions
- contributor workflow
- release engineering internals
- route ownership maps
- implementation-only settings names
