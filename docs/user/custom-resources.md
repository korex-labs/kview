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

## Signals And Warnings

Generic health summaries interpret recognized conditions, not every boolean in
an operator's status. Positive conditions include `Ready`, `Available`, and
`Healthy`; negative conditions include `Degraded`, `Failed`, and `Stalled`.
Current failure evidence takes precedence over readiness. `Degraded=False`
alone does not prove that a resource is healthy.

An unrecognized-only condition set or stale readiness evidence produces
**Unknown** rather than invented readiness; current failure evidence still wins. For resources with a metadata generation, missing
observed-generation evidence also produces **Unknown**. Condition-level
`observedGeneration` takes precedence over the status-level value. Older objects
without a generation may use recognized phase values as a fallback.

Raw condition values in the drawer remain neutral: `True` is not universally
good, and `False` is not universally bad. Inspect condition reasons, messages,
and YAML for operator-specific meaning.

## Permission And Data Notes

Custom resource discovery depends on access to CRDs and the custom resource
endpoints. Some CRDs may be visible while their instances are not, or vice
versa, depending on RBAC.

If listing CRDs is forbidden, the namespace and cluster instance views can use
API discovery plus permission to read individual CRDs. Only types confirmed by
an exact CRD read are listed, using a served version and the same credentials.
Namespaced discovery stays within the selected namespace. Aggregated APIs are
not assumed to be CRDs.

This fallback is bounded and incomplete: it considers preferred API versions,
limits metadata probes, and reports partial coverage even when all confirmed
types are readable. If individual CRD reads are also denied, an empty result
does not prove that no custom resources exist. The CRD list and group/kind
resolve endpoint still require CRD-list access.

## Related Settings

- **Resource Tags**
- **Dataplane**
