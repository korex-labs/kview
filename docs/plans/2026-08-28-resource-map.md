# Resource Map Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a cache-derived Resource Map tab to every real Kubernetes resource drawer so operators can understand parent/child structure around the current Kubernetes resource and open related resources quickly.

**Architecture:** Capture restart-safe relationship metadata where Kubernetes LIST objects are already available, extract it into a snapshot sidecar that is not exposed by ordinary list DTO JSON, and build a bounded cache-only ego graph through dataplane `peek*` accessors. Inject one shared Resource Map tab from `ResourceDrawerShell`, render a deterministic accessible three-band graph, and open related resources through a generic lazy drawer navigation host.

**Tech Stack:** Go 1.26.6, typed dataplane snapshots, bbolt JSON persistence, React 19, TypeScript, MUI 9, SVG connectors, Vitest, Playwright.

---

## Product contract

The first production release provides:

- one standard **Resource Map** tab in all 26 real Kubernetes drawer kinds
  (25 fixed kinds plus dynamic custom resources); the two virtual Helm drawers
  are intentionally excluded;
- the current resource as the centered node;
- direct parents above and direct children/dependants below;
- optional expansion to two hops, with a hard maximum depth of two;
- clickable present nodes that open the matching built-in or custom-resource drawer over the current drawer;
- deterministic ordering, cycle handling, bounded payloads, and explicit truncation;
- truthful relationship confidence and cache coverage;
- placeholders for referenced resources known by identity but absent from the cache;
- no synchronous cache warming and no hidden Kubernetes GET/LIST calls.

The first release deliberately does not provide:

- force-directed graph layout;
- arbitrary unbounded topology discovery;
- inferred custom-resource spec references;
- application/network traffic flow;
- cross-context relationships;
- live fallback reads when cache evidence is missing;
- automatic replacement of existing resource-specific drawer links.
- fabricated Kubernetes identities or Resource Map relationships for virtual
  Helm chart/release drawers.

## Shared identity and relationship contract

### Resource identity

Use one canonical identity in backend and frontend:

```text
context + group + version + resource + kind + scope + namespace + name + uid?
```

Rules:

- UID participates when available and distinguishes delete/recreate instances.
- Namespaced and cluster-scoped identities must never collide.
- `namespace` stays empty for cluster-scoped resources.
- Custom resources must carry real group/version/plural/kind, not only the UI pseudo-resource keys.
- Helm releases/charts remain explicit virtual UI adapters and are excluded
  from Resource Map rather than presented as raw Kubernetes GVRs.

### Relationship metadata sidecar

Extend `Snapshot[I]` with a persisted sidecar, for example:

```go
Relationships []dto.ResourceRelationshipRecord `json:"relationships,omitempty"`
```

Each list DTO embeds a carrier excluded from normal JSON:

```go
type ResourceRelationshipCarrier struct {
    Resource ResourceIdentityDTO
    Owners   []OwnerReferenceDTO
    Refs     []ResourceReferenceDTO
}
```

The carrier is `json:"-"` on the public item. A promoted method or descriptor extractor copies it to `Snapshot.Relationships` immediately after a successful LIST. The sidecar is serialized by generic bbolt persistence and survives hydration even though the public item carrier does not.

Never persist `observed=true` while dropping the evidence required by that observation. Legacy snapshots without the sidecar normalize relationship coverage to `unknown`.

### Edge classes

```text
ownerReference   exact only when source owner UID matches cached target UID
objectReference  high confidence explicit Kubernetes reference
selector         medium confidence only when selector and label evidence are complete
namespace        high confidence containment
kindDefinition   high confidence CRD ↔ custom-resource type relationship
```

Unknown, partial, denied, cold, or hydrated-without-label snapshots cannot prove selector absence. Missing referenced targets may be shown as non-navigable `missing` nodes, but must not be described as deleted unless cache coverage is complete.

### Limits

- default depth: 1;
- hard maximum depth: 2;
- default/hard node cap: 60/100;
- default/hard edge cap: 120/200;
- stable-sort before truncation;
- exact uncapped totals plus returned counts;
- keep cycle edges but never expand an already visited identity;
- deduplicate by `(from, to, type, evidence)`.

## Initial relationship matrix

### Universal

- Namespace → every cached namespaced Kubernetes resource.
- Full Kubernetes ownerReference parent/child edges for every supported real resource kind.
- CRD → cached custom-resource instances by group/kind/plural/scope.

### Explicit references

- Pod → Node.
- Pod → ServiceAccount.
- Pod/workload template → PVC, ConfigMap, Secret, image-pull Secret where retained by LIST mappers.
- HPA → scale target.
- StatefulSet → governing Service.
- Ingress → backend Service and TLS Secret.
- PersistentVolume ↔ PersistentVolumeClaim.
- RoleBinding → Role or ClusterRole.
- ClusterRoleBinding → ClusterRole.
- RoleBinding/ClusterRoleBinding → ServiceAccount subjects where identity is present.
- ServiceAccount → named/image-pull Secrets where present.

### Selector-derived

- Service → matching Pods.
- Deployment, ReplicaSet, DaemonSet, StatefulSet, Job → matching Pods where selector evidence is retained and complete.
- NetworkPolicy → selected Pods.

Selector matches use namespace-local indexes and canonical selector memoization. They are omitted with `unknown` coverage after legacy hydration or any incomplete label observation.

## HTTP contract

```http
GET /api/dataplane/resource-map
  ?scope=namespaced|cluster
  &namespace=apps
  &group=apps
  &version=v1
  &resource=deployments
  &kind=Deployment
  &name=api
  &depth=1
  &maxNodes=60
  &maxEdges=120
```

The active context remains server-owned through the existing context selection contract.

Response shape:

```json
{
  "active": "context-name",
  "center": {
    "id": "...",
    "group": "apps",
    "version": "v1",
    "resource": "deployments",
    "kind": "Deployment",
    "scope": "namespaced",
    "namespace": "apps",
    "name": "api",
    "uid": "...",
    "availability": "present"
  },
  "nodes": [],
  "edges": [],
  "meta": {
    "freshness": "hot",
    "coverage": "full",
    "completeness": "complete",
    "truncated": false,
    "totalNodes": 12,
    "returnedNodes": 12,
    "totalEdges": 14,
    "returnedEdges": 14,
    "missingSources": []
  }
}
```

Cold cache returns HTTP 200 with the center identity, no fabricated edges, and unknown metadata. Invalid identity/limit parameters return 400. Unavailable dataplane returns the existing sanitized service-unavailable response.

---

### Task 1: Add restart-safe snapshot relationship metadata

**Objective:** Preserve canonical resource identity, full owner references, explicit references, and evidence coverage without exposing hidden metadata in normal list APIs.

**Files:**

- Create: `internal/kube/dto/resource_relationship.go`
- Create: `internal/kube/dto/resource_relationship_test.go`
- Modify: `internal/dataplane/snapshot_types.go`
- Modify: `internal/dataplane/snapshot_exec.go`
- Modify: `internal/dataplane/snapshot_exec_test.go`
- Modify: `internal/dataplane/persistence_test.go`

**Steps:**

1. Write failing tests proving carrier metadata is omitted from item JSON while the snapshot sidecar round-trips through JSON/bbolt.
2. Add versioned canonical identity, owner, reference, coverage, and source record DTOs.
3. Add an extractor contract to cluster and namespaced snapshot descriptors.
4. Populate the sidecar after a successful fetch and preserve it through stale/persisted fallback.
5. Normalize a missing legacy sidecar to unknown coverage.
6. Verify:

```bash
go test ./internal/kube/dto ./internal/dataplane -run 'ResourceRelationship|Snapshot.*Relationship|Persistence.*Relationship' -count=1
```

### Task 2: Capture universal identity and owner metadata

**Objective:** Populate UID/GVR/scope and full owner references for every real Kubernetes list resource at its existing LIST mapper boundary.

**Files:**

- Modify DTOs under: `internal/kube/dto/*.go`
- Modify mappers under: `internal/kube/resource/*/*.go`
- Test the affected mapper packages.

**Steps:**

1. Add shared mapper helpers that canonicalize Kubernetes metadata and copy mutable owner-reference slices.
2. Embed the hidden relationship carrier in each persisted list DTO.
3. Populate canonical identity and all owner references for Namespace, Node, PV, RBAC, CRD/custom resources, workloads, networking, configuration, storage, HPA, quotas, and limits.
4. Ensure custom resources retain actual group/version/resource/kind/scope.
5. Ensure virtual Helm resources are omitted rather than assigned fake Kubernetes GVRs.
6. Add representative mapper regressions for namespaced, cluster-scoped, custom, owner-chain, and recreated UID cases.
7. Verify all affected mapper packages and legacy JSON compatibility.

### Task 3: Capture explicit and selector evidence

**Objective:** Retain the references and selectors required for useful resource structure without detail reads.

**Files:**

- Modify shared relationship DTO/helper files.
- Modify Pod/workload, Service, Ingress, NetworkPolicy, HPA, storage, RBAC, ServiceAccount, and custom-resource list mappers.
- Add focused mapper/persistence tests.

**Steps:**

1. Capture Pod node/service-account/storage/config/secret references.
2. Capture workload selectors and pod-template references.
3. Reuse persisted Service selector and Ingress backend evidence; add Ingress TLS Secret refs.
4. Capture HPA target, PV/PVC, RBAC role/subject, ServiceAccount Secret, StatefulSet Service, and CRD instance references.
5. Preserve selector/label observation coverage separately from empty values.
6. Prove sidecar persistence and unknown-after-legacy semantics.

### Task 4: Build the cache-only Resource Map projection

**Objective:** Produce a deterministic bounded ego graph without scheduling Kubernetes work.

**Files:**

- Create: `internal/dataplane/resource_map.go`
- Create: `internal/dataplane/resource_map_test.go`
- Modify: `internal/dataplane/manager.go`
- Modify: `internal/dataplane/projections.go` if the public interface belongs there.

**Steps:**

1. Write failing tests for owner, explicit, selector, containment, and CRD/custom edges.
2. Read only through `peekClusterSnapshot`, `getCached`/`peekNamespacedSnapshot`, and `peekAllNamespacedSnapshots`.
3. Build identity/node indexes once per projection and namespace-local label indexes once per relevant snapshot.
4. Traverse breadth-first to requested depth with visited identity tracking.
5. Keep cycle edges, deduplicate and stable-sort edges/nodes, then truncate.
6. Return exact totals, missing sources, freshness, coverage and completeness.
7. Test same-name cross-namespace isolation, UID recreation, cold/partial/denied/hydrated snapshots, missing targets, cycles, caps and deterministic order.
8. Add a test with a panicking/failing `ClientsProvider` proving projection performs no live reads.
9. Benchmark broad shared selectors and a high-fanout namespace.

### Task 5: Expose the authenticated active-context API

**Objective:** Add a validated HTTP endpoint that returns only the cache-derived projection.

**Files:**

- Create: `internal/server/handlers_resource_map.go`
- Modify: route registration in `internal/server/handlers_dataplane.go` or the owning server file.
- Modify: `internal/server/server_http_test.go`
- Modify: `docs/API_READ_OWNERSHIP.md`
- Modify: `docs/DATAPLANE.md`

**Steps:**

1. Add strict query decoding and supported scope/depth/cap validation.
2. Resolve context only through the existing server-owned request context path.
3. Return sanitized 400/503/500 classifications consistent with dataplane handlers.
4. Test auth, context ownership, namespaced/cluster/custom identities, cold cache, caps and unknown fields.
5. Document cache-only ownership and no-live-read semantics.

### Task 6: Add generic related-resource drawer navigation

**Objective:** Open arbitrary related built-in/custom resources without introducing pairwise imports in every drawer.

**Files:**

- Create: `ui/src/components/resources/navigation/resourceTarget.ts`
- Create: `ui/src/components/resources/navigation/ResourceDrawerNavigationProvider.tsx`
- Create: `ui/src/components/resources/navigation/ResourceDrawerHost.tsx`
- Create: `ui/src/components/resources/navigation/resourceDrawerRegistry.tsx`
- Create corresponding focused tests.
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/resources/customresources/CustomResourceDrawer.tsx`

**Steps:**

1. Define the complete frontend `ResourceTarget` matching the API identity.
2. Implement `openResource` and `closeTopResource` with current-target/consecutive dedupe and stack depth 8.
3. Dispatch built-ins by plural resource through lazy imports.
4. Route complete group/version/kind targets to `CustomResourceDrawer`.
5. Preserve empty namespace for cluster scope.
6. Mount one host in the existing provider/keyboard tree and reuse `RightDrawer` stack semantics.
7. Test built-in/custom dispatch, duplicate suppression, stack close/Escape and lazy fallback.

### Task 7: Add the shared Resource Map tab and graph

**Objective:** Inject and render the map once for every real Kubernetes drawer with accessible node navigation; leave virtual Helm drawers unchanged.

**Files:**

- Create: `ui/src/components/shared/ResourceMapPanel.tsx`
- Create: `ui/src/components/shared/ResourceMapGraph.tsx`
- Create: `ui/src/components/shared/useResourceMap.ts`
- Create corresponding tests.
- Modify: `ui/src/components/shared/ResourceDrawerShell.tsx`
- Modify: `ui/src/components/shared/ResourceDrawerShell.test.tsx`
- Modify: `ui/src/types/api.ts`
- Modify: `ui/src/keyboard/actions.ts`
- Modify: `ui/src/keyboard/keymaps.ts`
- Modify keyboard tests.

**Steps:**

1. Generalize Notes-only shell injection to auxiliary tab state: `resource-map | notes | null`.
2. Inject tabs after native tabs in order: Resource Map, Notes.
3. Fetch only while Resource Map is selected; abort on identity/tab/context changes and guard stale responses.
4. Render parents/current/children in deterministic bands with SVG connectors and real MUI button nodes.
5. Show kind, name, namespace, edge class/confidence and missing/unknown state without tooltip-only meaning.
6. Add accessible overflow/list treatment for truncation.
7. Clicking or keyboard-activating present non-current nodes calls generic `openResource`.
8. Register `drawer.tab.resource-map` with a non-conflicting default binding such as `Shift+R`.
9. Test injection, native-tab restoration, cluster scope, custom identity, accessibility, partial/empty/error states and navigation.

### Task 8: Documentation, integration smoke and full verification

**Objective:** Verify the complete feature and align product documentation.

**Files:**

- Modify: `docs/ROADMAP.md`
- Modify: `docs/user/*` resource/drawer documentation as appropriate.
- Add one Playwright Resource Map smoke.

**Steps:**

1. Document relationship classes, cache-only behavior, unknown/partial states and graph limits.
2. Add Playwright smoke: open workload drawer → Resource Map → open parent/child → Escape returns to original drawer.
3. Run focused backend/frontend checks first.
4. Run the full project gate serially:

```bash
make audit DOCKER_BUILD=0
make workflow-lint DOCKER_BUILD=0
make check DOCKER_BUILD=0
make build DOCKER_BUILD=0
git diff --check
```

5. Run spec-compliance review, then code-quality/security/performance review.
6. Do not commit, push, tag or release without a separate user decision.
