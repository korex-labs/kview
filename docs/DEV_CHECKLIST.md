# Development Checklist

This checklist must be used for:

- pull requests
- AI agent changes
- architectural refactors
- feature additions

The goal is to maintain **consistency, reuse, and architectural integrity**.

---

# 1. Reuse First

Before adding new code verify:

- an existing component does not already solve the problem
- a similar pattern already exists
- a shared helper could be reused

If duplication appears → extract a reusable abstraction.

---

# 2. No Copy‑Paste UI

Do NOT duplicate:

- table logic
- drawer layout
- action buttons
- mutation dialogs

Instead:

- extend existing components
- extract shared components

---

# 3. Use Shared Tokens

Avoid repeated style objects.

Use:

- UI tokens
- shared style helpers
- existing layout shells

Inline styles should be minimal.

---

# 4. Maintain UI Consistency

Verify:

- table density matches other views
- drawers use the standard layout
- actions appear in the correct location
- typography and spacing remain consistent

---

# 5. Respect Architecture

Ensure new code follows:

docs/UI_UX_GUIDE.md  
docs/ARCHITECTURE.md  
docs/API_READ_OWNERSHIP.md (when adding or changing GET / read routes)

If architecture changes → update documentation.

---

# 6. RBAC Awareness

Check that:

- UI actions respect `POST /api/capabilities`
- forbidden actions are hidden or disabled
- denial reasons are visible when needed

---

# 7. Mutation Framework

All mutations must go through:

POST /api/actions

Do not introduce direct mutation endpoints unless required by architecture.

---

# 8. Type Safety

Avoid:

any  
as any

Prefer:

- explicit interfaces
- typed API responses
- typed table row models

---

# 9. Remove Dead Code

Before finishing a change:

- remove unused helpers
- remove unused imports
- verify no orphan components remain

---

# 10. Tests

Backend changes should run:

go test ./...  
go vet ./...

Frontend changes should run:

npm run typecheck  
npm run lint

Add tests when modifying critical logic.

---

# 11. Logging and Errors

Verify:

- errors are structured
- activity runtime logs important operations
- mutation errors surface in the UI

---

# 12. Reviewability

Changes should produce:

- small logical commits
- clear diffs
- minimal unrelated changes

Avoid massive mixed refactors unless explicitly requested.

---

# 13. Final Question

Before merging ask:

"Does this change introduce duplication or architectural drift?"

If yes → refactor before merging.
