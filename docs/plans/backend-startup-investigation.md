# Backend startup investigation

Baseline: `96a6ae6`. Scope: attribution before optimization; no production code
changes, live restart, application-cache clearing or cluster mutations.

## Readiness boundaries

Measure process/HTTP readiness separately from context selection, namespace
inventory and first usable resource rows. Rendering the shell or completing a
warm API request does not establish cold-start performance.

## Confirmed synchronous path

`manager.PlaneForCluster` initializes an exact context privately, outside the
manager-wide lock. With persistence enabled it waits for
`hydratePersistedSnapshots` and `ensureSignalHistory` before publishing the plane.
Hydration invokes `PruneOlderThan`, `ListSnapshots`, then decodes each returned
snapshot into the typed stores. The first request waits for that context's
complete restoration, not just the requested resource family.

Snapshot pruning parses stored JSON to inspect timestamps; restoration then
copies and decodes retained snapshots again. This is a candidate for profiling,
not evidence that it dominates the user's startup delay. The prior manager-wide
lock fix is already present and should not be proposed again.

## Isolated experiment

Local artifacts: `.cache/startup-investigation/` (ignored).

```sh
bash .cache/startup-investigation/run.sh
```

The runner uses a source archive of the baseline, no network, no kubeconfig,
isolated temporary databases, a private compiler cache, read-only module cache,
and the pinned `kview-build:go1.26.9-node22.23.1` image capped at 2 CPUs / 4 GiB.
It removes its named container on exit. Only the isolated source copy is
instrumented; no benchmark fixture is installed in production source.

The synthetic hydration experiment seeds 1, 100 and 500 namespace cells with
100 minimal Pod rows each, then reopens persistence with fresh manager instances
five times per size. It measures manager initialization, first plane publication,
pruning, snapshot loading and warm lookup separately. Restored stale rows must
be present; empty success is not acceptance. The remainder is not a pure JSON
timer: it includes other initialization and history work.

A separate existing HTTP restart fixture checks first responses containing
restored rows. Neither test measures a fresh OS page cache or the user's real
resource inventory. Seeding, container startup and Go compilation are excluded
from the measured stage durations.

## Execution status

The first attempt exhausted its 300-second compilation budget (exit 137), before
any fixture timings were produced. That is toolchain cost, not startup latency.
The retry corrected source/module paths and completed all four selected
Dataplane tests (package runtime 27.602s). The overall runner nevertheless exited
137 at its outer time budget before any HTTP restart-fixture output appeared.
The named container was removed and absence verified. Do not mark the entire
runner or HTTP fixture as passed. No further expensive rerun was performed.

Measured medians across five fresh-manager repetitions (milliseconds):

| Cells / minimal Pod rows | Manager initialization | First plane publication | Prune within plane | List within plane | Remaining plane work |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 / 100 | 12.745 | 3.723 | 2.305 | 0.054 | 1.384 |
| 100 / 10,000 | 78.363 | 360.472 | 65.481 | 1.769 | 297.665 |
| 500 / 50,000 | 380.396 | 1781.363 | 323.445 | 14.583 | 1444.090 |

Each column is an independent median, so stage medians need not sum exactly.
Manager initialization is separate from first plane publication. The 500-cell
plane samples ranged from 1777.427 to 2368.282 ms. Payload size was 4,829,936
bytes. These results demonstrate size-dependent synchronous restoration cost on
synthetic data, not actual user startup latency or a measured optimization.

The gated regression also confirmed unrelated context lookup remains available
while hydration is blocked, and already-restored foreground snapshots return
without waiting for the upstream source. HTTP/process-to-usable-rows timing
remains unmeasured. Evidence: local `measurements.log`.

## Next decision

The fixture identifies a material synchronous restoration cost at 500 cells.
Next, profile the remaining plane work (decode/store hydration/history) separately:
it is larger than the measured pruning stage, so pruning alone is not an
established fix. Do not change hydration/publication semantics based only on
these aggregate timings. Real-world
attribution still requires a separately controlled startup trace on an isolated,
consistent copy of application state or a maintainer-approved restart. Do not
open the live database with a second writer or copy a changing database as if it
were a consistent snapshot. Preserve RBAC, stale/unknown metadata, context
isolation and first usable rows as the acceptance boundary.
