# Settings

kview settings are stored in the browser profile through localStorage. Settings
are auto-saved as soon as a control changes. There is no separate **Save**
button. Settings can be exported and imported as JSON.

## What This Is For

Settings control local kview preferences, optional UI behavior, custom operator
workflows, and dataplane policy. Settings are local to the browser profile
unless exported and imported elsewhere.

## Appearance And Workflow

Appearance settings currently include:

- **Check for kview updates**: optional and off by default. When enabled, kview
  checks the latest GitHub release while the app is open and shows an update
  notice in the sidebar when the running version is older.
- **Smart YAML collapse**: on by default. When enabled, YAML panels collapse
  noisy sections such as managed fields and expose fold controls in code blocks.
  Turning it off renders YAML without those automatic folds.
- **Smart namespace sorting**: optional and off by default. When enabled, the
  namespace selector prioritizes recently used favourites, then other
  favourites, recent namespaces, and finally the remaining namespaces. When
  disabled, namespaces use the normal alphabetical sort.
- **Combined dashboard signal filters**: optional and off by default. When
  disabled, selecting a dashboard signal chip replaces the current signal
  filter. When enabled, non-derived signal chips can be combined; kview sends
  the selected filters together and narrows the remaining chip choices to the
  matching signal set.
- **Dashboard favourite namespace filters**: optional and off by default. When
  enabled, the dashboard signal filters include chips for namespaces marked as
  favourites in the active context.
- **Dashboard recent namespace filters**: optional and off by default. When
  enabled, the dashboard signal filters include chips for recently visited
  namespaces in the active context.
- **Recent menu**: optional and off by default. When enabled, the side
  navigation shows a Recent group above the normal resource groups. The
  **Recent menu limit** setting controls how many recently opened resource
  sections appear there.

Performance Diagnostics is a separate settings section on the Appearance page.
It can collect browser long-task samples and capture a diagnostic JSON snapshot
when explicitly enabled.

Some UI preferences are still persisted locally even though they are not edited
from the Appearance form. For example, context and namespace selection,
collapsed sidebar groups, resource drawer width, and Activity Panel open state
and height are saved from direct interaction with those UI elements.

Saved resource views are also stored locally. They are created from resource
list toolbars and are included in full settings export/import.

## Keyboard

Keyboard settings control optional bindings:

- **Vim-style table navigation**: on by default. Adds <kbd>h/j/k/l</kbd>
  table cell movement in addition to arrow keys.
- **Home-row table navigation**: on by default. Adds <kbd>a/s/d/f</kbd>
  table cell movement in addition to arrow keys.
- **Single-letter global search**: on by default. Adds <kbd>s</kbd> as a
  shortcut for focusing the header search and command input.
  <kbd>Ctrl+K</kbd> remains available regardless of this setting.

Press <kbd>?</kbd> in the app to see the effective shortcuts after optional
bindings are applied.

## Smart Filters

Smart filters are optional quick-filter chips generated from list rows. They
are enabled by default, but only appear when configured rules match enough rows
to meet **Minimum rows per chip**.

Rules are evaluated in order. Each row stops at the first matching rule, so
more specific rules should be placed above broader rules. A rule can be scoped
by context, namespace, and resource type when it should not apply globally.

When smart filters are disabled, resource lists still support normal text
filtering, but generated quick-filter chips are hidden.

## Resource Tags

Resource tags are optional and off by default. They are stored only in kview
settings; they are never written to Kubernetes resources.

When **Enable resource tags** is on, supported resource lists show a Tags
column and supported drawer headers show tag controls. Tags can be assigned to
individual resources.

When **Show tag quick filters** is on, resource list quick filters include tag
chips from visible rows when both **Resource Tags** and **Smart Filters** are
enabled.

When **Inherit namespace tags** is on, namespace-scoped resources also show tags
assigned to their namespace. Inherited tags are shown differently from direct
resource tags and do not create Kubernetes labels or annotations.

Use the **Auto-Tagging** tab to assign existing tags automatically from resource
names, label values, or annotation values. Auto-applied tags are shown
differently from direct and namespace-inherited tags, and they do not change
the direct tag assignment menu state.

When **Cleanup missing resource assignments** is on, a fresh list that confirms
a resource is gone removes direct tag assignments in that visible scope.

## Links And Macros

Links & Macros are optional and off by default. They are stored only in kview
settings.

When **Enable resource macros** is on, kview can resolve manual macros and
macros extracted from supported resource drawer data. Manual macros can be
scoped globally or to a context, namespace, node, or resource. Extracted macros
can read a resource name, label, or annotation with a regular expression.

When **Enable dynamic links** is on, supported resource drawers show links
whose URL templates resolve completely. Links with missing macros are hidden.
Rendered links appear in the drawer header under the title, next to any tag
summary.
In drawer headers that support local resource tags, the macro edit control can
assign manual macros to the current namespace, pod, or resource without typing
the scope by hand. The same menu can show inherited and extracted macros when
that extra context is needed.

## Custom Commands

Custom commands run against matching pod containers. Define the command, output
format, target matching rules, and safety level.

## Custom Actions

Custom actions apply configured workload changes such as setting environment
variables, unsetting environment variables, changing images, or applying JSON
or merge patches.

## Dataplane

Dataplane settings control snapshots, cache persistence, observers, namespace
enrichment, all-context enrichment, background concurrency, metrics, and signal
thresholds. Use profile presets first, then tune individual values only when
the cluster size or permissions require it.

Signal display priority is controlled by moving signal cards up or down in the
Signal Catalog. Higher cards are considered earlier when signals have similar
severity and freshness.

## Permission And Data Notes

Most settings only change local UI behavior. Dataplane settings can change how
aggressively kview reads cluster data in the active context. Custom Commands and
Custom Actions can trigger Kubernetes API calls or container exec sessions only
when the selected resource and RBAC permissions allow them.
