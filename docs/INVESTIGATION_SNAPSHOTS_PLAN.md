# Investigation Snapshots Implementation Plan

**Goal:** Turn existing `Investigate Signal` results into durable local operator snapshots that can be reviewed from resources, notes, activity, search, and future incident reports.

**Architecture:** Reuse the current signal investigation API and UI as the capture point. Persist snapshots in kview's local application storage model, expose them through small REST APIs, and surface them in existing local-knowledge UI surfaces without writing anything back to Kubernetes.

**Verification:** Each implementation tranche should end with targeted tests, then full `make check DOCKER_BUILD=0` and `make build DOCKER_BUILD=0` before handoff.

---

## Scope

### In scope

- Local persisted investigation snapshot model.
- API create/list/get/delete operations.
- **Save Investigation** action from the existing investigation dialog.
- Snapshot list/indicators from resource-local surfaces.
- Integration with resource notes and search at a lightweight level.
- Settings/profile export/import coverage.
- User docs and dataplane/API docs.

### Out of scope for this first pack

- Automatic AI summaries.
- Writing snapshot metadata to Kubernetes annotations.
- Multi-user collaboration or server-side sync.
- Full graph UI.
- Complex incident workspace model.
- Signal suppression/snooze rules; those are the next pack.

---

## Data Model

Add a local snapshot record similar in spirit to resource notes and settings-owned local data.

Suggested fields:

```ts
type InvestigationSnapshot = {
  id: string;
  context: string;
  createdAt: number;
  updatedAt: number;
  title: string;
  triageState: "watching" | "investigating" | "known" | "resolved" | "ignored";
  signal: {
    type: string;
    title?: string;
    severity?: string;
    category?: string;
    observedAt?: number;
  };
  primaryResource: {
    kind: string;
    namespace?: string;
    name: string;
    uid?: string;
  };
  relatedResources: Array<{
    kind: string;
    namespace?: string;
    name: string;
    uid?: string;
  }>;
  relatedSignalTypes: string[];
  markdown: string;
  operatorNote?: string;
  runbookUrls?: string[];
  source: "investigate-signal";
};
```

Backend Go types should mirror this shape with JSON tags and preserve unknown-free, explicit fields.

---

## Tranche 1: Backend/local-store foundation

**Objective:** Persist and retrieve investigation snapshots locally without touching Kubernetes.

**Likely files:**

- `internal/dataplane/...` or existing local app-state/settings storage package after inspection.
- Existing resource-notes storage/API files.
- API route registration files.
- New/updated backend tests near the storage/API package.

**Tasks:**

1. Inspect existing resource notes storage and settings transfer code.
2. Add `InvestigationSnapshot` backend DTO/model.
3. Add local persistence helpers:
   - create/update snapshot;
   - list by context;
   - list by resource identity;
   - get by id;
   - delete by id.
4. Add HTTP endpoints:
   - `GET /api/investigations/snapshots`
   - `POST /api/investigations/snapshots`
   - `GET /api/investigations/snapshots/{id}`
   - `DELETE /api/investigations/snapshots/{id}`
5. Add tests for:
   - create/list/get/delete;
   - resource-scoped list;
   - context isolation;
   - malformed payload rejection;
   - no Kubernetes client call on snapshot operations.

**Targeted verification:**

```bash
make check DOCKER_BUILD=0
```

For faster iteration inside the Docker toolchain, use the package-specific Go tests discovered during implementation.

---

## Tranche 2: Save action in Investigate Signal UI

**Objective:** Let an operator save the current investigation result from the existing dialog.

**Likely files:**

- `ui/src/types/api.ts`
- existing signal investigation dialog/button components
- API client helpers
- frontend tests for the dialog

**Tasks:**

1. Add TypeScript types for `InvestigationSnapshot` and API request/response shapes.
2. Add API client helpers for snapshot create/list/delete.
3. Add **Save Investigation** action to the investigation dialog.
4. Provide a compact form or inline fields for:
   - title;
   - triage state;
   - optional operator note;
   - optional runbook URL.
5. Pre-fill title from signal type + resource identity.
6. Save the existing Markdown bundle exactly as generated.
7. Show success/error feedback through the existing notification pattern.
8. Add UI tests for:
   - save button presence;
   - prefilled title;
   - API payload shape;
   - success state;
   - error state.

**Targeted verification:**

```bash
# Use the repo's Docker-backed frontend test path; exact target depends on existing scripts.
make check DOCKER_BUILD=0
```

---

## Tranche 3: Resource drawer and Notes integration

**Objective:** Make saved investigations visible where operators already look for local resource context.

**Likely files:**

- resource drawer components;
- Notes tab components;
- resource notes/list indicator components;
- frontend tests.

**Tasks:**

1. Add a resource-scoped snapshot query hook.
2. Show saved investigation count/state in the resource drawer.
3. Add a **Saved investigations** section to the Notes tab or local-knowledge area.
4. Display title, triage state, signal type, created time, and a view/delete action.
5. Allow opening the saved Markdown bundle in a read-only detail view.
6. Ensure the existing resource-list **Notes** indicator can reflect snapshot presence if the resource has no free-form note yet.
7. Add tests for:
   - resource identity matching;
   - count indicator;
   - list rendering;
   - deletion confirmation;
   - no false indicator for other contexts/namespaces.

---

## Tranche 4: Search and Activity integration

**Objective:** Make saved investigations discoverable without creating a new top-level product surface.

**Likely files:**

- global search backend/frontend enrichment paths;
- Activity view components;
- API types/tests.

**Tasks:**

1. Add local snapshot presence/count to cached search result enrichment when resource identity matches.
2. Show a compact `Investigation`/`Snapshot` chip in global search results.
3. Add an Activity entry group for recent saved investigations.
4. Keep search matching local/cached; do not query Kubernetes.
5. Add tests for:
   - search enrichment with snapshot count;
   - search result rendering;
   - Activity recent snapshots;
   - context isolation.

---

## Tranche 5: Export/import and docs

**Objective:** Treat investigation snapshots as explicit local operator knowledge that can move with settings/profile transfer.

**Likely files:**

- settings export/import helpers;
- profile backup/restore code;
- `docs/user/navigation.md` or relevant workflow docs;
- `docs/user/import-export.md`;
- `docs/DATAPLANE.md`;
- `docs/API_READ_OWNERSHIP.md`.

**Tasks:**

1. Include snapshots in full settings export/import.
2. Decide whether profile-specific exports include snapshots by default or via an explicit section. Prefer explicit naming in UI.
3. Add import conflict behavior:
   - preserve distinct ids when possible;
   - avoid duplicates by stable identity/title/createdAt hash;
   - report imported/skipped counts.
4. Update user docs:
   - saving investigations;
   - where snapshots appear;
   - export/import behavior;
   - local-only/no Kubernetes annotation guarantee.
5. Update API/dataplane docs for local snapshot ownership.
6. Add tests for export/import round trip and duplicate handling.

---

## Full Verification Gate

At the end of the complete pack:

```bash
git status --short --branch
make check DOCKER_BUILD=0
make build DOCKER_BUILD=0
git diff --check
```

Expected:

- checks pass through the pinned Docker toolchain;
- production build succeeds;
- markdown/docs are updated;
- worktree remains uncommitted unless Alex explicitly asks for a commit.

---

## Follow-up Packs

After snapshots are working, continue with:

1. Signal Memory / Recurring Incident Detection.
2. Signal Snooze and Suppression Rules.
3. Connectivity/Routing detector pack.
4. Impact Path drawer.
5. Dataplane Explanation drawer.
6. Search query mini-language.
7. Exportable incident reports.
