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

## List Columns And Filters

The aggregate namespace and cluster views remain the cross-kind entry points.
Click a live API row's **Kind** chip to browse that exact kind and version; click
its name/row to inspect the object. Manifest-only or unresolved kinds do not offer
per-kind navigation. From the CRD list, open a definition and use **Browse custom
resources by served version** to choose a served version. Namespaced kinds
require a selected namespace; cluster-scoped kinds do not use one.

The per-kind view shows **Server printer columns** supplied by Kubernetes. If
Table negotiation is unsupported or the server returns an ordinary object list,
it shows **Standard columns** with the fallback reason (Name, Namespace and Age
in seconds). Column preferences are separate for each group/version/resource/
scope. Printer columns are display data, not a schema-driven editor.

Use **Reload page**, **Previous page**, and **Next page** for manual navigation.
Each page contains up to 200 rows; filtering applies only to that page, not the
whole kind. Navigation stops at 100 pages. **Back to all custom resources** exits
the per-kind view. There is no automatic per-kind polling or Live mode.

**Partial page**, truncation, unknown-identity and incomplete-cell counts describe
missing evidence, not an empty cluster. Missing cells and unknown ages in the
standard fallback display **Unknown**, not a fabricated zero age. Rows without
verified object identity show **Unknown — no actions** and cannot open a drawer
or invoke row actions. The per-kind list does not offer resource tags or Notes.

## Drawer Tabs

- **Overview**: generic status, UID, resource version, generation, status observed
  generation and neutral raw conditions, including condition observed generation.
  Missing generation evidence displays **Absent**; zero is retained as zero.
- **Spec** and **Status**: read-only JSON fragments in the shared code viewer,
  with **Copy** for the complete fragment. Missing fields display **Absent**;
  explicit `null`, empty objects/arrays, empty strings, `false` and zero remain
  distinct. Large fragments display without syntax highlighting; neither display
  nor copying truncates the value. These tabs do not offer editing or applying;
  use **YAML** for the full resource workflow.
- **Metadata**: labels and annotations.
- **Events**: independently loaded when opened, with filtering, pagination and
  **Retry events**. Failed Events do not discard successful object details.
- **YAML**: inspect the object document (managed fields are omitted), with the
  existing edit/apply workflow when permitted.

Detail and Events reads use the selected context and requested version. Changing
context or object clears the previous identity's state and cancels obsolete
reads. The drawer pins a supplied UID or the first detail UID; if a same-name
object is replaced, reopen it instead of treating the replacement as the old
object. **Retry details** retries a failed detail read.

This is generic inspection, not complete `kubectl describe` equivalence or an
operator-specific plugin. Spec/Status previews are not a schema editor.

## Actions

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
**Unknown** rather than invented readiness; current failure evidence still wins.
For resources with a metadata generation, missing
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

Per-kind browsing separately requires permission to **get the exact CRD** and
**list that custom resource** in the requested scope. It does not need CRD-list
permission, but can fail when the aggregate list works if exact CRD GET is
forbidden. It preserves the selected served version rather than switching to the
storage version. Standard-list fallback also supports a CRD's custom list kind.
No per-object detail requests are made to populate printer columns.

Events require permission to get the exact object and list core Kubernetes
Events. The server verifies the expected UID before reading Events and matches
UID, group, kind, namespace and name. Namespaced objects stay in that namespace;
cluster-scoped objects require an all-namespace Events read because Events are
namespaced. There is no broad name-only fallback or privileged retry.

Denied access, timeout, missing objects, changed UIDs and incomplete bounded
Event reads display errors, not **No events found.** That empty state means a
successful read found no matching events for the current filter; it does not
prove an operator has never emitted events. A Helm manifest reference alone does
not establish that a live object exists; unresolved CRD metadata remains an
explicit inspection failure rather than fabricated live details.

## Related Settings

- **Resource Tags**
- **Dataplane**
