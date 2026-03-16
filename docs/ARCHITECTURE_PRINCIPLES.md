# Architecture Principles

This document describes the **core architectural principles of kview**.

These principles guide both human developers and AI agents.

---

# Local‑First

kview runs locally as a single binary.

The UI and API are embedded inside the application.

External services are not required.

---

# View‑First UI

kview prioritizes **resource visibility** over automation.

The UI focuses on:

- inspection
- debugging
- operational clarity

---

# Drawer‑Based Exploration

The UI uses a drawer-based navigation model.

This allows:

- stable lists
- contextual inspection
- quick navigation

---

# Reusable UI Components

UI logic must be built from reusable components.

Avoid copy‑paste UI implementations.

Extract shared components whenever patterns repeat.

---

# Tokenized Styling

UI styling should rely on shared tokens instead of repeated inline styles.

Tokens define:

- spacing
- typography
- colors
- layout dimensions

---

# Action Framework

Mutations are implemented through a shared framework.

All actions use:

POST /api/actions

Actions are registered in the ActionRegistry.

---

# RBAC Awareness

kview must always respect Kubernetes RBAC.

Capabilities are detected via:

/api/capabilities

The UI must never expose forbidden actions.

---

# Activity Runtime

Long‑running operations must integrate with the activity runtime.

Examples:

- port forward
- terminal sessions
- Helm operations

---

# Observability

The system must expose clear runtime information via:

- activity logs
- structured errors
- operation status

---

# Maintainability

The codebase should prioritize:

- readability
- explicit architecture
- minimal duplication
- predictable structure

---

# Data Plane Boundary

Read-side cluster observation, capabilities, and projection metadata belong to the data plane subsystem.

- The data plane lives under `internal/dataplane`.
- Mutation logic continues to use the shared action framework.
- Data plane contracts must use explicit enums and structured types for capabilities, errors, and freshness.
