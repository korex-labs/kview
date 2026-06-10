# Helm

Helm views cover releases and derived chart catalog rows.

## What This View Is For

Use Helm views to inspect release status, chart identity, namespaces, related
Kubernetes resources, and Helm actions when available.

## Helm Releases

Helm Releases are namespaced. Release drawers show status, chart/app versions,
manifest-derived resources, metadata, YAML where available, and actions such as
upgrade or uninstall when permissions allow.

## Helm Charts

Helm Charts are derived from cached release snapshots. Chart rows group release
data by chart name and version so users can see where a chart is deployed
across visible namespaces.

Open a chart and select **Versions** to inspect one chart version at a time.
The version detail shows the exact namespaces and Helm releases using that
version. When release storage is visible, selecting a release also shows the
manifest rendered from the deployed Helm release, which is useful when direct
chart inspection is not available.

If the chart row itself is derived from cached release snapshots, the chart
detail may initially be sparse. Selecting a release can still load the manifest
from that Helm release's namespaced detail view when permissions allow it.

## Optional Behavior

Helm chart catalog data depends on dataplane snapshots. It may be stale,
partial, or unavailable when release secrets are not visible.

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
