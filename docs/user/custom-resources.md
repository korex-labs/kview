# Custom Resources

Custom Resource views help inspect CRDs and custom resources without
kview-specific code for every custom kind.

## What This View Is For

Use Custom Resources when a cluster contains operators or platform APIs that
create non-core Kubernetes resource kinds.

Custom resources live under **Extensions** in the sidebar because they are
discovered through Kubernetes API extensions rather than the built-in workload,
configuration, storage, or policy APIs.

## Resource Views

- **Custom Resource Definitions**: cluster-scoped CRD definitions.
- **Custom Namespace Resources**: namespaced custom resources discovered from
  visible CRDs.
- **Custom Cluster Resources**: cluster-scoped custom resources discovered from
  visible CRDs.

## Main Controls

Custom resource lists support filtering and drawer inspection like other
resource lists. Drawers emphasize metadata, status, events where available, and
YAML.

Custom resource drawers also support:

- **Actions**: delete a custom resource instance when RBAC allows it.
- **Tags**: view and edit kview resource tags from the drawer header.
- **Macros**: assign resource macros for custom-resource scopes.
- **Dynamic links**: use labels and annotations in drawer link templates.
- **YAML**: inspect, edit, and apply full custom-resource YAML.

## Common Workflows

- Open CRDs to understand available custom kinds.
- Use namespace or cluster custom resource views to inspect instances.
- Filter by kind, name, namespace, or tag.
- Tag important custom resources so they are easier to find across list views.
- Use macros or dynamic links for operator-specific dashboards, logs, or runbooks.
- Use YAML for full custom-resource state when no specialized panel exists.

## Permission And Data Notes

Custom resource discovery depends on access to CRDs and the custom resource
endpoints. Some CRDs may be visible while their instances are not, or vice
versa, depending on RBAC.

## Related Settings

- **Resource Tags**
- **Dataplane**
