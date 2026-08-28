# Import / Export

Import / Export moves kview settings between browser profiles or backs up the
current local profile.

## What This Is For

Use Import / Export when you want to share selected local configuration with
another operator, move settings to another browser profile, or keep a full
backup before changing a profile.

## Transfer Bundles

Transfer bundles are section-based and are the preferred format for sharing
settings with a team. A transfer bundle can include only the sections selected
at export time.

Exportable sections include Smart Filters, Resource Tags, Resource Macros,
Dynamic Links, Saved Views, Custom Commands, Custom Actions, Keyboard Shortcuts,
Dataplane signal settings, favourite namespaces, recent namespaces, signal
acknowledgements when available, bounded **Signal memory**, active-context
**Signal suppressions**, and saved Investigation Snapshots.

When importing a transfer bundle, kview detects the bundle and opens a review
dialog. The dialog shows the available sections, lets you choose which sections
to import, and applies the selected merge strategy.

## Merge Strategies

Merge strategies decide how imported sections interact with local settings:

- **Use imported**: replace matching local data with the imported data.
- **Keep mine**: keep local data when both profiles contain the same item.
- **Replace selected sections**: replace the selected local sections with the imported sections.

For Investigation Snapshots, conflicts are detected by snapshot id when present
and otherwise by context, primary resource, title, and creation time. **Keep
mine** skips matching local snapshots, **Use imported** writes the imported copy,
and **Replace selected sections** removes matching-context local snapshots before
importing the bundle.

Use **Use imported** when you trust the source profile and want to match it.
Use **Keep mine** when you are trying a shared bundle without overwriting local
customizations. Use **Replace selected sections** when the imported bundle should
be the source of truth for the selected sections.

**Keyboard Shortcuts** transfers the selected preset and all explicit action
overrides together. **Keep mine** leaves the local keymap unchanged. **Use
imported** and **Replace selected sections** use the imported keymap. Unknown or
temporarily unavailable Custom Command and Custom Action bindings are retained.

## Signal Suppression Transfer

**Signal suppressions** is an optional, independent transfer section shaped as
`{sourceContext,items}`. Select or deselect it separately from Signal settings,
Signal acknowledgements, Signal memory, and Investigation Snapshots.

`sourceContext` is informational provenance only. Export reads valid active
records from the current context, and import always targets the context active at
import time. The bundle body cannot select another context. Bundle `exportedAt`
is an ISO timestamp; suppression `createdAt`, `updatedAt`, and optional
`expiresAt` values are server-owned Unix seconds. Expiry is not extended during
transfer.

The browser performs structural validation first: supported `snooze` and
`until_changed` modes, v1 fingerprint shape, timestamp and fixed-duration shape,
comments bounded to 2000 Unicode characters, history keys bounded to 1024 Unicode
characters, and at most 10,000
deterministically selected records. The backend then validates active/expiry
semantics and skips malformed, unsupported, or expired records. Invalid records
never hide a visible signal.

The normal strategies use their literal API values:

- `keepMine` keeps an active-context record when the same `historyKey` exists.
- `useImported` overwrites conflicts and retains unrelated local records.
- `replaceSections` makes the imported section authoritative, removing local
  active-context keys absent from the import as well as replacing conflicts.

The result reports **imported**, **skipped**, and **replaced** counts. After a
successful import, review the active suppressed-signals section and choose
**Show now** for any imported decision that should not remain active. Runtime
suppressions are not included in profiles, global/context overrides, or full
profile backup; use this explicit section.

See [Dashboard And Signals](dashboard-and-signals.md#snooze-and-ignore-until-changed),
[Settings](settings.md#runtime-signal-suppressions), and the engineering
[API ownership contract](../API_READ_OWNERSHIP.md#4-local-operator-knowledge-reads).

## Full Profile Backup

Full profile export writes the complete kview user settings profile. This is
useful for backup and restore, but it is broader than a transfer bundle. A full
profile import replaces the current settings profile after confirmation.

## Common Workflows

- Export a transfer bundle with only **Custom Commands** and **Custom Actions**
  to share operator workflows without changing someone else's UI preferences.
- Include **Keyboard Shortcuts** when the shared workflow also depends on a
  preset or custom bindings.
- Export **Resource Tags** and favourites when moving investigation context to
  another browser profile.
- Export **Saved Views** to share both resource-list layouts and dashboard
  signal views without changing broader operator settings.
- Export **Signal memory** to preserve bounded distinct observation days during
  profile transfer. Import honours the selected conflict strategy. In Dataplane →
  Signals, **Reset context memory** removes all signal history for the active
  context after confirmation; restore requires an exported transfer bundle.
- Export **Signal suppressions** to hand off only current runtime triage
  decisions. The source context label does not retarget import; select the
  destination context before importing.
- Export **Investigation Snapshots** when handing off recurring incident context,
  known-fix notes, or a browser profile used during an incident review. New
  snapshots include the structured investigation result as well as the complete
  Markdown report so the standard investigation dialog can replay the saved view.
- Export **Resource Macros** and **Dynamic Links** to share external-link
  templates without changing someone else's local UI preferences.
- Export a full profile before testing broad Dataplane or signal changes.
- Review transfer bundle sections before importing and select only the parts
  you expect to change.

## Permission And Data Notes

Import / Export changes local kview settings and local operator knowledge only.
It does not write to Kubernetes resources. Investigation Snapshot import/export
uses kview's local snapshot store; imported snapshots can appear in resource
Notes, Search, and Activity, but they are never written as Kubernetes
annotations or labels. Imported Custom Commands and Custom Actions can later
trigger Kubernetes API calls or container exec sessions only when a user runs
them and RBAC allows the operation.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Resource Macros And Dynamic Links**
- **Custom Commands**
- **Custom Actions**
- **Dataplane**
