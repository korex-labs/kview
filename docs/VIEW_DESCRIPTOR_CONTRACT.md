# View descriptor contract

`GET /api/view/resources` is the backend-owned contract for static resource
view metadata. The UI loads it once at startup and falls back to local defaults
when the endpoint is unavailable, so mixed frontend/backend development remains
usable.

## Backend-owned fields

Resource descriptors own product-level view rules:

- `key`, `label`, `icon`, `clusterScoped`
- `access` review target for list-level capability checks
- `listView.quickFilters` source availability
- `listView.defaultSort`
- `listView.filterLabel`
- `listView.identity` for smart quick-filter grouping
- `listView.searchFields` for baseline text filtering
- sidebar group IDs, labels, icons, and resource order

React components should not duplicate these values unless a view intentionally
deviates from the resource default. Examples of valid table-local overrides are
namespace smart sorting, a contextual title that is not the standard
`Resource Label - namespace` shape, or filtering over computed display text that
does not exist on the row as a stable field.

## Frontend ownership

React remains responsible for rendering and interaction state:

- columns and cell renderers
- drawer selection and open/close state
- table sort/filter/column state after user interaction
- custom predicates for computed or deeply resource-specific display values
- saved-view drift and update prompts

`ResourceListPage` is the shared enforcement point. It derives resource labels,
titles, access checks, filter labels, default sort, quick-filter identity, and
baseline text search from descriptor policy. Resource tables should pass only the
data-fetching, column, and drawer behavior they uniquely own.

## Search field rules

`listView.searchFields` supports simple row fields and dotted paths. Dotted
paths may project through arrays, for example `entries.key` matches any
`key` field inside an `entries` array.

Use descriptor search fields for stable row data. Keep a table-local
`filterPredicate` when matching requires:

- derived text produced only by a helper function
- resource-specific compound logic
- expensive or UI-only formatting
- fields intentionally hidden from the generic descriptor contract

When adding a new list view, add descriptor defaults first, then keep table-local
props only for behavior that cannot be represented in the descriptor.
