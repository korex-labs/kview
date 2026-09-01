# Resource Drawers

Drawers are the primary inspection surface for individual resources. They open
from list rows while keeping the list context available behind them.

## What This View Is For

Use drawers to move from a row-level signal to detailed resource state, related
objects, events, metadata, YAML, and supported actions.

## Main Controls

- **Expand drawer to full screen**: uses the full available application workspace
  below the persistent header for dense details or logs. Select **Restore drawer
  size** to return to the previous width. Closing the drawer also leaves
  full-screen mode, so the next drawer opens normally.
- **Overview tab**: starts with actions and attention-worthy state, then shows
  key operational details.
- **Notes tab**: stores local operator notes and shows any saved investigation
  snapshots for the current context/resource. Use **Open snapshot** to reopen the
  saved bundle in the standard **Signal investigation** dialog. Saved mode keeps
  the familiar Summary, Evidence, Context, and Export tabs, but omits the
 **Save snapshot** action because the bundle is already persisted. Newly saved
 snapshots retain the structured investigation result for the closest possible
 replay; older snapshots use their saved summary/resource fields and complete
 Markdown Export bundle.
- **Resource Map tab**: shows the current resource in the center, cached
  parents/dependencies above, cached children/dependants below, and cyclic or
  bidirectional relations in the same bounded layered graph. Use the graph
  controls to fit the complete map, zoom, or center the current resource; drag
  the empty canvas to pan and use the mouse wheel to zoom. Resource cards show kind, namespace,
  availability, rollout revision when available, and wrapped resource names.
  Hover a card or focus it with the keyboard to see the exact full identity,
  direction/depth, cached rollout state, incident relationship summary, cache
  freshness, and coverage caveats. Relationship edges use compact midpoint
  markers instead of persistent text labels; hover or focus a marker to reveal
  the relationship label and see its exact endpoints, confidence, resolution,
  source field, description, and selector evidence. Edges sharing a resource or
  rank corridor use distinct card anchors and Dagre-calculated routes that avoid
  unrelated resource cards and reduce unnecessary crossings. Reverse and cyclic
  relationships follow outer layout routes, while self-relations loop outside the
  card. The graph is read-only: nodes cannot be moved, connected, or used to
  mutate Kubernetes resources.

  The collapsed **Relationship details** section groups repeated evidence and
  shows relationship type, confidence, source path, evidence, and resolution
  status when expanded. To keep depth-2 maps focused, namespace containment is
  shown for the current resource but is not used as a transit hop to pull every
  sibling resource from that namespace into the map. Depth-2 traversal is also
  direction-preserving: a dependency path continues toward further dependencies,
  while a dependant path continues toward further dependants. Shared dependencies
  are not traversed backwards into unrelated consumers. In Deployment maps, two
  or more directly owned ReplicaSets with cached desired replicas equal to zero
  are collapsed into a rollout-history group by default. **Show history** restores
  every exact node and edge and automatically refits the graph; current, non-zero,
  unavailable, and legacy ReplicaSets without status metadata remain visible.
  Select a present node (or focus it and press <kbd>Enter</kbd>/<kbd>Space</kbd>)
  to open its drawer without losing the original drawer.

  Helm release drawers expose a separate **Resource Map** when their rendered
  manifest contains resources. The release is the current node and each unique
  manifest object is a direct declared child. This map is an inventory projection
  of the release details already loaded by the drawer: opening it performs no
  additional Helm or Kubernetes reads. Manifest membership is exact, but the
  manifest alone does not prove that an object currently exists. The drawer
  enriches canonical manifest identities with one bounded cache-only dataplane
  projection: **present** means a unique cached identity match, **missing** is
  shown only when the relevant snapshot cell is complete and untruncated, and
  **unknown** covers unavailable, partial, ambiguous, unsupported, or unresolved
  custom-resource cache evidence. These states are cache observations, not a live
  cluster check. Built-in resources retain canonical stacked-drawer
  navigation. Custom-resource plural, storage version, and scope are resolved
  from the cached CRD snapshot only when the node is selected; objects without a
  safe drawer identity remain visible but are not selectable. Dense manifests are
  capped at 99 resource nodes plus the release node and report truncation
  explicitly.
- **Search and Activity**: saved investigation snapshots can appear in header
  search results and the Activity panel, linking back to their primary resource.
- **Attention banner**: shows resource signals in a consistent order: severity,
  optional local recurrence and saved-investigation state, reason, optional
  calculated detail, **Acknowledge signal**, and **Investigate signal**.
- **Relation tabs**: show resource-specific relationships such as pods,
  endpoints, owners, subjects, rules, volumes, or Helm objects.
- **Events tab**: shows Kubernetes events related to the resource when
  available.
- **Logs tab**: appears only for resources that stream logs directly. Today,
  pods own direct log streaming; workload drawers navigate to pods for logs.
- **Metadata tab**: shows labels, annotations, and summary metadata.
- **YAML tab**: shows the resource YAML and, for supported resources, guarded
  live patch controls.

## Optional Behavior

**Smart YAML collapse** is enabled by default. When enabled, YAML panels
collapse noisy sections such as managed fields and expose fold controls in code
blocks. When disabled, YAML renders without automatic folds.

**Resource Tags** are disabled by default. When enabled, supported drawer
headers show tag controls for the current resource. Namespace-scoped resources
can also show inherited namespace tags when **Inherit namespace tags** is on.

Drawer width is persisted locally from direct resize interaction and reused for
later drawers. Full-screen mode does not replace that saved width. Drawer width
is not edited from the Settings form.

## Common Workflows

- Open a row with <kbd>Enter</kbd> or double-click.
- Start from **Overview** to understand attention reasons, conditions, warning
  events, and current state.
- Use **Acknowledge signal** when a signal is known but not fixed yet.
- Use **Investigate signal** to open a read-only evidence dialog with related
  events, YAML checks, log snippets when available, related signals, and a
  copyable Markdown debug bundle. Use **Save snapshot** in that dialog to store
  the generated investigation locally for later operator follow-up; this writes
  kview's local state only, not Kubernetes annotations or objects.
- When Attention shows **Previously resolved**, **Known**, **Watching**, or
  **Known noisy**, hover the state to review the latest matching snapshot note or
  select it to open that snapshot's primary resource.
- Use relation tabs to jump from one resource to another without returning to
  the list first.
- Use **Events** before mutating when a resource is failing or recently changed.
- Use **YAML** for exact Kubernetes state and guarded live patches when
  supported.

## Permission And Data Notes

Drawer content is permission-aware. Some tabs or sections may be missing,
empty, degraded, or access denied when the active account cannot read related
resources. Actions are shown only when capability checks allow them for the
current target.

Resource Map is cache-only: opening it does not trigger Kubernetes GET/LIST or
background discovery. Partial, stale, legacy, malformed, ambiguous, or capped
relationship evidence is shown as degraded/truncated rather than presented as
a complete graph. Its hard limits are depth 2, 100 nodes, 200 edges, and 50,000
examined relationship records.

## Related Settings

- **Smart YAML collapse**
- **Resource Tags**
- **Dataplane**
