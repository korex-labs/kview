# Connectivity And Routing Detector Pack Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add honest cache-only Service and Ingress connectivity diagnostics that distinguish real routing failures from incomplete EndpointSlice, Pod, or Service coverage.

**Architecture:** Retain normalized selectors, ports, backend references, and observation state at the existing Kubernetes LIST ownership boundary. Derive signals only from typed dataplane snapshots, never through detector-triggered live reads. Unknown or incomplete coverage must remain visible metadata and must not be converted into a failure signal.

**Tech Stack:** Go, client-go typed resources, kview dataplane snapshots and signal catalog, React/TypeScript/MUI, Docker-backed Make targets.

---

## Release Sequence

- **v5.16.0:** current desktop packaging/security work plus this Connectivity And Routing Detector Pack.
- **v5.17.0:** Signal Snooze / Ignore until changed with a separate context-local runtime suppression store.
- **v5.18.0:** compact Impact Path and Dataplane Explanation drawers built on normalized connectivity evidence.
- **Later:** Search query mini-language, Runbook integration, Investigation Workspaces, then Incident Report export.

Do not split the already completed desktop packaging into a separate release. Do not start the next feature pack before the current pack is implemented, documented, and verified.

## Product Invariants

1. Dashboard, namespace, resource, search, and investigation projections remain cache-only.
2. EndpointSlice list denial/error is **unknown coverage**, not zero endpoints.
3. Missing cached Pod metadata is **unknown selector coverage**, not zero matching Pods.
4. ExternalName and selectorless Services do not receive selector/backend-health failure signals.
5. Ingress backend validation requires a usable cached Ingress and Service snapshot.
6. Missing backend Service, missing backend port, and backend without usable endpoints are distinct evidence states.
7. Every signal retains current history, acknowledgement, recurrence, exclusion, investigation, and focused-navigation behavior.
8. Partial/stale source metadata remains visible through existing freshness/coverage contracts.
9. Additive cached DTO fields must survive persistence when later projections depend on them; in-memory-only matching metadata must explicitly degrade to unknown after hydration.
10. No new dependency is required.

## Stage 1: Durable Roadmap And Baseline Contracts

**Objective:** Persist the agreed release train and prove the current false-positive behavior with focused tests.

**Files:**
- Modify: `docs/ROADMAP.md`
- Create: `docs/plans/2026-08-27-connectivity-routing-detectors.md`
- Test: `internal/kube/resource/services/services_test.go`
- Test: `internal/dataplane/list_projection_enrich_test.go`
- Test: `internal/dataplane/dashboard_signal_detectors_test.go`

**Steps:**

1. Add this release sequence to the active roadmap.
2. Add a failing list-mapper test proving EndpointSlice list failure is represented as unknown rather than zero endpoints.
3. Add a failing projection test proving unknown endpoint coverage does not mark a Service degraded.
4. Add a failing detector test proving unknown coverage does not emit `service_no_ready_endpoints`.
5. Run the focused tests and confirm they fail for the expected missing contract.

## Stage 2: Service Endpoint Observation Contract

**Objective:** Make Service endpoint evidence honest and persistent.

**Files:**
- Modify: `internal/kube/dto/service.go`
- Modify: `internal/kube/resource/services/services.go`
- Modify: `internal/kube/resource/services/services_test.go`
- Modify: `internal/dataplane/list_projection_enrich.go`
- Modify: `internal/dataplane/list_projection_enrich_test.go`
- Modify: `internal/dataplane/dashboard_signal_detectors.go`
- Modify: detector tests in `internal/dataplane/`
- Modify: corresponding TypeScript API types only if the additive list fields are exposed to the UI.

**Contract:**

- Store the Service selector and normalized Service ports in the cached list DTO.
- Add an explicit endpoint observation value such as `complete` or `unknown`.
- Set `complete` only when the namespace EndpointSlice LIST succeeds.
- Preserve `complete + zero endpoints` as real evidence.
- Keep `unknown` out of warning/degraded signals.
- Preserve backward compatibility: legacy persisted rows without observation state normalize to `unknown`, never `complete`.

**Verification:**

```bash
go test ./internal/kube/resource/services ./internal/dataplane
```

Expected: Service mapper, enrichment, persistence compatibility, and detector tests pass.

## Stage 3: Cached Service Selector Evidence

**Objective:** Distinguish no matching Pods from matching Pods without ready endpoints.

**Files:**
- Modify: `internal/kube/dto/pod.go`
- Modify: `internal/kube/resource/pods/pods.go`
- Modify: Pod mapper tests
- Modify: `internal/dataplane/dashboard_aggregate.go`
- Modify: `internal/dataplane/dashboard_signal_detectors.go`
- Modify: `internal/dataplane/dashboard_signals.go`
- Modify: aggregate and detector tests

**Contract:**

- Mark whether Pod labels were actually observed in the current authorized LIST.
- Do not claim selector coverage from a hydrated record whose matching-only labels were intentionally not persisted.
- Build a namespace-local Pod label index once per aggregation; avoid O(Services × Pods × repeated projections) scans where practical.
- Use Kubernetes selector semantics for equality-based Service selectors.
- Add `service_no_matching_cached_pods` only when:
  - the Service has a non-empty selector;
  - the Service is not ExternalName;
  - Pod selector coverage is complete;
  - no cached Pod matches.
- Keep `service_no_ready_endpoints` for complete endpoint observation with zero ready endpoints and at least one matching Pod or selectorless endpoint-managed Service.
- Include exact selector, matching Pod count, ready endpoint count, and coverage wording in evidence.

**Verification:**

- matching and non-matching labels;
- empty namespace;
- unlabeled Pod;
- selectorless Service;
- ExternalName Service;
- hydrated/incomplete metadata;
- complete zero-endpoint observation;
- no live client calls from detectors.

## Stage 4: Ingress Backend Integrity

**Objective:** Detect broken cached Ingress → Service → port paths.

**Files:**
- Modify: `internal/kube/dto/ingress.go`
- Modify: `internal/kube/resource/ingresses/ingresses.go`
- Modify: Ingress mapper tests
- Modify: `internal/kube/dto/service.go`
- Modify: `internal/dataplane/dashboard_signal_detectors.go`
- Modify: `internal/dataplane/dashboard_signals.go`
- Modify: aggregate and detector tests

**Contract:**

- Normalize default and rule/path backends into a compact cached list representation.
- Preserve backend Service name plus named or numeric port.
- Build a namespace-local Service index once.
- Emit distinct signal types for:
  - missing backend Service;
  - missing named/numeric backend port;
  - existing backend Service with complete endpoint observation and zero usable endpoints.
- Do not emit backend endpoint failure when endpoint coverage is unknown.
- Deduplicate repeated references to the same Service/port within one Ingress while preserving useful host/path evidence.
- Keep `ingress_pending_address` separate; address assignment and backend integrity are different failure classes.

**Verification:**

- default backend and rule/path backend;
- missing Service;
- existing named port;
- existing numeric port;
- missing port;
- duplicate backend references;
- ExternalName backend;
- unknown endpoint coverage;
- stale/partial snapshots.

## Stage 5: Operator Surfaces And Documentation

**Objective:** Make evidence visible without introducing a separate diagnostics subsystem.

**Files:**
- Modify: existing signal API/TypeScript types only where additive fields are needed
- Modify: shared signal presentation/investigation components only if current reason/actual/calculated fields are insufficient
- Modify: `docs/DATAPLANE.md`
- Modify: `docs/API_READ_OWNERSHIP.md`
- Modify: `docs/user/networking.md`
- Modify: `docs/user/dashboard-and-signals.md`
- Modify: `docs/ROADMAP.md` status section

**Acceptance:**

- New signals appear through existing Dashboard, Namespace, resource Attention, history, acknowledgement, exclusion, and Investigate Signal paths.
- Evidence is concrete, for example:
  - `Service prod/api selector app=api → 3 matching Pods → 0 ready endpoints`;
  - `Ingress shop/web → Service shop/api:8080 → backend port not found`.
- Unknown coverage is described as unknown/partial and is not colored or counted as a failure.
- In-app Help explains cache-only and RBAC/coverage semantics.
- Do not edit `docs/user/whats-new.md`; release tooling owns it.

## Stage 6: Verification And Review

**Objective:** Verify the coherent feature tranche once and prepare it for review.

**Steps:**

1. Run targeted Go and UI tests during implementation.
2. Run formatting and `git diff --check`.
3. Run one full pinned gate:

```bash
make check DOCKER_BUILD=0
make build DOCKER_BUILD=0
```

4. Run independent spec-compliance and code-quality reviews.
5. Fix Critical/Important findings and rerun only affected targeted tests, followed by a full gate only when the fix changes the coherent release contract.
6. Leave the worktree uncommitted unless Alex explicitly requests commits.
7. Do not push, tag, or publish a release without explicit instruction.

## Status

- [x] Product direction and release sequence agreed.
- [x] Existing Service/Ingress detector architecture inspected.
- [x] Stage 1 roadmap and failing baseline tests.
- [x] Stage 2 Service endpoint observation contract.
- [x] Stage 3 Service selector evidence.
- [x] Stage 4 Ingress backend integrity.
- [x] Stage 5 operator surfaces and documentation.
- [ ] Stage 6 full verification and independent review.
- [ ] v5.16.0 release handoff prepared.
