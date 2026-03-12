
# kview Phase 1B — UI Foundation Prompt

## Objective

Implement the **UI foundation layer** for `kview`.

This phase introduces:

- theme system (light / dark / system)
- bottom activity panel
- integration with Activity API
- placeholder operational surfaces

This phase **must not implement** terminal, port-forward, or analytics functionality.

The goal is to build the **UI structure that those features will later plug into**.

---

# Mandatory Reading

Before implementing anything, read:

docs/AI_COLLABORATION.md  
docs/AI_AGENT_RULES.md  
docs/UI_UX_GUIDE.md  

architecture/activity_panel_architecture.md  
architecture/kview_runtime_architecture.md  

prompts/phase1_master_prompt.md

---

# Scope

This phase implements only UI infrastructure.

It must include:

Theme system  
Bottom Activity Panel  
Activity API integration  
Operational UI placeholders

It must NOT include:

Terminal UI implementation  
Port-forward UI implementation  
Analytics dashboards  
Worker control UI

---

# Theme System

Add application-wide theme support.

Supported modes:

light  
dark  
system

---

## Requirements

### Theme Provider

Add a React context provider:

ThemeProvider

Responsibilities:

- store current theme
- expose setter
- read system preference when theme = system

### Theme Persistence

Theme should persist in local storage.

Example key:

kview_theme

### CSS Variables

All color styling must move to CSS variables.

Example:

:root {
  --bg-primary: #ffffff;
  --text-primary: #111111;
}

[data-theme="dark"] {
  --bg-primary: #0f1115;
  --text-primary: #e6e6e6;
}

Components must reference variables instead of fixed colors.

---

# Bottom Activity Panel

Introduce a **global bottom panel** similar to Lens.

This panel hosts long‑lived operational activities.

Examples:

terminal sessions  
port-forward sessions  
worker logs  
runtime events

For Phase 1 these will be **placeholders only**.

---

## Panel Behavior

The panel must:

- be globally visible
- sit at the bottom of the app
- be collapsible
- have tabs
- support empty state

---

## Tabs

Initial tabs:

Activities  
Sessions  
Logs

Each tab may show placeholder content initially.

---

## Empty State

When there are no activities:

Display:

"No active activities"

---

# Activity API Integration

The UI must query:

GET /api/activity

Display returned activities inside the **Activities tab**.

If the list is empty, show the empty state.

Future streaming behavior is not required in Phase 1.

---

# Layout Integration

The global layout becomes:

Top Navigation

Main Content Area

Right Drawer (resource details)

Bottom Activity Panel

This panel must not interfere with existing resource browsing.

---

# UX Rules

Follow `UI_UX_GUIDE.md`.

Key principles:

Main View
resource browsing

Right Drawer
resource details

Bottom Panel
operational runtime activity

---

# Implementation Notes

Prefer incremental change.

Do not rewrite the existing UI.

Add new components:

ActivityPanel  
ActivityTabs  
ActivityList

Keep styling consistent with current design.

---

# Acceptance Criteria

Phase is complete when:

Theme switching works.

Theme persists across reload.

Bottom Activity Panel renders correctly.

Panel can collapse/expand.

Activities tab fetches data from `/api/activity`.

Empty state displays when no activities exist.

Existing navigation and resource browsing continue to work.

---

# Validation

Run the frontend normally.

Verify:

Theme toggle works.

Panel layout behaves correctly.

Activity list loads.

No regressions in existing UI.

---

# Deliverables

1. UI components for activity panel
2. Theme provider implementation
3. Activity API integration
4. Updated layout with bottom panel
5. Brief implementation summary
