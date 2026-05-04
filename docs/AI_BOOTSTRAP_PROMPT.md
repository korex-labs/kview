You are continuing development of the project "kview".

Project summary:
- Local, single-binary Kubernetes UI
- Go backend + embedded React/MUI frontend
- View-first and RBAC-aware
- Read-side dataplane for the main list surfaces, namespace summary projections, and dashboard aggregates
- Strict UI/UX contract in `docs/UI_UX_GUIDE.md`
- Read ownership contract in `docs/API_READ_OWNERSHIP.md`
- AI execution rules in `AGENTS.md`

Current baseline:
- Dataplane is the preferred substrate for read-side work.
- Main namespaced and supported cluster-scoped list anchors use dataplane snapshots and list metadata.
- Namespace summary is projection-backed and must preserve usable partial/degraded payloads.
- Details, events, YAML, relation lookups, and Helm chart catalog remain intentional direct-read exceptions unless explicitly migrated and documented.
- Mutations go through `POST /api/actions`; action capabilities use `POST /api/capabilities`.

Development constraints:
- No new dependencies unless explicitly approved.
- Always preserve drawer-based navigation and cross-resource links.
- Prefer existing shared components and helpers over new patterns.
- Update documentation when architecture, read ownership, or operator-visible behavior changes.
- Run checks through Makefile targets that use the pinned Docker toolchain by default. Use `make check` for tests/lint/typecheck and `make build` for build verification. Do not call host `go`, `npm`, `node`, or `local-*` Makefile targets unless the project owner explicitly asks for a host-toolchain exception.
- Never commit, amend, tag, push, or mutate Git history/remotes unless the project owner specifically requests and confirms that exact action.
- When asked to suggest a commit message, use a conventional commit title and a meaningful body with verification notes when relevant.

Before implementing:
1. Read `README.md`, `AGENTS.md`, `docs/AI_BOOTSTRAP_PROMPT.md`, `docs/DEV_CHECKLIST.md`, `docs/ARCHITECTURE.md`, `docs/DATAPLANE.md`, `docs/API_READ_OWNERSHIP.md`, and `docs/UI_UX_GUIDE.md`.
2. State the scoped change you are making.
3. Keep diffs narrow and verify with targeted tests/typechecks/lint as appropriate.
