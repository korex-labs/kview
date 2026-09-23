# Helm

Helm views cover releases and derived chart catalog rows.

## What This View Is For

Use Helm views to inspect release status, chart identity, namespaces, related
Kubernetes resources, and Helm actions when available.

## Helm Releases

Helm Releases are namespaced. Release drawers show status, chart/app versions,
manifest-derived resources, metadata, YAML where available, and actions such as
upgrade or uninstall when permissions allow.

All sections share one tab row. **Release Notes** contains chart-rendered Helm
notes; **Notes** contains kview's local operator notes. **Recovery** is a separate
tab, not a panel above the tab row, so it does not displace normal release details.

## Recovery

Open a release drawer's **Recovery** tab and choose **Preview recovery** to
inspect fresh recovery metadata. Opening Overview does not fetch recovery data.
The preview shows the latest revision, status, description, and actual storage
Secret, plus the preceding retained revision when available. The Secret link
opens the usual Secret drawer; it does not delete or export the record.

A `pending` status does not prove that an operation is abandoned. Check Helm,
GitOps, and CI activity and stop competing writers before considering recovery.
Do not use the age of a release as proof that deletion is safe.

### Prefer Normal Helm Actions

- For a `failed` release, inspect the failure and consider **Rollback** from
  **History** or **Reinstall**, rather than deleting history.
- The existing rollback action waits for the operation and disables hooks.
- Reinstall normally uses the stored chart and values through Helm upgrade;
  hooks may run. If the stored chart has no templates, the existing fallback
  reapplies the stored manifest instead and does not create a Helm revision.
- These actions can change Kubernetes resources. They are not equivalent to
  deleting a Helm storage record.

### Guarded Revision-Record Deletion

The recovery deletion is an explicit break-glass operation. It deletes **only
one latest Helm revision Secret**. It does not roll back resources, uninstall the
release, undo hooks, or automatically retry an operation.

Eligibility is conservative:

- Only latest `pending-upgrade` and `pending-rollback` records are candidates.
- Revision 1, `pending-install`, ordinary `failed` or `deployed` states, and
  missing or unusable preceding history are excluded.
- The immediately preceding retained revision must be `deployed` or
  `superseded` with usable stored chart and manifest data. Recovery never skips
  an intervening unsuitable record or deletes a chain of revisions.
- Ambiguous or corrupt storage identity, insufficient permissions, and
  read-only mode prevent deletion.

Review the exact namespace, release, revision, and Secret. The confirmation
requires the displayed phrase and acknowledgement that competing Helm/CI
writers have stopped. The server rechecks fresh history and permissions and
uses both the Secret UID and resourceVersion as deletion preconditions. If the
record changed, load a new preview and confirm again; do not blindly retry the
old request.

These checks cannot lock out external Helm or GitOps writers. Stopping them is
an operator responsibility even after a successful preview. After deletion,
inspect release history and actual resources before choosing rollback or retry.

No Secret backup or export is created by recovery. Helm storage contains chart
and values data that may include credentials; treat any manual export as
sensitive.

## Helm Charts

Helm Charts first reads visible Helm release storage directly. If that catalog
read fails and cached release snapshots are available, kview can show explicitly
marked derived rows instead. Chart rows group release data by chart name and
version so users can see where a chart is deployed across visible namespaces. When Resource Tags are enabled, chart list rows keep
the chart name first and show tags next to it like other resource lists.

Open a chart and select **Versions** to inspect one chart version at a time.
The version detail shows the exact namespaces and Helm releases using that
version. When release storage is visible, selecting a release also shows the
manifest rendered from the deployed Helm release, which is useful when direct
chart inspection is not available.

If the chart row itself is derived from cached release snapshots, the chart
detail may initially be sparse. Selecting a release can still load the manifest
from that Helm release's namespaced detail view when permissions allow it.

## Optional Behavior

The derived Helm chart fallback depends on dataplane snapshots and may be stale
or partial. Catalog data can be unavailable when release Secrets are not
visible and no usable cached fallback exists.

## Common Workflows

- Filter releases by chart, namespace, status, or tag.
- Open a stale or failed release from Dashboard signals.
- Open a chart version to compare where it is deployed and review the
  release-backed manifest for a selected release.
- Inspect manifest resources to jump from Helm to the underlying Kubernetes
  objects.
- Review release status and related resources before uninstalling or upgrading.

## Permission And Data Notes

Helm data is usually read from Kubernetes Secrets. If the active account cannot
read those secrets, Helm views may be empty or partial. Helm mutations depend on
the configured action and Kubernetes permissions.

## Related Settings

- **Dataplane**
- **Resource Tags**
- **Actions And Safety**
