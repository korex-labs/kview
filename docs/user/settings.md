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

## Profiles

Profiles are local snapshots of kview settings sections. Create a profile from
the current settings when you want to preserve a workflow setup, such as daily
monitoring, incident triage, or Helm review.

Profile snapshots include appearance, keyboard, smart filters, resource tags,
links and macros, saved views, custom commands, Pod Debug defaults, custom
actions, and dataplane settings. The profile library itself is not nested into
snapshots.

Applying a profile replaces those captured settings sections and marks that
profile as active. Updating a profile overwrites its snapshot with the current
settings. Deleting a profile removes only that local snapshot.

## Keyboard

Keyboard settings provide a complete, searchable action catalog rather than a
small set of optional toggles. Choose a preset as the starting point:

- **kview Classic** preserves the familiar kview navigation, table, activity,
  command-mode, and drawer shortcuts.
- **Vim/k9s** emphasizes Vim-style table movement and operator navigation.
- **Browser Safe** uses modifier-first global bindings to reduce conflicts with
  normal typing and browser shortcuts.

Each action can have multiple bindings, and each binding may contain several
key chords. Use **Add** to record a binding, remove individual bindings, choose
**Disable** to replace the preset bindings with none, or **Reset** to inherit
that action from the selected preset again. **Reset built-ins** removes all
built-in overrides while preserving bindings for custom definitions.

Changes are staged locally in the editor. **Apply keyboard changes** becomes
available only when the draft differs from the saved settings and has no exact
or prefix collisions. **Cancel keyboard changes** discards the draft. Reserved
browser or operating-system combinations are warnings; malformed bindings and
collisions are errors.

Use the search field to find actions by label, group, stable ID, or scope, and
page through the matching catalog. Press <kbd>?</kbd> in the app to see the same
compiled effective bindings. While a resource drawer is open, Help also shows
only contextual actions currently available for that resource.

Older saved Vim, home-row, and single-letter-search preferences are migrated to
behavior-equivalent preset overrides when loaded.

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

## Pod Debug & Commands

Open **Pod Debug & Commands** in the Settings menu for both Pod Debug defaults
and reusable container commands.

### Pod Debug

- **Enable Pod Debug** controls whether Pod drawers show the **Debug** action.
- **Default debug image** supplies the initial image in the launch dialog.
- **Default shell** supplies the absolute shell path used as the ephemeral
  container command.

These are browser-local defaults, not a cluster allowlist or authorization
policy. The launch dialog still checks Kubernetes permissions and the backend
still relies on Kubernetes RBAC and admission for the final operation. Full
settings export/import includes them, and **Pod Debug defaults** is available as
an explicit Settings transfer section.

### Custom Commands

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

Each signal card also has **Exclusions** for suppressing expected noise from
specific resources. A badge on the button shows the number of effective rules
for the selected global/context scope; a neutral badge means every stored rule
is currently disabled. Rules are combined with OR; conditions inside a rule can
use **Match all** (AND) or **Match any** (OR). Conditions can match resource
name, namespace, an exact label key, or an exact annotation key. Values use
RE2 regular expressions; label and annotation conditions can alternatively
test whether the key exists.

Global rules are inherited by every context. A context can replace the global
set, explicitly save an empty set to clear it, or return to inheritance with
**Use global rules**. **Preview matches** evaluates the draft against cached
raw signal candidates only and does not read Kubernetes or change settings.
Saving an exclusion suppresses the signal before counters, health projections,
drawers, and new signal-history observations. Existing history, Signal Memory,
acknowledgements, and Investigation Snapshots are retained.

For a faster workflow, select **Exclude this signal** directly on a signal row.
kview opens this editor for the correct signal type and prefills exact anchored
namespace and resource-name conditions. Current-context scope is the safe
default; select **Global default** to write the rule to the global signal policy.
Contexts with their own replacement rules remain isolated from that policy.
Global-default preview still evaluates cached candidates from the active context
only; it is not a cross-context scan.

## Runtime Signal Suppressions

**Snooze 1 hour**, **Snooze 1 day**, and **Ignore until changed** are runtime
operator decisions made from signal rows, not Dataplane settings. They belong
only to the active context and do not inherit from global settings. They are also
separate from acknowledgements, static exclusions, operator profiles, full
profile backups, and global/context signal overrides.

Use **Settings → Import / Export → Signal suppressions** to transfer these
records independently. Export captures the active context. During import,
`sourceContext` identifies where the bundle came from but is informational only:
kview always writes selected suppressions into the currently active context.
After import, review the active suppressed rows and choose **Show now** for any
decision that should not apply there.

See [Dashboard And Signals](dashboard-and-signals.md#snooze-and-ignore-until-changed)
for the operator workflow and
[Import / Export](import-export.md#signal-suppression-transfer) for validation,
strategies, and result counts. Engineering contracts are in
[Dataplane](../DATAPLANE.md#runtime-signal-suppression) and
[API read ownership](../API_READ_OWNERSHIP.md#4-local-operator-knowledge-reads).

## Permission And Data Notes

Most settings only change local UI behavior. Dataplane settings can change how
aggressively kview reads cluster data in the active context. Custom Commands and
Custom Actions can trigger Kubernetes API calls or container exec sessions only
when the selected resource and RBAC permissions allow them.
