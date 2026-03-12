# kview Phase 1A — Runtime Foundation Prompt

## Objective

Implement the **runtime foundation layer** for `kview` without adding terminal, port-forward, or analytics features yet.

This work must create reusable backend seams for upcoming phases.

---

## Mandatory Reading

Read before changing code:

- `docs/AI_COLLABORATION.md`
- `docs/AI_AGENT_RULES.md`
- `README.md`
- `kview_runtime_architecture.md`
- `kview_go_package_structure.md`
- `kview_runtime_interfaces.md`
- `activity_panel_architecture.md`
- `phase1_master_prompt.md`

---

## Scope

Implement only the backend runtime foundation:

- add a runtime package
- add Activity model/types
- add in-memory ActivityRegistry
- add RuntimeManager scaffolding
- expose read-only activity API
- wire startup/shutdown cleanly

Do not implement:

- terminal session runtime
- port-forward runtime
- worker execution engine
- analytics polling
- Redis or external broker
- database persistence

---

## Recommended Package Targets

Prefer small additions such as:

```text
internal/runtime/
  activity.go
  registry.go
  manager.go

internal/apihttp/
  activity_handler.go
```

If the repo uses different naming conventions, adapt carefully without broad refactors.

---

## Requirements

### Runtime types

Add stable typed backend models for:
- ActivityKind
- ActivityType
- ActivityStatus
- Activity

### Registry

Implement in-memory ActivityRegistry with:
- Register
- Update
- Get
- List
- Remove

It must be concurrency-safe.

### Manager

Add RuntimeManager:
- owns registry
- starts cleanly
- stops cleanly
- available to API layer

### API

Add endpoint:

- `GET /api/activity`

Optional but recommended:
- `GET /api/activity/:id`

Return JSON with stable structure.

### Wiring

Runtime foundation must be created during backend startup and passed into the API layer through explicit dependencies.

Do not use global variables.

---

## Constraints

- keep current HTTP architecture intact
- keep existing WebSocket code untouched unless tiny wiring changes are needed
- do not change Kubernetes resource behavior
- prefer incremental change over broad refactor

---

## Validation

After implementation:

- build successfully
- application starts normally
- `/api/activity` responds successfully
- empty activity list is acceptable
- code structure supports future session and worker managers

Run project build/validation according to repository conventions.

---

## Deliverables

1. code changes
2. brief implementation summary
3. files added/updated
4. risks or follow-up notes for terminal / port-forward phases
