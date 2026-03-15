# AI Agent Development Rules

This document defines **strict rules for AI agents working on the kview repository**.

---

# Reuse Over Duplication

Always search for existing components before implementing new ones.

Prefer extending existing logic instead of duplicating code.

---

# Extract Reusable Components

If similar logic appears multiple times:

1. extract shared logic
2. create reusable helpers
3. refactor callers

---

# Use UI Tokens

Avoid introducing inline styles.

Use shared tokens and layout helpers.

---

# Follow UI Architecture

All UI code must follow:

docs/UI_UX_GUIDE.md

Do not invent new UI patterns without updating documentation.

---

# Maintain Consistent UX

Preserve:

- table density
- drawer layout
- action placement
- terminology

---

# Preserve Type Safety

Avoid introducing:

any  
as any

Prefer explicit interfaces.

---

# Respect Backend Mutation Architecture

All mutations must use:

POST /api/actions

and be registered via ActionRegistry.

---

# Respect RBAC Awareness

UI actions must respect:

/api/capabilities

Never bypass capability checks.

---

# Avoid Dead Code

Remove unused helpers and components.

Do not introduce experimental code without purpose.

---

# Documentation Updates

If architecture changes, update:

- README
- UI_UX_GUIDE
- ARCHITECTURE_PRINCIPLES

---

# Quality Checks

Backend:

go test ./...  
go vet ./...

Frontend:

npm run typecheck  
npm run lint

Tests should accompany important logic changes.
