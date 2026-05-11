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

## Optional Behavior

Helm chart catalog data depends on dataplane snapshots. It may be stale,
partial, or unavailable when release secrets are not visible.

## Common Workflows

- Filter releases by chart, namespace, status, or tag.
- Open a stale or failed release from Dashboard signals.
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
