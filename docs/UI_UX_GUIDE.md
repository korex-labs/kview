# UI / UX Guide

This document defines the **UI architecture contract** for kview.

The UI must remain:

- consistent
- predictable
- reusable
- operator‑friendly

---

# Navigation Model

kview uses **drawer-based navigation**.

Pattern:

List → Row → Drawer

The list remains visible while the drawer displays resource details.

---

# Resource List Pattern

All resource lists follow the same layout:

Toolbar  
DataGrid  
Footer  
Drawer

Lists must support:

- sorting
- filtering
- selection
- refresh

---

# Drawer Pattern

Drawers are the primary inspection surface.

Typical structure:

Header  
Tabs  
Content Sections

Drawers should stay compact and information‑dense.

---

# UI Tokens

UI tokens define:

- spacing
- drawer width
- typography
- colors
- table density

Tokens must be reused instead of inline styles whenever possible.

---

# Component Reuse

Common patterns must be extracted into reusable components.

Examples:

- resource table patterns
- action buttons
- mutation dialogs
- drawer shells

Avoid copy‑paste implementations.

---

# Capability‑Aware UI

Actions must respect RBAC capabilities.

The UI queries:

/api/capabilities

Actions must:

- hide if unavailable
- disable if forbidden
- show denial reason when needed

---

# Cross‑Resource Navigation

Navigation between related resources should be first‑class.

Examples:

Pod → Node  
Service → Pods  
Deployment → ReplicaSets

These links open new drawers.

---

# Error Handling

Errors must be:

- visible
- structured
- consistent

Prefer mutation dialogs and activity logs for error reporting.

---

# Consistency Rules

Maintain consistent:

- typography
- spacing
- drawer layouts
- action placement
- table density
