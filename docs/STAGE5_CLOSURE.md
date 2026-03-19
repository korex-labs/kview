# Stage 5A Closure

This document is the final closure status for Stage 5A.

Stage 5A was intended to establish the read-side architectural foundation for a policy-driven, RBAC-aware, proxy-tolerant, multi-cluster dataplane without broad feature expansion.

The goal of this stage was not "move every read behind the dataplane". The goal was to make the boundary real, make the first owned surfaces real, and make partial ownership honest.

## Intended Scope

Stage 5A intended to introduce:

- a dedicated `internal/dataplane` subsystem
- per-cluster planes
- scheduler-mediated read snapshots
- normalized read error semantics
- capability learning from read outcomes
- bounded observer lifecycle
- a small operator-visible dataplane dashboard
- first projection-backed namespace behavior

It did not intend to finish full dataplane migration for every resource endpoint.

## Fully Implemented In Stage 5A

- `internal/dataplane` is the read-side boundary for dataplane contracts, snapshots, observers, normalization, and projection metadata.
- One cluster plane is created lazily per kube context.
- Scheduler-mediated snapshots are active for:
  - namespaces
  - nodes
  - namespace-scoped pods
  - namespace-scoped deployments
- Read errors are normalized into explicit coarse classes such as:
  - `access_denied`
  - `unauthorized`
  - `proxy_failure`
  - `connectivity`
  - `timeout`
  - `rate_limited`
  - `transient_upstream`
- Capability learning is active for dataplane-owned reads and records:
  - state
  - provenance
  - confidence
  - timestamps
- Observer lifecycle exists for:
  - namespaces
  - nodes
- Observer activation is lazy and endpoint-driven for the active context.
- Observer state transitions are logged to the runtime log buffer.
- `/api/dashboard/cluster` is dataplane-backed.
- `/api/namespaces` is dataplane-backed.
- `/api/namespaces/{name}/summary` is projection-backed and overlays dataplane snapshots for pods and deployments.

## Active Runtime Behavior Versus Contract Placeholders

These are real runtime behaviors today:

- profile: `focused`
- discovery mode: `targeted`
- activation mode: lazy endpoint-driven startup
- scope: default empty scope, which currently means cluster-wide namespace and node snapshots plus on-demand namespace snapshots for pods and deployments

These enums exist as architectural contract placeholders only in Stage 5A:

- profiles: `manual`, `balanced`, `wide`, `diagnostic`
- discovery modes: `passive`, `adaptive`

They are intentionally documented in code to preserve the intended architecture, but they are not selectable or fully implemented runtime behavior in this stage.

## Dataplane-Backed Endpoints And Surfaces

Backend endpoints currently backed by dataplane behavior:

- `/api/dashboard/cluster`
- `/api/namespaces`
- `/api/namespaces/{name}/summary`

Frontend surfaces currently showing dataplane state:

- cluster dashboard dataplane overview
- namespace list metadata
- namespace drawer summary status

## Namespace Summary Ownership

`/api/namespaces/{name}/summary` is intentionally mixed in Stage 5A.

Dataplane-derived today:

- pod counts
- deployment counts
- pod health
- deployment health
- problematic pod entries
- problematic deployment entries
- summary metadata describing freshness, coverage, degradation, completeness, and coarse state

Still legacy direct-read today:

- jobs
- statefulsets
- daemonsets
- cronjobs
- services
- ingresses
- PVCs
- configmaps
- secrets
- Helm summary internals
- non-pod and non-deployment problematic entries

This mixed ownership is accepted for Stage 5A. The API and UI must remain explicit about it rather than implying that the whole summary is snapshot-backed.

## State Semantics In Stage 5A

Dataplane-backed surfaces currently use coarse states such as:

- `ok`: data loaded successfully for the current contract
- `empty`: the read succeeded but found no objects in the current contract
- `denied`: RBAC or auth prevented the required read
- `partial_proxy`: upstream proxy or connectivity behavior prevented trustworthy full observation
- `degraded`: transient, timeout, rate-limit, or other unstable upstream behavior reduced confidence
- `unknown`: no trustworthy coarse state could be derived

Supporting metadata semantics:

- freshness: how recent the snapshot or projection is
- coverage: how much of the intended contract the surface covers
- degradation: whether upstream instability affected observation quality
- completeness: whether the result is logically complete for the contract it claims

Important truthfulness rule:

- `coverage` and `completeness` describe the contract of the specific dataplane-backed surface, not the entire product.
- Example: namespace summary may be `partial` and `inexact` even when pods and deployments are correct, because the full summary remains intentionally mixed.

## Observer Lifecycle Visibility

Stage 5A intentionally keeps observer lifecycle bounded:

- no global "observe every cluster" loop
- no background warm-up for all contexts
- no configurable observer policy UI

Current visibility includes:

- observer state in `/api/dashboard/cluster`
- runtime log entries for observer transitions
- immediate observer refresh when a dataplane-backed endpoint first activates the plane, so lifecycle state is operator-visible without waiting for the first periodic tick

## Intentionally Accepted Partial Areas

These are partial by design and accepted for Stage 5A:

- most resource list/detail handlers still use direct `kube` reads
- namespace summary remains mixed ownership outside pods and deployments
- only namespaces and nodes have long-lived observers
- pods and deployments are snapshot-backed on demand, not via long-lived observers
- there is no universal metadata envelope across every read endpoint yet
- plane scope is explicit in code but not yet user-configurable

## Deferred To Later Stages

The following work is intentionally deferred:

- migrating more list/detail endpoints behind dataplane snapshots
- expanding long-lived observation to more resource kinds
- configurable profiles, discovery modes, and scope policies
- background warm-up or operator-configured observer lifecycle
- broader projection-backed views beyond the current namespace summary and dashboard surfaces
- a uniform metadata envelope for all API responses

## Stage 5B progress note

Stage 5B begins the first legacy-read reduction wave by moving additional namespace-scoped list paths behind dataplane snapshots.

Now dataplane-backed:

- `/api/namespaces/{ns}/pods`
- `/api/namespaces/{ns}/deployments`
- `/api/namespaces/{ns}/services`
- `/api/namespaces/{ns}/ingresses`
- `/api/namespaces/{ns}/persistentvolumeclaims`
- `/api/namespaces/{ns}/configmaps`
- `/api/namespaces/{ns}/secrets`

Namespace summary ownership is also expanded for count overlays of services, ingresses, PVCs, configmaps, and secrets, while keeping the summary contract explicitly partial/inexact.

Still intentionally deferred:

- broad watch coverage for all kinds
- full detail endpoint migration
- jobs/cronjobs/statefulsets/daemonsets list migration

## Stage 5A Closure Judgment

Stage 5A should be considered closable when reviewed against the intended scope above:

- the dataplane boundary is real
- owned surfaces are real
- metadata is explicit
- observer behavior is bounded and visible
- active behavior is clearly separated from placeholder contracts
- remaining legacy ownership is documented honestly instead of hidden
