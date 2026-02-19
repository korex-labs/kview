# UI/UX Guide (Contract)

This document is the **UI/UX contract** for kview.
Update this guide **first**, then align code to it.

If implementation and this document disagree, either: 1) adjust code to
match the guide, or 2) update the guide intentionally and consistently.

------------------------------------------------------------------------

## 1. High-level principles

-   Local-first, fast, operator-oriented UI; no onboarding flow.
-   Drawer-based navigation model: lists stay visible, drawer is the
    detail surface.
-   Dense, scan-friendly layout (minimal chrome, minimal scrolling where
    possible).
-   Prefer explicit data over visual noise: tables, chips, and compact
    sections over charts.
-   View-first by default: the UI prioritizes clarity and navigation
    over control.
-   Mutations are allowed **only** behind explicit UX guardrails (see
    "Mutations Contract").

------------------------------------------------------------------------

## 2. Global layout conventions

-   **Main layout**: fixed top bar, permanent left sidebar, central list
    content.
-   **Right-side drawer**:
    -   opens from list row double-click or explicit "Open" button
    -   closes via close icon or outside click
    -   sits below the top bar, anchored right, dense width
-   **List ↔ drawer**: list remains visible and stable while drawer is
    open.
-   **Context & namespace**: all queries use the explicitly selected
    context; namespace applies to namespaced views.

------------------------------------------------------------------------

## 3. Navigation & grouping

-   Sidebar is grouped by meaning (not by raw Kubernetes kinds):
    -   Workloads, Networking, Configuration, Storage, Cluster, RBAC,
        Extensions, Helm
-   Labels are **human-readable** (e.g., "Persistent Volume Claims", not
    "PersistentVolumeClaims").
-   If a resource can reasonably deep-link to another, that link is a
    **first-class UX feature** (see §11).

------------------------------------------------------------------------

## 4. Tabs model

-   Tabs exist to keep dense data **predictably grouped**.
-   Tab names are short nouns: Overview, Pods, Spec, Rules, Subjects,
    Events, YAML, Logs.
-   Rules:
    -   Keep tab count small and consistent per resource.
    -   **Events and YAML are present in every drawer** (unless
        explicitly blocked by product decision).
    -   Logs appear only where relevant (currently Pods; Helm may have
        large text tabs).

------------------------------------------------------------------------

## 5. Standard detail layout

Detail drawers must use a consistent composition:

### 5.1 "Field title above value" rule (critical)

For detail views, the default layout is:

-   **Field title** is a small heading/label
-   **Value** (text or component) is placed **below** the title

Avoid "title: value" inline rows except for very short key/value pairs
in dense grids.

### 5.2 Preferred building blocks

Use these conceptual components (actual implementation may be different,
but behavior must match):

-   **Section**: titled block with divider; optional actions on the
    right
-   **KeyValueGrid**: dense grid of small field blocks (title above
    value)
-   **ChipsList**: list of chips for labels/annotations/selectors
-   **DataTable**: compact table for structured arrays (rules, subjects,
    versions, etc.)
-   **CodeBlock**: monospace, scrollable, copy-friendly block for YAML /
    logs / manifests / values

If a pattern appears in 2+ drawers, create or reuse a shared component.

### 5.3 Shared component catalogue

The following shared components live in `ui/src/components/shared/` and
**must** be used whenever the pattern applies. Do not re-implement
inline versions.

  -------------------------------------------------------------------------
  Component               File                      Purpose
  ----------------------- ------------------------- -----------------------
  `Section`               `Section.tsx`             Titled block with
                                                    divider

  `KeyValueTable`         `KeyValueTable.tsx`       Dense grid of
                                                    label/value pairs

  `MetadataSection`       `MetadataSection.tsx`     Labels & annotations
                                                    rendered as chips
                                                    (§6.2)

  `ConditionsTable`       `ConditionsTable.tsx`     Canonical conditions
                                                    table with health
                                                    highlighting (§6.4)

  `EventsList`            `EventsList.tsx`          Compact events table
                                                    with type chips

  `CodeBlock`             `CodeBlock.tsx`           Monospace, scrollable,
                                                    copy-friendly code/YAML
                                                    block

  `EmptyState`            `EmptyState.tsx`          Consistent "nothing
                                                    here" placeholder

  `ErrorState`            `ErrorState.tsx`          Inline error display

  `AccessDeniedState`     `AccessDeniedState.tsx`   RBAC-aware forbidden
                                                    state

  `ResourceLinkChip`      `ResourceLinkChip.tsx`    Clickable chip for
                                                    cross-resource
                                                    navigation (§11)
  -------------------------------------------------------------------------

**Key props & customisation hooks:**

-   **MetadataSection** --- `labels`, `annotations` (both
    `Record<string, string>`), `wrapInSection` (default `true`; set
    `false` when embedding inside an existing Accordion/Section).
-   **ConditionsTable** --- `conditions`, `isHealthy?` (custom health
    predicate; default: `status === "True"`), `chipColor?` (receives the
    full `Condition` object for resources with non-standard semantics,
    e.g. Node, Namespace), `variant?` (`"accordion"` \| `"section"`),
    `title?`.
-   **EventsList** --- `events`, `emptyMessage?`.
-   **CodeBlock** --- `code`, `language?`, `showCopy?`.

------------------------------------------------------------------------

## 6. Common fields: canonical rendering

### 6.1 Identity block (always in Overview)

Every drawer Overview must include a consistent identity summary (where
applicable): - Name - Namespace (namespaced resources) - Age / Created
at - UID (optional; show when useful) - Resource Version (optional)

### 6.2 Metadata (Labels & Annotations)

-   Labels and annotations must be rendered as **chips** (key=value).
-   Use the shared `MetadataSection` component --- do not inline chip
    rendering.
-   Long values:
    -   chip shows truncated value (\>64 chars)
    -   full value available via tooltip
-   If there are many entries:
    -   render as chips with wrap
    -   optionally add "Show all" / "Collapse" within the section

### 6.3 Status chips

Status-like enums must render as chips, consistently: - success:
healthy/ready/available - warning: pending/progressing/unknown - error:
failed/unhealthy

Unknown enum → default chip, and render missing values as "-".

### 6.4 Conditions table (canonical)

Use the shared `ConditionsTable` component. Columns: - Type - Status
(chip) - Reason - Message (wrap) - Last Transition (timestamp)

Rules: - Conditions section is always present. - Auto-expand when any
condition is unhealthy. - Unhealthy rows get a subtle highlight and
"Unhealthy" chip. - Resources with non-standard health semantics
(e.g. Node, Namespace) must pass custom `isHealthy` and/or `chipColor`
callbacks to `ConditionsTable`.

------------------------------------------------------------------------

## 7. Formatting rules (global)

-   **Date/time**: `YYYY-MM-DD HH:MM:SS`
-   **Age**:
    -   list/table: compact (e.g., `2d 3h`, `4h 12m`, `8m`)
    -   detail: single unit (e.g., `2d`, `4h`, `8m`, `30s`)
-   **Missing values**: always render as `-`
-   **Monospace**:
    -   use for identifiers and code-like values in dense grids
    -   YAML/Logs/Manifest/Values must be monospace + scrollable +
        copy-friendly
    -   line numbers for YAML/logs if already implemented

------------------------------------------------------------------------

## 8. Tables & lists

-   List views use compact tables with:
    -   text filter
    -   refresh interval selector
    -   last refresh timestamp
    -   single selection + Open + double-click
-   Default sort: name ascending (unless resource semantics strongly
    suggest otherwise).
-   Detail tables are used for structured arrays (rules, subjects,
    versions, ports, endpoints, etc.).
-   Truncation:
    -   list tables: tight columns; long fields may truncate
    -   detail views: wrap long values by default

------------------------------------------------------------------------

## 9. Error, empty, and access-denied states

-   The UI must not break on partial data; unknown/missing values are
    safe.
-   Errors render **inside** the content surface (do not blank the whole
    app).
-   Empty states are explicit ("No X found...").
-   AccessDenied is distinct from empty:
    -   use AccessDeniedState when forbidden
    -   never pretend forbidden lists are empty
-   Global connection banner (backend unreachable/recovered) complements
    per-view errors and must not spam.

------------------------------------------------------------------------

## 10. Warnings and insights

-   Soft warnings are advisory, never blocking.
-   Warnings should be conservative to avoid false positives.
-   Render warnings as a dedicated "Warnings" section **only when there
    is at least one warning**.

------------------------------------------------------------------------

## 11. Cross-links (deep links) contract

If two resources can be linked in a meaningful way, implement it
**immediately** (best-effort), and keep it bidirectional when
reasonable.

Examples: - Deployment ↔ ReplicaSets ↔ Pods - Service ↔ Ingresses - PVC
↔ PV - RoleBinding → Role/ClusterRole - ServiceAccount → RoleBindings
(best-effort) - Helm Release → owned resources (via manifest parsing
with `ResourceLinkChip`) - Helm Release → CRDs created/used
(best-effort, when feasible)

Rules: - Links must be safe under partial RBAC (target may show
AccessDenied). - Prefer links in Overview or the most relevant tab, not
hidden deep.

------------------------------------------------------------------------

## 12. Contract-driven refactoring

If you notice inconsistent rendering (e.g., metadata as plain text in
one drawer and chips in another), the fix should be: 1) Update/add
shared components 2) Align all drawers to the shared components 3) Keep
this guide updated as the contract

------------------------------------------------------------------------

## 1.x Mutations Contract (Cluster Changes)

kview is **view-first**, but supports a controlled set of cluster
mutations (Milestone 2+).

### Availability rules

-   Actions MUST be RBAC-aware.
-   If an action is not permitted, it MUST be:
    -   hidden, or
    -   disabled with a short reason (preferred when discoverability
        matters).

### Confirmation rules

-   Destructive actions (e.g., delete, helm uninstall) MUST require
    confirmation.
-   For high-risk actions (delete, uninstall), use **typed
    confirmation**:
    -   user must type the exact resource name (or release name) to
        proceed.

### Execution rules

-   Actions MUST run through the backend (no direct client-side
    kubectl-like logic).
-   UI MUST show:
    -   loading/progress state while action runs
    -   success confirmation (non-intrusive)
    -   inline error near the action **with details** (and optional
        toast)

### Error presentation

-   Errors MUST be actionable and specific:
    -   Forbidden → show AccessDenied and the attempted verb/resource
    -   NotFound → show "Already deleted / no longer exists"
    -   Conflict → show "Resource changed; refresh and retry"
-   Do not bury errors in logs-only surfaces.

### Placement and consistency

-   Actions belong in the **Section header right side** (or an Actions
    menu) inside a drawer.
-   Use shared confirmation dialog and shared action button patterns.
-   Do not introduce ad-hoc button styles.

------------------------------------------------------------------------

# 13. Unified Mutation UI Framework (Milestone 2+)

kview supports cluster mutations in a controlled, consistent manner.

All mutations MUST use a **single unified mutation dialog system**.\
Per-resource custom dialogs are not allowed.

This framework extends the existing Mutations Contract and standardizes:

-   action discovery
-   dialog layout
-   confirmation patterns
-   execution feedback
-   error handling
-   result presentation

The goal is to prevent mutation UX fragmentation as the number of
supported actions grows.

------------------------------------------------------------------------

## 13.1 Action Trigger Rules

-   Actions are rendered in the **Section header right side** (or inside
    a consistent Actions menu).
-   Actions MUST be RBAC-aware.
-   If not permitted, the action MUST be:
    -   hidden, or
    -   disabled with a short reason (preferred when discoverability
        matters).

Clicking an action MUST open the unified Mutation Dialog.

Inline destructive buttons bypassing the dialog are not allowed.

------------------------------------------------------------------------

## 13.2 Mutation Dialog --- Canonical Layout

All mutation dialogs MUST follow this structure:

1.  **Header**

    -   Action title
    -   Short description (if applicable)
    -   Risk indicator (for medium/high risk actions)

2.  **Target Summary**

    -   Kind
    -   Name
    -   Namespace (if applicable)
    -   Context

3.  **Inputs Section (optional)**

    -   Rendered using shared components
    -   Must follow the "title above value" rule
    -   Fields must be compact and scan-friendly
    -   YAML / large text inputs MUST use canonical CodeBlock component

4.  **Confirmation Section (when required)**

5.  **Execution State**

    -   Primary button shows loading/progress
    -   Dialog cannot be re-submitted while running
    -   Dialog must not silently close during execution
    -   Cancellation behavior must be consistent

6.  **Result Surface**

    -   Success: compact confirmation
    -   Error: inline error with expandable details
    -   Errors must not be hidden in logs-only surfaces
    -   Forbidden/NotFound/Conflict must follow Mutations Contract
        semantics

The structure must remain visually consistent across all resource types.

------------------------------------------------------------------------

## 13.3 Confirmation Modes

Mutation confirmation MUST use standardized modes:

-   **none** --- allowed for low-risk actions
-   **simple** --- explicit confirm button
-   **typed** --- user must type exact resource name (or required token)

Typed confirmation is mandatory for: - delete - uninstall - other
high-risk actions

Execution MUST be blocked until confirmation requirements are satisfied.

------------------------------------------------------------------------

## 13.4 Execution & Feedback Rules

-   All mutations MUST run through backend endpoints.
-   No frontend-side mutation logic is allowed.
-   UI MUST display:
    -   loading state
    -   non-intrusive success feedback
    -   actionable error details

Errors MUST be explicit and categorized:

-   Forbidden → show attempted verb/resource
-   NotFound → indicate resource no longer exists
-   Conflict → advise refresh and retry
-   Unknown → structured error message with details

Do not use toast-only error reporting.

------------------------------------------------------------------------

## 13.5 Field Rendering Discipline

Input fields inside mutation dialogs:

-   Must follow shared component patterns.
-   Must remain compact and operator-focused.
-   Must avoid complex multi-step workflows unless explicitly approved.
-   Must not introduce new UI patterns without updating this guide.
-   If a field pattern is reused across 2+ mutation types, extract a
    shared component.

Ad-hoc field rendering patterns are not allowed.

------------------------------------------------------------------------

## 13.6 Consistency Enforcement

If multiple resources implement similar actions (e.g., delete, restart,
scale), their mutation dialogs MUST feel identical in structure and
behavior.

If inconsistency appears:

1.  Refactor to shared components.
2.  Align all existing dialogs.
3.  Update this guide if behavior intentionally changes.
