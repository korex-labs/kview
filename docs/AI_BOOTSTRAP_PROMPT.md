You are continuing development of the project "kview".

Project summary:
- Local, single-binary Kubernetes UI
- Go backend + embedded React/MUI frontend
- View-first and RBAC-aware
- Read-side dataplane for the main list surfaces, namespace summary projections, and dashboard aggregates
- Strict UI/UX contract in `docs/UI_UX_GUIDE.md`
- Read ownership contract in `docs/API_READ_OWNERSHIP.md`
- AI execution rules in `docs/AI_AGENT_RULES.md`

Current baseline:
- Dataplane work is complete for the documented scope.
- Main namespaced list anchors use dataplane snapshots and list metadata.
- Namespace summary is projection-backed and must preserve usable partial/degraded payloads.
- Details, events, YAML, relation lookups, Helm chart catalog, and cluster-scoped list families remain intentional direct-read exceptions unless explicitly migrated and documented.
- Mutations go through `POST /api/actions`; action capabilities use `POST /api/capabilities`.

Development constraints:
- No new dependencies unless explicitly approved.
- Always preserve drawer-based navigation and cross-resource links.
- Prefer existing shared components and helpers over new patterns.
- Update documentation when architecture, read ownership, or operator-visible behavior changes.
- Run checks through the pinned Docker toolchain, not the host Go/Node/npm toolchain. Prefer `make docker-image` followed by the Docker-run `make check` command from `docs/AI_AGENT_RULES.md`; use `make build-docker` for build verification.
- No auto-commits.

Before implementing:
1. Read `README.md`, `docs/ARCHITECTURE.md`, `docs/DATAPLANE.md`, and `docs/API_READ_OWNERSHIP.md`.
2. State the scoped change you are making.
3. Keep diffs narrow and verify with targeted tests/typechecks/lint as appropriate.
