# Generic CR correctness contract

## Implemented health semantics

The list mapper and detail mapper share `crSignal`:

- Positive conditions: exactly `Ready`, `Available`, `Healthy`.
- Negative conditions: exactly `Degraded`, `Failed`, `Stalled`.
- A current positive=False or negative=True produces Warning, even alongside
  positive=True. Negative=False alone does not establish readiness.
- Unknown/malformed recognized statuses and stale/unverifiable recognized
  evidence prevent OK. Current failure evidence still wins over uncertainty.
- Unrecognized types neither establish health nor reverse known polarity.
  An unrecognized-only condition set is Unknown, not OK.
- Condition `observedGeneration` overrides status-level `observedGeneration`.
  For an object with positive metadata.generation, evidence must match exactly;
  missing, malformed, older, and future observations are Unknown.
- Legacy objects without generation (or with zero generation) can use conditions
  or phase only when observedGeneration is absent or zero. On versioned CRs,
  controllers that omit observedGeneration now intentionally show Unknown.
- Phase fallback is only available without nonempty conditions; invalid or
  unrecognized condition evidence cannot be laundered through a healthy phase.
  Legacy phase mapping remains unchanged, subject to the freshness check.
- Raw drawer conditions are neutral: their DTO lacks freshness metadata and the
  shared True=healthy color rule is invalid for arbitrary CR conditions.

The CRD DTO's legacy `storageVersion` request-selection field now chooses storage
only if served, otherwise the first named served version. No served version means
no list/resolve target. This is not a promise that the selected version is storage.

## Implemented restricted discovery fallback

Only CRD-list Forbidden (including a cached denial) enables this fallback.
Unauthorized and other index failures do not trigger discovery. The authoritative
CRD list and group/kind resolve endpoint remain CRD-list-backed; fallback types
never populate that store or masquerade as a successful CRD list.

`DiscoverRestrictedTypes` constructs a temporary, incomplete type index:

1. Copy the active REST config, preserving credentials, impersonation, TLS and
   transport settings. Fetch `/apis`, then each selected group's preferred-version
   resource document. Discovery verbs are server capabilities, not RBAC.
2. Inspect at most 64 groups and probe at most 64 distinct candidate CRD names.
   Metadata requests are sequential, disable automatic retries, have three-second
   request timeouts, and share an eight-second deadline (or earlier caller deadline).
   Report truncation on either cap. Only preferred versions are considered, so
   resources served exclusively in another version can be missed.
3. Ignore known built-in GVKs as a budget optimization, subresources, wrong-scope
   resources, non-listable resources and invalid routing names. Unknown and
   aggregated APIs are **not** assumed to be CRDs.
4. GET the exact `plural.group` CRD using the same credentials. Require matching
   apiVersion/kind, name, group, plural, resource kind and scope. Require the
   advertised preferred version to be served by that CRD. This confirmed version,
   not an unserved storage version, becomes the instance request version.
5. List only confirmed types, with the existing maximum 24 simultaneous instance
   requests and three-second per-kind deadlines. Namespaced fallback requires an
   explicit namespace; it never retries denied access at all-namespaces scope.
   Cluster fallback lists only confirmed cluster-scoped types.

The fallback always reports `UniverseUnknown`, the original CRD-list denial,
probe counts/errors and cap truncation through `aggregation.discovery`. Instance
list counters remain independent: `TotalKinds` counts confirmed candidate types,
not the cluster's total universe. Snapshot coverage and kind-definition relationship
coverage remain partial even if every confirmed type is readable. Denied GETs,
missing CRDs, discovery failures, stale/mismatched metadata and unserved versions
never create a live CR row or kind-definition relationship. Helm manifest rows
remain separate, non-live provenance without authoritative relationship carriers.
Restricted results are cached for the ordinary snapshot TTL, retain the denial,
and are not persisted as successful full snapshots. There is no cross-request
candidate cache, privileged collector, credential fallback or namespace sweep.

## Verification and limitations

HTTP regressions cover same-credential requests, list Forbidden plus allowed,
denied or missing CRD GET, non-Forbidden failure behavior, namespaced/cluster
confinement, aggregated resources without CRD proof, served-version selection,
identity/scope mismatch, stale/partial discovery, cancellation/deadlines, caps,
cache metadata and absence of fabricated relationships. Health tests cover
conservative polarity, freshness, conflict precedence and matching list/detail
results.

Discovery availability and exact CRD GET permission are still prerequisites. A
caller allowed to list instances but denied all CRD metadata receives no confirmed
live types; empty results do not establish absence. Restricted discovery is a
bounded best-effort fallback, not exhaustive API inventory. The resolve endpoint
is not extended by this fallback. No live-cluster verification is claimed.
