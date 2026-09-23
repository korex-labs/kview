# Resource drawer navigation — approved implementation and reference options

## Implementation scope

The horizontal overflow baseline and Pod-only Object grouping were approved.
The implementation adds `ResourceDrawerTabs` at the shared shell boundary,
keeping original tab elements and their semantic action markers mounted.
**More** lists all destinations in source order and names the selected section
when it is outside the scroller viewport. Scroll controls remain available at
mobile widths. Resize reveals the selection; manual scrolling does not snap back.

Pod Metadata and YAML are now **Object → Details / YAML**. Explicit contextual
handlers preserve both existing action IDs even while Object is not mounted,
and clear the shell's Notes/Resource Map selection before opening the view.
Other resource groupings and the vertical presentation mode remain deferred.
No backend, RBAC, recovery workflow or cluster mutation change is included.

Verification is recorded below at the completed milestone. The sections below
retain the original rationale and alternatives; they are not additional scope.

## Boundary

Accepted Helm Recovery and its drawer correction were committed locally as
`0037c94`. No push. The navigation follow-up is a separate uncommitted change
for operator review.

## Baseline code findings (before implementation)

- Most resource drawers instantiate plain MUI `Tabs` without a scrollable variant
  (for example PodDrawer, DeploymentDrawer, ServiceDrawer and NodeDrawer).
- HelmReleaseDrawer explicitly uses `variant="scrollable" scrollButtons="auto"`,
  but does not set `allowScrollButtonsMobile`.
- ResourceDrawerShell clones the primary tab strip to insert Resource Map/Notes;
  its fallback auxiliary strip is also plain Tabs. Shared styling does not add
  an overflow interaction. This is not a single Helm-only layout issue.
- These are source findings, not a new browser reproduction. In particular, a
  narrow drawer on a wide viewport is distinct from a mobile-width viewport.
- Keyboard availability currently derives from rendered tab DOM with semantic
  data-keyboard-action-id markers. Moving destinations into an unmounted menu
  must not silently remove their keyboard actions.

## External precedents

PatternFly supports a trailing overflow menu, optionally with the number of
hidden tabs. Selecting an overflow item changes the overflow tab's displayed
name to the selected destination. It also documents vertical and secondary tabs.[1]

HPE recommends keeping groups small, supports responsive arrow navigation, and
explicitly advises against vertical tabs because of horizontal content-space
cost and small-screen behavior. It recommends icons alongside text labels.[2]

MUI provides horizontal scrollable and vertical tabs. Its default mobile behavior
hides scroll buttons; `allowScrollButtonsMobile` overrides this. Thus merely
adding `scrollButtons="auto"` is not a complete all-width contract.[3]

These are reference design systems, not evidence that every product using them
implements all variants. There is no universal consensus that vertical tabs are
always better.

## Options for kview

### A. Horizontal tabs with guaranteed overflow access — recommended baseline

Keep visible labels and stable ordering. Initially make explicit scroll controls
work consistently at every drawer/viewport width. A subsequent trailing `More`
menu can provide direct access to hidden destinations without repeatedly paging
through arrows. Show the selected hidden destination rather than an anonymous
More button. Offer a complete section list from the menu if navigation discovery
requires it. Do not wrap tabs into multiple rows or arbitrarily reorder by usage.

Benefits: preserves current interaction, minimizes content-width loss, shared
fix across resource types. Cost: overflow destinations require an extra action.

### B. Vertical rail

Icon plus label is easier to scan but consumes drawer width. Icon-only conserves
width, but Metadata/YAML/Spec/Values/Manifest are hard to distinguish reliably.
Tooltips must work on focus as well as hover, active selection needs an explicit
label, and the rail still needs vertical overflow handling on short windows.

This is a plausible optional presentation mode, especially for expanded drawers,
but not the recommended default. Breakpoints must follow container size rather
than only window width; no surprise orientation change on every resize.

### C. Reduce top-level destinations by semantic grouping

For ordinary Kubernetes resources, combine Metadata and YAML under `Object`:
metadata/labels/annotations and a local `Details | YAML` presentation switch.
Retain the shared YAML viewer, edit permissions and direct YAML keyboard action;
that action should open Object and select YAML. Consider Spec/Status later only
where meaning and existing rendering make the grouping coherent.

Do not confuse Helm's rendered Manifest, input Values, release storage YAML and
managed live objects: these are different artifacts, not interchangeable views.
Likewise Helm Release Notes and local operator Notes have different provenance.

History and guarded Recovery may eventually share a release-operation section,
but destructive recovery must remain explicitly identified and guarded, never
an incidental delete control in a revision list. This grouping needs separate
operator approval; the recently accepted Recovery tab need not move immediately.

Benefits: fewer top-level destinations. Cost: misplaced grouping merely moves
clutter into subtabs and makes frequent tasks harder to find.

## Recommended sequence

1. Fix overflow accessibility independently of choosing a redesign: shared
   scrollable tab behavior, visible arrow controls, selected-tab reveal after
   resize, proper container sizing, keyboard access and focus visibility.
2. Use a shared semantic destination definition for labels/icons/content,
   overflow navigation and keyboard actions. Preserve current IDs and state;
   do not build separate per-resource More menus or another keyboard dispatcher.
3. Add measured-width overflow navigation and pilot Metadata/YAML grouping on a
   representative ordinary resource plus Helm without conflating Helm artifacts.
4. Decide on an optional vertical mode only after inspecting those results.

Acceptance criteria for implementation, not tests run during this research:
all destinations reachable by mouse and keyboard at minimum drawer width;
resize in both directions preserves selection and reveals it; active hidden
section is named; no whole-panel horizontal overflow; notes/map insertion obeys
same navigation rules; expanding/collapsing drawer preserves state; independent
nested drawers retain focus ownership; hidden panels do not start expensive
reads, and security confirmations/RBAC are unchanged.

## Verification and review handoff

- Focused navigation/polish tests, typecheck and lint passed in the pinned build
  container. The previous full check's only failing test was the stale drawer
  layout snapshot (815 tests passed); its Pod and Helm expectations are now
  updated to the accepted UI. JSX tab labels are parsed with the existing
  TypeScript parser so nested icon labels cannot masquerade as destination names.
- Browser fixtures use actual Pod/Helm drawers and providers with intercepted
  synthetic API data, not live-cluster acceptance. They verify More destination
  order/icons, mouse and menu keyboard selection, focus return to selected tab
  and More after Escape, Object direct shortcuts and icon/case styling, dragging
  drawer width, full-screen restore, viewport shrink with saved wide drawer,
  selected-tab reveal and stable hidden-selection labels. Helm retains separate
  Notes/Release Notes, lazy Recovery and confirmation gating.
- The next full UI run passed 814/818 tests, including all navigation, snapshot
  and Helm tests. Four old Pods tooltip assertions still expected the previous
  tooltip text; those assertions now require the explanatory text and preserve
  the diagnostic-reason check. Only that affected file is rerun; the remaining
  backend checks and production build continued separately to avoid repeating
  the passing full UI suite.
- Completion: the affected Pods test file passed, typecheck/lint passed again,
  `go vet ./...`, `go test ./...`, and `scripts/test-visibility.sh` passed.
  `make build DOCKER_BUILD=0 OUTPUT=.cache/drawer-navigation-acceptance/kview
  VERSION=drawer-navigation-acceptance` completed successfully; the executable's
  `--version` returned `drawer-navigation-acceptance`. Final whitespace check passed.
- No running server was replaced; no cluster mutation or credential change was
  performed.
- Operator review: Pods Object Details/YAML; narrow Pod/Deployment/Node/Service
  navigation including Notes/Map; Helm Recovery and both Notes destinations;
  Live/polling explanatory tooltip and mode toggle.

## Sources

[1] https://www.patternfly.org/components/tabs/design-guidelines
[2] https://design-system.hpe.design/components/tabs
[3] https://mui.com/material-ui/react-tabs
