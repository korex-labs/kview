# Demand-first snapshot hydration

Status: implemented and locally verified; focused race checks including the
last-good fallback regression passed (8.387s), as did the synthetic benchmark,
HTTP restart test, production UI/backend build, binary help invocation and
whitespace check. The maintainer manually accepted the build and confirmed
substantially faster operation. No agent-driven live restart was performed. Baseline:
`96a6ae6`. The maintainer approved request-prioritized persisted-cache restoration
followed by bounded background loading. No live restart or commit is implicit.

## Goal and scope

Time to usable rows in the requested context/kind/namespace must not depend on
restoring every other persisted snapshot in that context. Existing exact-key
persistence reads are the starting point; no new database or speculative
frontend activity protocol is required. Ordinary active-view requests supply
demand; optional UI prefetch is outside this tranche.

The [startup investigation](backend-startup-investigation.md) measured synthetic
full-context restoration, not actual operator startup latency. Keep process,
manager construction, first plane, first requested snapshot and background
completion separate in before/after measurements.

## Required behavior

- Plane creation is lightweight. First demand restores the exact persisted cell
  before deciding whether a live read is necessary. Preserve stale provenance,
  observation time, monotonic revisions, TTL and existing startup fallback rules.
- Requests for the same cell coalesce. Different foreground cells do not wait
  for a whole-context restore or background queue drain.
- Background restoration is bounded in enumeration, payload bytes/work and
  concurrency; it yields between batches and stops on manager shutdown.
  Materializing every payload before the first batch is not bounded loading.
- First demand has priority over unused cells. Switching views naturally makes
  the new request foreground; no duplicate restore is needed if it is in flight.
- Full pruning is not a hidden synchronous manager/plane startup barrier.
  Expiry is checked during restore even if physical deletion is deferred.
- Signal history/acknowledgement/suppression semantics remain correct before
  signal computation; an ordinary resource list must not eagerly require all
  signal history just to publish its resource plane.

## Correctness boundaries

Cache-only APIs remain free of Kubernetes reads. An unhydrated cell is not proof
of an empty resource set or complete coverage. Maps, search, aggregate counters
and Dashboard must retain missing/partial coverage until their required evidence
is available; do not silently report health from an incomplete inventory.

Disk publication must not overwrite newer LIST/Live results. Empty-cell checks
alone are insufficient: clearing a cell increments its revision, and a late disk
read must not resurrect it after invalidation. Gate publication using the
appropriate cell/persistence generation and normal publication locks. Context,
namespace and kind identity stay exact.

Persistence enable/disable/reconfiguration must not publish from a retired
store, close a store while a worker uses it unsafely, strand waiters, or deadlock
shutdown. Failed loads must not become permanently authoritative absence.

## Focused acceptance

1. Gate an unrelated persisted cell; the requested cell still returns usable rows.
2. Two requests for one cell share restoration; different cells remain independent.
3. Gate disk I/O, publish newer live data, then release disk: newer rows/revision win.
4. Gate disk I/O, clear/invalidate the cell, then release disk: no resurrection.
5. Expired/corrupt/missing persisted cells preserve existing live fallback and
   error/unknown semantics; one corrupt cell does not block other cells.
6. Background hydration completes in bounded chunks, yields to foreground and
   shuts down cleanly; policy transitions cannot publish stale generations.
7. Cache-only aggregates and maps do not claim complete coverage during hydration.
8. Compare first requested rows against the same synthetic persistence fixture,
   separately reporting compiler/container costs and background completion.

Use resource-capped focused Go checks (race checks on changed concurrency paths),
then one production build at the coherent boundary. No routine full suite,
coverage, Chrome or Playwright. Keep private captures and credentials ignored.

## Measured verification (2026-10-15)

The focused hydration/retention/policy/lifecycle race selection passed (package
runtime 7.899s), as did `TestPodPersistenceRestartInitialRoute` (0.412s).
The later last-good fallback correction has a separate final race/build gate;
these results do not stand in for that gate.

`BenchmarkDemandFirstHydration`, five iterations per fixture, measured fresh
manager construction through 100 usable requested Pod rows:

- 1 saved cell: 10.57 ms/op.
- 100 saved cells: 10.10 ms/op.
- 500 saved cells: 12.60 ms/op.

Each saved cell contains 100 rows. Seeding and shutdown are outside the timer;
this is neither cold-filesystem nor full-process/browser startup. The earlier
full-context restoration fixture measured 3.7/360/1780 ms respectively, but the
measurement boundaries differ, so do not present a direct speedup ratio. The
new measurement shows requested-row latency remaining nearly flat as unrelated
saved cells increase. Background completion is not measured by this benchmark.
Local raw output: `.cache/startup-investigation/race-benchmark.log`.

## Delivery boundary

Implementation, focused verification, measured comparison and binary build are
required before completion. This plan is not evidence that those gates passed.
Manual browser acceptance and any real-data startup trace remain distinct from
synthetic timing. Keep changes uncommitted for maintainer review.
