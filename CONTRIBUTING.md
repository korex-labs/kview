# Contributing

This repository is currently developed primarily by a single maintainer.

Contributions are welcome, but the workflow is intentionally lightweight.

---

## Development workflow

1. Open an issue (optional but recommended for larger changes)
2. Make small, focused commits
3. Prefer clarity over cleverness
4. Verify context switching with multiple kubeconfigs (no `.envrc` dependency)

---

## Prerequisites

- Docker, for the pinned build toolchain used by `make`, `make check`, `make build`, and `make build-release`
- Go 1.26+, Node.js 22+, and npm only for explicit maintainer debugging with `local-*` Makefile targets

---

## Code style

- Go:
  - follow standard `gofmt`
  - avoid premature abstractions
- UI:
  - React + MUI
  - keep components readable and local
  - avoid over-engineering state management

---

## Safety rules

Any feature that mutates cluster state (delete pod, restart workload, etc.)
must:

- be explicit (no hidden side effects)
- require a clear user action
- include a confirmation step
- surface errors clearly

---

## AI-assisted development

AI assistance is expected and encouraged.

Rules for AI-generated changes:
- Prefer full-file replacements for non-trivial edits
- Avoid partial diffs that are hard to apply
- Keep documentation up to date
- Read `README.md`, `docs/AI_AGENT_RULES.md`, `docs/AI_BOOTSTRAP_PROMPT.md`, `docs/DEV_CHECKLIST.md`, `docs/ARCHITECTURE.md`, `docs/DATAPLANE.md`, `docs/API_READ_OWNERSHIP.md`, and `docs/UI_UX_GUIDE.md` before implementation
- Run verification with `make check` and build verification with `make build`; do not call host `go`, `npm`, `node`, or `local-*` targets unless explicitly asked
- Never commit, amend, tag, push, or mutate Git history/remotes unless specifically requested and confirmed by the project owner
- Suggest conventional commit messages with meaningful bodies when asked

See `docs/AI_AGENT_RULES.md` for details.
