# Resource Map Visual UX v2 Implementation Plan

## Current status

Visual UX v2 and the subsequent Helm manifest-map extension are implemented and
locally accepted, committed as `00726c2` and `b9d5650`. The task sequence below
is implementation history, not an unstarted release dependency. Shared
Dataplane Explanation subsequently landed as `1387128`; see
[Roadmap](../ROADMAP.md) for the current queue and release boundaries.

> **For Hermes:** Implement this plan as one coherent UI tranche, preserving the existing cache-only Resource Map API and relationship semantics.

**Goal:** Replace the hand-positioned Resource Map SVG with a polished, accessible, responsive graph canvas that preserves exact graph evidence while making identities and relationships easier to inspect.

**Architecture:** Keep `ResourceMapPanel` responsible for authenticated fetching, cache/coverage status, rollout-history grouping, and evidence summaries. Add a lazy-loaded `@xyflow/react` renderer backed by a pure deterministic `@dagrejs/dagre` graph-model adapter. Render custom MUI nodes and edges with hover/focus details; never fetch resource details from graph interactions.

**Tech Stack:** React 19, TypeScript, MUI 9, `@xyflow/react`, `@dagrejs/dagre`, Vitest, Playwright, Vite 8.

---

## Product Contract

The v2 graph must:

- preserve the existing cache-only Resource Map response and all backend traversal semantics;
- retain parent/current/child direction, depth-2 bounds, exact returned/total counts, truncation, coverage, confidence, and rollout-history behavior;
- show common resource names without single-line ellipsis and expose every full identity on hover and keyboard focus;
- expose relationship type, confidence, resolution, source path, description, and selector evidence from the existing edge contract;
- support fit-to-view, zoom, pan, center/reset, drawer resize, full-screen drawers, and history relayout;
- keep present supported resources clickable and keyboard-openable through stacked drawers;
- remain read-only: no node dragging, connection editing, persisted coordinates, hidden Kubernetes reads, or arbitrary topology expansion;
- load the graph stack only when Resource Map is opened and isolate it in a graph vendor chunk;
- preserve a useful semantic/accessibility surface if visual transforms are unavailable.

The first v2 tranche deliberately does not add per-kind live status, minimap, image export, arbitrary graph expansion, force-directed layout, or user-selectable layout algorithms.

## Library Decision

Use:

- `@xyflow/react` for the DOM-based graph viewport, controls, custom nodes, custom edges, and fit/pan/zoom behavior;
- `@dagrejs/dagre` for deterministic top-to-bottom layered layout.

Keep the layout adapter independent of React Flow rendering. If representative real maps prove that Dagre cannot route current depth-2 cycles or fan-out acceptably, retain the renderer and replace only the adapter with `elkjs`; do not ship both engines.

---

### Task 1: Reset the post-release roadmap

**Objective:** Make the active queue reflect the shipped v5.16.0 state and the agreed next sequence.

**Files:**

- Modify: `docs/ROADMAP.md`
- Create: `docs/plans/2026-09-01-resource-map-v2.md`

**Steps:**

1. Mark v5.16.0 release preparation and Resource Map v1 as shipped.
2. Add Resource Map Visual UX v2 as the active first tranche.
3. Resolve the Runbook/Workspace ordering mismatch.
4. Keep Dataplane Explanation, Search Mini-Language, Runbooks/Workspaces, and Reports in the agreed order.
5. Run `git diff --check`.

### Task 2: Add graph dependencies and lazy chunking

**Objective:** Add only the two selected graph dependencies without increasing the initial application chunk.

**Files:**

- Modify: `ui/package.json`
- Modify: `ui/package-lock.json`
- Modify: `ui/vite.config.ts`
- Modify: `ui/src/components/shared/ResourceMapPanel.tsx`

**Steps:**

1. Add exact compatible ranges for `@xyflow/react` and `@dagrejs/dagre` with the pinned npm toolchain.
2. Add a `resource-map-vendor` manual chunk for React Flow, XYFlow system, Dagre, and Graphlib.
3. Lazy-load the graph renderer from the panel with an accessible loading fallback.
4. Verify clean lockfile install and production chunk output.

### Task 3: Build a pure deterministic graph model

**Objective:** Convert the existing Resource Map response into deterministic React Flow nodes, edges, incident summaries, and Dagre positions.

**Files:**

- Create: `ui/src/components/shared/resourceMapGraphModel.ts`
- Create: `ui/src/components/shared/resourceMapGraphModel.test.ts`

**Steps:**

1. Write failing tests for parent/current/child vertical ordering, deterministic input ordering, broad fan-out, cycles/bidirectional nodes, and full edge metadata.
2. Stable-sort nodes and edges before inserting them into Dagre.
3. Use a top-to-bottom layered layout with fixed card dimensions and sufficient node/rank separation.
4. Carry the original typed node/edge DTOs plus incident edge summaries in renderer data.
5. Keep `uiNavigable` resolution in the adapter without changing API `navigable`.
6. Verify the focused model tests.

### Task 4: Add custom accessible node and edge presentation

**Objective:** Replace plain rectangles and lines with reusable MUI graph components and rich hover/focus explanations.

**Files:**

- Create: `ui/src/components/shared/ResourceMapGraphNode.tsx`
- Create: `ui/src/components/shared/ResourceMapGraphEdge.tsx`
- Create: `ui/src/components/shared/ResourceMapGraph.tsx`
- Create: `ui/src/components/shared/ResourceMapGraph.test.tsx`

**Steps:**

1. Render custom resource cards with Kind, wrapped identity, namespace, availability, direction, and ReplicaSet state.
2. Preserve exact full identity in the accessible name and a `describeChild` tooltip available by hover/focus.
3. Render type-specific edge labels/styles with a broad interaction path,
   distinct per-edge card anchors, and deterministic Dagre routes that preserve
   crossing minimization and avoid unrelated card bounds.
4. Show edge source, confidence, resolution, field path, description, selector, and exact endpoints in a hover/focus tooltip.
5. Add fit, wheel zoom, pinch zoom, pan, and center-current controls; disable dragging, connecting, selection mutation, and double-click zoom.
6. Re-fit when the target or visible history set changes and respond to drawer resizing.
7. Preserve click, Enter, and Space stacked-drawer navigation.
8. Verify graph component tests with ResizeObserver and geometry test shims limited to the test environment.

### Task 5: Preserve panel semantics and evidence

**Objective:** Keep rollout grouping, cache warnings, evidence summaries, stale-request cancellation, and empty/error states unchanged around the new renderer.

**Files:**

- Modify: `ui/src/components/shared/ResourceMapPanel.tsx`
- Modify: `ui/src/components/shared/ResourceMapPanel.test.tsx`

**Steps:**

1. Keep rollout-history filtering in a library-independent helper.
2. Pass only visible nodes/edges to the lazy renderer.
3. Keep evidence summaries based on the full server response.
4. Preserve exact full/partial/truncated messaging and request cancellation tests.
5. Update navigation tests for focusable non-navigable tooltip nodes without making them actionable.

### Task 6: Document and visually verify the workflow

**Objective:** Make the new graph controls and evidence behavior part of the user contract and catch visual regressions.

**Files:**

- Modify: `docs/user/resource-drawers.md`
- Modify: `ui/e2e/screenshots.spec.ts`

**Steps:**

1. Document fit/pan/zoom, full identity tooltips, edge evidence tooltips, and read-only behavior.
2. Add Resource Map screenshot capture for a Deployment in normal and full-screen drawer modes when cache coverage is available.
3. Capture representative simple, rollout-history, partial, and dense fixtures in component tests.
4. Confirm no horizontal page scroll and no header overlap.

### Task 7: Verification and review

**Objective:** Verify the coherent UI tranche and leave it ready for local visual acceptance.

**Steps:**

1. Run focused graph model, graph component, panel, drawer, and screenshot-helper tests.
2. Run UI typecheck and lint.
3. Run `make check DOCKER_BUILD=0` once.
4. Run `make build DOCKER_BUILD=0` once and compare graph/main chunk output.
5. Run a local live smoke against a Deployment with rollout history in normal and full-screen drawer modes.
6. Request an independent correctness/accessibility/bundle review.
7. Leave changes uncommitted for Alex's visual review and explicit commit approval.
