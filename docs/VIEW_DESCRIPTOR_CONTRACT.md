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
- `listView.savedViews` for saved-view availability, generated name prefixes,
  location compatibility, and drift-comparison state
- sidebar group IDs, labels, icons, and resource order
- `dashboard.signalViews` for dashboard signal-view availability, generated
  name prefixes, and drift-comparison state
- `dashboard.signalFilterCategories` for dashboard signal filter group labels,
  ordering, and compact layout hints

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
- saved-view persistence, drift prompts, and apply/update/delete interactions

`ResourceListPage` is the shared enforcement point for resource lists. It
derives resource labels, titles, access checks, filter labels, default sort,
quick-filter identity, baseline text search, and saved-view compatibility from
descriptor policy. Resource tables should pass only the data-fetching, column,
and drawer behavior they uniquely own.

`DashboardView` and `DashboardSignalsPanel` use the dashboard descriptor policy
for signal-view defaults and signal filter category presentation. Signal
definitions, effective signal policy, and per-response filter counts still come
from dataplane signal APIs; the view descriptor owns only static presentation
rules.

## Saved-view rules

`listView.savedViews` controls whether a resource list exposes the saved-view
toolbar controls and how a saved view is considered compatible with the current
screen.

- `enabled`: hides saved-view controls when false.
- `namePrefix`: default prefix used by the save dialog.
- `location`: dimensions that must match before a saved view can be applied to
  the current list. Current values are `context`, `namespace`, and `resource`.
- `state`: dimensions compared for the **Modified** marker. Current values are
  `filter`, `sort`, and `columns`.

Keep saved-view location and drift rules in descriptor policy and shared
saved-view helpers. List pages should not duplicate context, namespace,
resource, sort, or column comparison rules inline.

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
