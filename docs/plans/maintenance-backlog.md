# Maintenance status and remaining work

Baseline: local `96a6ae6`, reconciled after maintainer acceptance of the
Deployment Resource Map. This is the current maintenance queue, not a release
promise or a request to replay historical verification.

## Completed

- `c6ebd05`: post-v5.17 dependency/security maintenance and resource-capped basic
  verification. Full suites/coverage remain opt-in; browser E2E is reserved for
  concrete troubleshooting. Evidence: [maintenance record](post-v5.17-maintenance.md).
- `d0f4465`: bounded recursive Helm ownership maps, accepted by the maintainer.
- `663f95b`: deferred syntax grammars, search drawers and terminal components;
  negotiated gzip, representation-specific ETags and bounded static-asset cache.
  Initial entry/modulepreload JS fell from about 2.74 MB to 1.33 MB raw and
  803 kB to 391 kB gzip. These are artifact sizes, not startup/render timings.
- `96a6ae6`: parallel relationship layout correction, guarded recovery,
  observed-Pod grouping and stable presentation inputs. Focused tests included
  six locally captured Deployment maps; maintainer browser acceptance followed.
  Private captures and credentials are not repository fixtures.

The v5.17.0 release already included visual Resource Map v2, shared Explain,
workload Live, generic CR inspection, Helm Recovery and drawer/terminal fixes.
The [pre-release audit](release-readiness-audit.md) remains historical evidence,
not a list of unfinished features.

## Current implementation: demand-first snapshot hydration

The maintainer approved the [demand-first hydration tranche](demand-first-snapshot-hydration.md)
after the isolated startup investigation. Implementation, focused race checks,
HTTP restart verification and production build are complete; the maintainer
manually accepted the build and confirmed substantially faster operation. Synthetic first-requested-row latency was 10.57/10.10/12.60 ms for
1/100/500 saved cells, not a real process/browser startup measurement. Exact-cell
priority, bounded background work, publication guards and partial coverage are
implemented and accepted for commit. The agent did not restart the running server.

Baseline measurement discipline remains in force: Separate process/HTTP readiness,
persisted-cache hydration, first context inventory, scheduler admission, live
LIST latency and first usable resource rows. Shell visibility and a warm API
request are not cold-start acceptance.

Use bounded isolated measurements first; do not restart the maintainer's server,
clear its cache, attach a second writer to its database, or mutate the cluster.
Record fixture versus real-data boundaries and identify a measured bottleneck
before proposing an optimization. Findings belong in the separate backend
[startup investigation report](backend-startup-investigation.md), not in this
status index.

## Retained acceptance limitations

These are evidence gaps, not missing implementation or automatic blockers:

- Workload Live: historical smoke had real rows only for Deployment/ReplicaSet;
  final race-fix binary and all six populated kinds were not all exercised on a
  real cluster. Fixtures and later release publication do not fill that gap.
- Helm Recovery: real history-record deletion was not exercised. Any destructive
  acceptance needs separate permission and a disposable target; never exercise
  it against production solely to complete a checklist.

## Publication boundary

The four post-v5.17 commits above were local at reconciliation. Push, remote CI,
release tag selection and generated release notes require a separate handoff.
Do not edit `CHANGELOG.md` or `docs/user/whats-new.md` outside the release helper.
A later release gate should use the current `AGENTS.md` verification policy,
not historical full/coverage/browser commands.

## Outside this maintenance block

Cached search filters, namespace-first results and focused Resource Map entry
are implemented and maintainer-accepted; see the
[search plan](search-filters-and-map-entry.md). Dedicated impact paths, runbook
bindings, investigation workspaces, incident export, broader Live kinds and optional multi-user/OIDC
remain product tracks in [Roadmap](../ROADMAP.md). They are not unfinished
maintenance tasks. Broad decomposition without a demonstrated problem is not
part of the cold-start investigation.
