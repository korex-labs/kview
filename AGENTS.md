# Agent Instructions

These instructions define how AI agents should operate in this repository.

---

## Core Principles

- Read existing code and documentation before making changes.
- Prefer small, scoped changes over broad refactors.
- Preserve architecture, naming, and patterns already in use.
- Reuse existing logic before introducing new abstractions.
- Favor clarity over cleverness.

---

## Scope Discipline

Before implementation:

- Clearly state the scoped change being made.
- Do not mix unrelated work into the same change.
- Avoid opportunistic refactors unless necessary.

If the request is ambiguous:

- Make a reasonable assumption and proceed.
- Only ask questions if the risk of being wrong is significant.

---

## Project Structure

Respect and maintain the repository structure.

- Place new code in appropriate directories.
- Do not introduce new top-level folders without strong justification.
- Keep related logic grouped together.
- Avoid dumping files in generic locations (e.g., root, utils) without pattern alignment.

If structure is unclear:

- Infer from existing patterns and follow them consistently.

---

## Reuse First

Before adding new code, check for:

- existing utilities or helpers
- shared components or modules
- established patterns (API, CLI, services, etc.)
- test patterns

If duplication appears:

- extract shared logic instead of copying.

---

## Dependencies

- Prefer standard library or existing dependencies.
- Do not introduce new dependencies without clear justification.
- Avoid heavy or unnecessary libraries.
- Match the project's existing dependency style.

---

## Code Style & Formatting

- Follow the existing code style.
- Respect configured formatters and linters.
- Do not reformat unrelated files.
- Keep diffs minimal and focused.

If formatting tools exist:

- use them (e.g., make fmt, npm run lint, etc.)

---

## Type Safety / Correctness

- Avoid weak typing and implicit assumptions.
- Use explicit types, interfaces, or schemas where applicable.
- Validate external inputs and API boundaries.

---

## Configuration & Environment

- Do not hardcode secrets or environment-specific values.
- Use environment variables where appropriate.
- Update .env.example when adding new variables.
- Keep configuration centralized and predictable.

---

## Tooling & Repo Hygiene

Ensure the repository remains clean and usable:

- Respect .gitignore (do not commit generated or local files)
- Check for:
  - .editorconfig
  - lint configs
  - formatter configs
- Align with existing development tooling

If missing and clearly beneficial, suggest adding:

- .editorconfig
- basic linting/formatting setup
- minimal CI checks

---

## Testing & Verification

Use risk-proportional verification. Do not turn every small change into a full
release-candidate run.

### Verification tiers

- **Read-only analysis, planning, or advice:** inspect only the minimum relevant
  context; do not run tests or builds.
- **Docs/text-only change:** run the relevant formatter or `git diff --check`;
  do not run the application build unless the docs pipeline itself changed.
- **Small UI change:** run the directly affected UI test(s), and typecheck only
  when TypeScript changed. Do not run full `make check` plus `make build` for a
  local layout/copy adjustment.
- **Small backend change:** run the directly affected Go package test(s). Add a
  broader package test only when the changed contract is shared.
- **Coherent feature tranche / commit boundary:** run targeted tests first, then
  one `make check DOCKER_BUILD=0` and one `make build DOCKER_BUILD=0` after the
  tranche is complete.
- **Release boundary or cross-cutting infrastructure change:** run the full clean
  verification matrix and any release-specific audit.

Do not repeat a passing expensive gate after a follow-up that cannot affect it.
When a bounded build/test is started in the background, request completion
notification and continue other independent work; do not poll it every minute.
Use subagents only for genuinely independent or review-heavy workstreams, not
for ordinary scoped fixes or planning questions.

Run existing verification steps appropriate to the selected tier:
  - tests
  - linters
  - build checks

Examples:

```
make check
make build
npm test
go test ./...
```

- Add tests when:
  - introducing logic
  - fixing bugs
  - modifying shared behavior

If tests cannot be run:

- clearly state why
- describe remaining risks

---

## Mutations & Side Effects

Any operation affecting external systems must be explicit.

- Do not introduce hidden side effects
- Avoid unexpected network, filesystem, or DB operations
- Require clear intent for destructive or irreversible actions

---

## Documentation

Documentation is part of the contract.

Update documentation when changing:

- architecture
- APIs
- workflows
- setup or tooling
- user-facing views, controls, actions, settings, or troubleshooting behavior

Keep documentation aligned with current behavior.

End-user documentation lives in `docs/user/` and is consumed by in-app Help.
When adding or changing a user-facing feature:

- follow the documentation structure and formatting rules in `docs/user/CONTRACT.md`
- update the relevant `docs/user/*.md` page in the same change
- update `docs/user/manifest.json` when adding, renaming, or removing a help page
- keep engineering-only docs such as architecture, dataplane, and API ownership outside in-app Help unless the content is useful to end users

Do not edit `docs/user/whats-new.md` during normal development. The
release-note helper updates both `CHANGELOG.md` and the curated
`docs/user/whats-new.md` highlights during release preparation through
`make release-notes TAG=vX.Y.Z` or `make release-tag TAG=vX.Y.Z`.

---

## Git Discipline

- Do not create commits, push, or modify history unless explicitly requested.
- Do not revert user changes without instruction.

When asked for a commit message:

Use Conventional Commits:

type(scope): short summary

Detailed explanation of what changed and why.

Verification:
- ...

---

## Planing and reasoning

If provided with a big/complex prompt, decided if planning step if needed and if so,
suggest and agree on the plan first, then split it into implementation steps and
implement step-by-step with intermediate tests and verifications.

Upon each step completion, clearly state completed steps and pending steps,
so that user clearly understands the progress and current state.

---

## Final Response

When work is complete, provide:

- what changed
- key files touched
- verification performed
- any risks or limitations

Keep it concise and practical.
