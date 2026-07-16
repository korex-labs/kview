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
Dynamic Links, Saved Views, Custom Commands, Custom Actions, Dataplane signal
settings, favourite namespaces, recent namespaces, signal acknowledgements when
available, bounded **Signal memory**, and saved Investigation Snapshots.

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

## Full Profile Backup

Full profile export writes the complete kview user settings profile. This is
useful for backup and restore, but it is broader than a transfer bundle. A full
profile import replaces the current settings profile after confirmation.

## Common Workflows

- Export a transfer bundle with only **Custom Commands** and **Custom Actions**
  to share operator workflows without changing someone else's UI preferences.
- Export **Resource Tags** and favourites when moving investigation context to
  another browser profile.
- Export **Saved Views** to share both resource-list layouts and dashboard
  signal views without changing broader operator settings.
- Export **Signal memory** to preserve bounded distinct observation days during
  profile transfer. Import honours the selected conflict strategy. In Dataplane →
  Signals, **Reset context memory** removes all signal history for the active
  context after confirmation; restore requires an exported transfer bundle.
- Export **Investigation Snapshots** when handing off recurring incident context,
  known-fix notes, or a browser profile used during an incident review.
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
