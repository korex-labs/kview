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
Dynamic Links, Custom Commands, Custom Actions, Dataplane settings, favourite
namespaces, recent namespaces, and signal acknowledgements when available.

When importing a transfer bundle, kview detects the bundle and opens a review
dialog. The dialog shows the available sections, lets you choose which sections
to import, and applies the selected merge strategy.

## Merge Strategies

Merge strategies decide how imported sections interact with local settings:

- **Use imported**: replace matching local data with the imported data.
- **Keep mine**: keep local data when both profiles contain the same item.
- **Merge**: combine compatible data where possible.

Use **Use imported** when you trust the source profile and want to match it.
Use **Keep mine** when you are trying a shared bundle without overwriting local
customizations. Use **Merge** when both profiles contain useful definitions.

## Full Profile Backup

Full profile export writes the complete kview user settings profile. This is
useful for backup and restore, but it is broader than a transfer bundle. A full
profile import replaces the current settings profile after confirmation.

## Common Workflows

- Export a transfer bundle with only **Custom Commands** and **Custom Actions**
  to share operator workflows without changing someone else's UI preferences.
- Export **Resource Tags** and favourites when moving investigation context to
  another browser profile.
- Export **Resource Macros** and **Dynamic Links** to share external-link
  templates without changing someone else's local UI preferences.
- Export a full profile before testing broad Dataplane or signal changes.
- Review transfer bundle sections before importing and select only the parts
  you expect to change.

## Permission And Data Notes

Import / Export changes local kview settings only. It does not write to
Kubernetes resources. Imported Custom Commands and Custom Actions can later
trigger Kubernetes API calls or container exec sessions only when a user runs
them and RBAC allows the operation.

## Related Settings

- **Smart Filters**
- **Resource Tags**
- **Resource Macros And Dynamic Links**
- **Custom Commands**
- **Custom Actions**
- **Dataplane**
