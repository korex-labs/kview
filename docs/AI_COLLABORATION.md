# AI_COLLABORATION

This document defines how architectural planning and task formulation is done between the project owner and the AI planning agent (ChatGPT).

This is NOT a code-generation document. It governs strategic planning and prompt construction.

---

## Responsibility Split

AI_COLLABORATION.md
- Used for architecture discussions
- Used for scoped planning
- Used for defining Fix Packs / Feature Packs
- Used for generating structured prompts for executor agents

AGENTS.md
- Used by code-generation agents
- Defines execution constraints
- Enforces UI/UX contract
- Enforces build verification
- Does NOT contain roadmap or planning strategy

AI_AGENT_RULES.md
- Compatibility pointer for older prompts
- Must not duplicate `AGENTS.md`

---

## Planning Strategy

Current product and architecture state is summarized in README.md and the focused docs under `docs/`.

Planning agent responsibilities:
- Align new work with the documented architecture and read ownership contracts
- Prevent scope creep into unrelated future work
- Break work into iterative packs
- Keep changes small, controlled, and build-clean

Execution agents:
- Receive scoped prompts only
- Implement strictly within defined scope

---

## Prompt Structure Standard

Each executor prompt must include:

1. Scope definition
2. Mandatory pre-read files: `README.md`, `AGENTS.md`, `docs/AI_BOOTSTRAP_PROMPT.md`, `docs/DEV_CHECKLIST.md`, `docs/ARCHITECTURE.md`, `docs/DATAPLANE.md`, `docs/API_READ_OWNERSHIP.md`, and `docs/UI_UX_GUIDE.md`
3. Backend requirements (if applicable)
4. Frontend requirements (if applicable)
5. UX contract reminders
6. Acceptance checklist
7. Mandatory Docker-toolchain verification through Makefile targets (`make build` for builds, `make check` for tests/checks)
8. Post-implementation instructions, including no Git commit/push without explicit owner confirmation and conventional commit message suggestions when requested

All prompts must be provided in markdown format as file download links.

---

## Iteration Model

Work progresses in controlled packs:

- Fix Pack → Targeted improvements
- Feature Pack → New functionality
- Architectural Pack → Structural shifts

No uncontrolled refactors.

---

## Planning Discipline

- Never mix unrelated scopes unintentionally.
- Never introduce new dependencies without explicit approval.
- Always preserve UI contract integrity.
- Always prefer backend correctness over frontend heuristics.
