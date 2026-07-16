# Signal Memory And Recurring Incident Detection Plan

## Objective

Use kview-owned local signal history to tell an operator when a current signal has
been observed before, without adding cluster reads or pretending that repeated
polls are separate incidents.

Signal memory remains local, bounded, additive to existing signal DTOs, and safe
for read-only/RBAC-constrained clusters. It must not write Kubernetes annotations
or infer resolution from missing data when dataplane coverage is incomplete.

## Existing Foundation

- Signals already carry a stable `historyKey`, `firstSeenAt`, and `lastSeenAt`.
- Signal history is persisted in the local dataplane bbolt store.
- Signal acknowledgements and comments are local and exportable.
- Saved investigation snapshots retain signal type, primary resource, triage
  state, operator note, and generated Markdown.
- Dashboard, namespace Signals, resource Attention, Investigate Signal, Search,
  and Activity already share the same signal identities and local artifacts.

The current internal `SeenCount` is updated whenever a signal-bearing surface is
requested. It is useful as persistence evidence but is not an incident count:
refreshes and different UI surfaces can observe the same continuing condition.
The product must not label that raw value as “times seen”.

## Tranche 1: Honest Recurrence Hints

**Status:** Implemented.

**Objective:** expose bounded, refresh-resistant recurrence metadata on current
signals and render it consistently.

1. Extend each local signal-history record with distinct UTC observation days.
2. Keep at most the last 30 observation days and migrate old records by seeding
   available first/last-seen days.
3. Add additive signal DTO fields:
   - `observedDays7d`;
   - `observedDays30d`;
   - `recurring` when observed on at least two distinct days in the last 7 days.
4. Render a shared lightweight hint such as **Seen 4 days in 7d** in Dashboard,
   namespace Signals, and resource Attention.
5. Explain in the tooltip that this counts distinct local observation days, not
   inferred incident resolutions.
6. Add persistence/history/UI tests and update user/dataplane/API docs.

## Tranche 2: Previous Decisions And Saved Context

**Status:** Implemented. The UI loads Investigation Snapshots once per active
context, indexes them against current signal identity, and surfaces the latest
explicit triage state and operator note through the shared signal-memory hint.

**Objective:** connect current signals to deliberate operator knowledge.

1. Match saved investigation snapshots by context, signal type, and primary
   resource identity.
2. Surface the latest applicable state:
   - **Previously resolved**;
   - **Known / watching**;
   - **Ignored / known noisy**;
   - **Last note: …**.
3. Let the hint open the matching saved investigation or its primary resource.
4. Avoid one API request per signal: load context snapshots once and index them in
   the UI or expose one backend-owned context index.
5. Keep resource notes and investigation notes distinct; do not silently merge
   user-authored text.

## Tranche 3: Transfer, Reset, And Retention Controls

**Objective:** make signal memory manageable operator-owned state.

1. Add explicit signal-history export/import coverage alongside acknowledgements
   and Investigation Snapshots.
2. Add reset operations scoped to context and, later, one signal identity.
3. Document retention and pruning behavior.
4. Keep reset local and reversible only through an exported backup.
5. Add round-trip, conflict, and reset tests.

## Semantics And Safety

- Distinct observation days are evidence of recurrence, not proof of separate
  outages.
- Absence from a partial/degraded dataplane response does not mean “resolved”.
- “Previously resolved” comes only from an explicit saved investigation state.
- No Signal Memory path performs a live Kubernetes read.
- History remains bounded and follows existing local dataplane persistence
  retention until explicit controls are added.
- API changes are additive so older clients can ignore memory fields.

## Verification

For each tranche:

1. run targeted Go and UI tests;
2. run `make check DOCKER_BUILD=0`;
3. run `make build DOCKER_BUILD=0`;
4. run `git diff --check`;
5. leave the tranche uncommitted unless Alex explicitly approves a commit.
