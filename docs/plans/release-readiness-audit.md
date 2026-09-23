# Release Readiness Documentation Audit

## Boundary and verdict

Audit baseline: local `master` at `4ff92e6` (2026-09-23), after Helm Recovery
`0037c94`, workload Live `8fb3a9c`, generic CR `5b1913d`, and drawer navigation
`fac0a77`. This is a documentation-only audit, not release certification.
Concurrent dependency maintenance belongs to the parent task; its changing
worktree and later gates are not certified here.

**Conclusion:** the operator-feedback implementation queue has landed locally.
Helm Recovery, drawer navigation and terminal corrections are not missing release
features. The remaining work is acceptance/risk decisions, consolidated dependency
verification and release preparation—not implementing every future Roadmap item.
No newly discovered documentation issue here requires a product-code change.

No application tests/builds, live server restart, credential access, cluster
mutation, commit, push, tag or PR write was performed by this audit. Existing
verification statements below are attributed to plans/commits, not rerun results.
`CHANGELOG.md` and `docs/user/whats-new.md` were inspected but not edited.

## Inventory and coverage

The baseline `git ls-files` inventory contains **57 Markdown files**:
11 top-level engineering docs under `docs/`, 7 feature plans, 29 user-doc files
(27 manifest pages plus index and contract), and 10 other root/template/internal/
packaging files. This report adds one Markdown file, outside the Help manifest.

Coverage levels are deliberately distinct:

- **Structural:** all inventory files scanned for ordinary local inline Markdown
  links/images and Markdown heading fragments; Help manifest/static body wiring
  checked separately. This does not validate external URLs or all Markdown dialects.
- **Focused semantic:** README; engineering boundaries and status language;
  every feature plan's status/scope/acceptance; recent operator-facing Help
  behavior compared with targeted current code, CodeGraph and local git history.
- **Survey:** remaining user/engineering material inspected for headings,
  broad/absolute claims, defaults, read ownership and changed-feature references.
  This is not exhaustive proof of every setting, route, shell command or UI label.
- **Historical/vendor:** generated release history and vendored docs checked
  structurally, not rewritten or certified as current product specifications.

### File-by-file inventory

- `.github/pull_request_template.md` — Scope/instruction survey; structural.
- `AGENTS.md` — Scope/instruction survey; structural.
- `CHANGELOG.md` — Historical/generated/vendor; structural only (release scope read separately).
- `CONTRIBUTING.md` — Scope/instruction survey; structural.
- `README.md` — Focused current-contract review; structural.
- `SECURITY.md` — Scope/instruction survey; structural.
- `docs/AI_AGENT_RULES.md` — Scope/instruction survey; structural.
- `docs/API_READ_OWNERSHIP.md` — Focused current-contract review; structural.
- `docs/ARCHITECTURE.md` — Focused current-contract review; structural.
- `docs/DATAPLANE.md` — Focused current-contract review; structural.
- `docs/DEV_CHECKLIST.md` — Scope/instruction survey; structural.
- `docs/IN_CLUSTER_AUTH_ARCHITECTURE.md` — Scope/instruction survey; structural.
- `docs/KEYBOARD_FOCUS.md` — Focused current-contract review; structural.
- `docs/PLAYWRIGHT_E2E.md` — Scope/instruction survey; structural.
- `docs/ROADMAP.md` — Focused current-contract review; structural.
- `docs/UI_UX_GUIDE.md` — Focused current-contract review; structural.
- `docs/VIEW_DESCRIPTOR_CONTRACT.md` — Focused current-contract review; structural.
- `docs/plans/2026-08-27-connectivity-routing-detectors.md` — Focused plan status/scope; structural.
- `docs/plans/2026-08-27-signal-snooze-runtime-suppression.md` — Focused plan status/scope; structural.
- `docs/plans/2026-08-28-resource-map.md` — Focused plan status/scope; structural.
- `docs/plans/2026-09-01-resource-map-v2.md` — Focused plan status/scope; structural.
- `docs/plans/2026-09-01-shared-dataplane-explanation.md` — Focused plan status/scope; structural.
- `docs/plans/operator-feedback-correctness-and-live-ux.md` — Focused plan status/scope; structural.
- `docs/plans/resource-drawer-navigation-options.md` — Focused plan status/scope; structural.
- `docs/user/CONTRACT.md` — Help contract/index validation; structural.
- `docs/user/actions-and-safety.md` — Semantic survey; Help wiring; structural.
- `docs/user/activity-panel.md` — Semantic survey; Help wiring; structural.
- `docs/user/custom-commands-actions.md` — Semantic survey; Help wiring; structural.
- `docs/user/custom-resources.md` — Focused changed-feature review; Help wiring; structural.
- `docs/user/dashboard-and-signals.md` — Semantic survey; Help wiring; structural.
- `docs/user/dataplane-settings.md` — Semantic survey; Help wiring; structural.
- `docs/user/getting-started.md` — Semantic survey; Help wiring; structural.
- `docs/user/helm.md` — Focused changed-feature review; Help wiring; structural.
- `docs/user/import-export.md` — Semantic survey; Help wiring; structural.
- `docs/user/index.md` — Help contract/index validation; structural.
- `docs/user/keyboard-shortcuts.md` — Semantic survey; Help wiring; structural.
- `docs/user/namespaces.md` — Semantic survey; Help wiring; structural.
- `docs/user/navigation.md` — Focused changed-feature review; Help wiring; structural.
- `docs/user/networking.md` — Semantic survey; Help wiring; structural.
- `docs/user/pods-workloads.md` — Focused changed-feature review; Help wiring; structural.
- `docs/user/policy.md` — Semantic survey; Help wiring; structural.
- `docs/user/rbac.md` — Semantic survey; Help wiring; structural.
- `docs/user/resource-drawers.md` — Focused changed-feature review; Help wiring; structural.
- `docs/user/resource-lists.md` — Focused changed-feature review; Help wiring; structural.
- `docs/user/resource-macros-dynamic-links.md` — Semantic survey; Help wiring; structural.
- `docs/user/resource-tags.md` — Semantic survey; Help wiring; structural.
- `docs/user/settings.md` — Semantic survey; Help wiring; structural.
- `docs/user/smart-filters.md` — Semantic survey; Help wiring; structural.
- `docs/user/storage.md` — Semantic survey; Help wiring; structural.
- `docs/user/troubleshooting.md` — Semantic survey; Help wiring; structural.
- `docs/user/views-and-resources.md` — Focused changed-feature review; Help wiring; structural.
- `docs/user/whats-new.md` — Historical/generated/vendor; structural only (release scope read separately).
- `docs/user/workflows.md` — Semantic survey; Help wiring; structural.
- `internal/kube/resource/customresources/CORRECTNESS.md` — Scope/instruction survey; structural.
- `internal/vendor/webview_go/CHANGELOG.md` — Historical/generated/vendor; structural only (release scope read separately).
- `internal/vendor/webview_go/README.md` — Historical/generated/vendor; structural only (release scope read separately).
- `packaging/linux/README.md` — Scope/instruction survey; structural.

## Corrected concrete drift

| Documentation | Correction and evidence |
| --- | --- |
| `README.md` | Narrowed “every/all list response” metadata to dataplane-backed lists: successful direct Helm catalog reads in `internal/server/handlers_helm.go` do not use that envelope. Release helper description now includes both generated files, matching `scripts/prepare-release-notes.sh` lines 137–140. |
| `docs/ROADMAP.md` | Helm Recovery is completed at `0037c94`, not the next block; navigation `fac0a77` and terminal fixes `4ff92e6` recorded; Shared Dataplane Explanation heading agrees with completed `1387128` status. |
| `docs/ARCHITECTURE.md`, `docs/DATAPLANE.md` | Ordinary action registry distinguished from explicit Pod Debug/recovery endpoint exceptions. `registerHelmRoutes` registers both recovery GET/POST separately. |
| `docs/UI_UX_GUIDE.md` | Removed “Metadata/YAML always final” claim: Pod Object grouping and shell-injected Map/Notes are implemented. Shared More/scroll semantics and distinct Helm Notes/Release Notes/Recovery documented. Evidence: `ResourceDrawerShell.tsx`, `ResourceDrawerTabs.tsx`, and `fac0a77`. |
| `docs/user/resource-drawers.md` | Pod Object locations and overflow access corrected; existing Notes bullet continuation indented according to CONTRACT. |
| `docs/user/helm.md`, `docs/user/views-and-resources.md` | Helm chart catalog is direct-first with cached fallback, not cache-only. Evidence: `registerHelmRoutes` calls `ListHelmCharts` before `DerivedHelmChartsSnapshot`. Recovery is distinguished from normal release mutation flow. |
| `docs/user/pods-workloads.md` | Related-settings label corrected to **Pod Debug & Commands**, matching `SettingsView.tsx`. Existing terminal/Live behavior descriptions preserved. |
| Feature plans | Historical task sequences labeled with current implementation status; superseded release-per-pack schedule explicitly marked; uncommitted Helm/navigation claims reconciled with local commits. Original test evidence and unresolved acceptance limitations retained. |

No broken local inline Markdown link or heading fragment was found in the
baseline scan, so no speculative link rewrite was needed. New documentation links
are included in the final scan.

## Every feature plan reconciled

| Plan | Current implementation/evidence | Release interpretation |
| --- | --- | --- |
| `2026-08-27-connectivity-routing-detectors.md` | Service/Ingress detector registrations in `dashboard_signal_detectors.go`; selector/backend cases in `dashboard_aggregate_test.go`; Roadmap records functional verification. | Implemented. Old per-pack version schedule superseded. Original final-review/release-handoff checkboxes lack reconciled evidence; retained as historical gaps, not marked passed by this audit. |
| `2026-08-27-signal-snooze-runtime-suppression.md` | `signal_suppressions.go` implements context-local records, durations/fingerprints and fail-open behavior; persistence and projection callers visible in CodeGraph. | Implemented foundation; original tasks are not a new release queue. No fresh runtime/persistence verification here. |
| `2026-08-28-resource-map.md` | v5.16.0 changelog/tag records shipped v1; `resource_map.go`, `handlers_dataplane.go`, `ResourceIdentityDrawer.tsx` and `ResourceMapPanel.tsx` are current boundaries. | v1 shipped. Original virtual-Helm exclusion does not prohibit the later separate Helm map. |
| `2026-09-01-resource-map-v2.md` | `00726c2`, `b9d5650`; `buildResourceMapGraph` uses Dagre, immutable graph nodes and evidence-preserving edges. | Locally accepted v2 + Helm extension; not missing release scope. |
| `2026-09-01-shared-dataplane-explanation.md` | Completed acceptance checklist and `1387128`; `dataplaneExplanationModel.ts` preserves map relationship evidence separately from cache metadata. | Locally accepted; no reason to restart this feature pack. |
| `operator-feedback-correctness-and-live-ux.md` | `91f7244`, `5b1913d`, `8fb3a9c`, `0037c94`; Live allowlist in `live_resource_adapters.go:82–87` is exactly Pods plus six workload kinds. Recovery UI has exact preview identity, confirmation and stopped-writer guards. | Implemented. Workload final-binary acceptance remains unchecked; cold-start tuning deferred; destructive Helm acceptance not claimed. |
| `resource-drawer-navigation-options.md` | `fac0a77`; terminal follow-up `4ff92e6` clears filter ownership and opens a sole running container directly. | Completed local implementation. Vertical rails and other groupings are alternatives, not release requirements. Fixture browser evidence remains distinct from live acceptance. |

### Historical planned paths versus current code

A separate scan of explicit repository-relative code paths in the plans found
proposed filenames that were not used. They are backtick planning references,
not broken Markdown links or proof of missing functionality:

- Connectivity's proposed `internal/dataplane/dashboard_signal_detectors_test.go`:
  relevant cases are in `dashboard_aggregate_test.go`.
- Resource Map's proposed `internal/server/handlers_resource_map.go`: route is in
  `internal/server/handlers_dataplane.go`.
- Resource Map's proposed `ui/src/components/resources/navigation/` files
  `ResourceDrawerHost.tsx`, `ResourceDrawerNavigationProvider.tsx`,
  `resourceDrawerRegistry.tsx`, `resourceTarget.ts`, plus the proposed shared
  `useResourceMap.ts`: actual shared boundaries include `ResourceIdentityDrawer.tsx`
  and `ResourceMapPanel.tsx`. This audit does not claim one-to-one API equivalence.
- V2's proposed `ResourceMapGraph.test.tsx`: existing graph-model, edge and panel
  test files use different names. Their existence is not a fresh passing result.

Original implementation instructions remain historical rather than being silently
rewritten into fictional execution records. Historical image pins were not
updated during concurrent dependency maintenance.

## Remaining release work and acceptance limitations

### Essential release preparation / explicit decisions

1. **Consolidated dependency change:** parent task owns manifests/locks and the
   final clean verification matrix. Latest user decision permits a local commit
   only after verification; push and closing PRs remain deferred. No final green
   result is available to this documentation audit.
2. **Workload Live final binary:** the plan explicitly says the smoke server was
   not restarted with the final race fix. Replacement/hidden-tab transitions were
   fixture-tested, not cluster-exercised. Only Deployment/ReplicaSet had real rows;
   four kinds were empty. Obtain final-binary acceptance or explicitly accept this
   residual gap; do not upgrade the existing smoke to stronger evidence.
3. **Helm safety boundary:** final fixture/race/full-check/build evidence is in
   the plan, but real-cluster history deletion was not exercised. Layout browser
   evidence used intercepted fixtures, and the later server token returned 401.
   Destructive acceptance requires separate authorization and a safe disposable
   target; it is not an instruction to mutate production before release.
4. **Release artifacts:** generate/review `CHANGELOG.md` and curated What's New
   through the release helper only after choosing the release tag and accepting
   the consolidated state. The files currently summarize v5.16-era changes;
   their lack of the new features is expected until release preparation.
5. **Artifact/CI handoff:** final release build and CI/security results belong to
   the parent/maintainer release boundary. This docs audit does not certify
   embedded assets, packaged desktop variants, remote CI or a released tag.

### Dependency decision supplied by the parent task (not applied by this audit)

- Planned safe subset: #73 Testing Library 16.3.3; #74 x/sync 0.23;
  #77 React 19.3 / DataGrid 9.13 / React types 19.3; safe #79 subset
  Node types 26.5.1, ESLint 10.10, typescript-eslint 8.70, Vite 8.3 and audit fixes.
- Deferred: #71 Kubernetes 0.37; #78 Helm 3.22 because it pulls the same Kubernetes
  update; Vitest 5 from #79 because of coverage-package mismatch.
- These are scope decisions, not evidence that every intended version installed
  or passed. No documentation dependency pin was changed on that assumption.

### Not release blockers by default

Search query mini-language/focused impact paths; runbook bindings; investigation
workspaces and incident-report export; optional in-cluster/OIDC/multi-user RBAC;
time-series spike; Services/Nodes/CR/Helm Live; operator-specific CR adapters;
vertical drawer mode and broader Object grouping. Roadmap explicitly describes
future planning rather than a release promise.

Cold backend startup remains slower but accepted; fixtures prove bounded defects,
not complete attribution of the reported delays. Do not claim it fully solved.

## Lightweight checks performed

- Local git root/branch/history and relevant commit diffs inspected.
- Baseline inventory: `git ls-files` filtered to Markdown, including the hidden
  PR template and vendored docs, not just a default filesystem search.
- Python standard-library structural scan: strip fenced code, resolve local
  inline Markdown links/images, check target existence and heading fragments
  (case/punctuation-normalized slugs with duplicate-heading suffixes). Final
  result: **58 Markdown files, zero missing local inline-link/image targets or
  heading fragments**. The scan includes this report. A separate parent scan
  also found no missing local targets or heading fragments; occurrence totals
  are omitted because the scanners tokenize nested image links differently.
- Help check: **27 manifest pages, 27 static `?raw` imports, 27 `pageBodies`
  mappings**, all sources nonempty, H1 titles match, index contains every source,
  IDs unique, featured IDs resolve. No missing body/title/index/mapping found.
- `git diff --check` passed for the documentation edits; final rerun recorded at
  handoff. No Go/npm/Playwright product suite or build was run for this audit.

## Parent maintenance verification

The safe subset above is now present in the local manifests/lockfiles: x/sync
0.23.0, React/React DOM and React types 19.3.0, DataGrid 9.13.0, Testing Library
React 16.3.3, Node types 26.5.1, ESLint 10.10.0, typescript-eslint 8.70.0 and
Vite 8.3.0. Vitest and coverage remain paired at 4.1.11; Kubernetes remains on
0.36.4 and Helm on 3.21.4. The existing TS7 native / TS6 library bridge remains.
These reproduce the reviewed PR versions rather than pulling every newer release.

- `npm audit fix --package-lock-only --ignore-scripts` resolved the two reported
  transitive findings: browserslist is now 4.29.0 and baseline-browser-mapping
  is 2.11.25. The final `make audit DOCKER_BUILD=0` passed: npm reports zero
  vulnerabilities, Go modules verify, the vulnerability-wrapper regression tests
  pass, govulncheck reports zero reachable vulnerabilities, and actionlint passes.
- Govulncheck also lists four module-level advisories outside called/imported
  vulnerable code. This is not a claim that every required module is advisory-free.
- The separate canonical Go lint gate found pre-existing issues in the recent
  CR/Live/Helm tranche. Minimal cleanup now passes `make lint-go DOCKER_BUILD=0`
  with **0 issues**; no linter rules or safety assertions are disabled. Fixture
  writes report errors; HTTP response body cleanup follows existing conventions.
- The first combined UI run failed 18 tests in five files. A one-worker diagnostic
  run passed four of those files unchanged (including terminal focus), leaving a
  long workload scenario and a real-timer retry race. The workload test now drives
  retry time explicitly and separates no-polling from operator-state preservation;
  all assertions remain. The focused deployment cases pass (13 tests). Canonical
  test and coverage scripts use one worker to avoid mounted-grid contention;
  the 15-second per-test timeout is unchanged.
- Final sequential `make audit DOCKER_BUILD=0`, `make check DOCKER_BUILD=0`
  and `make build DOCKER_BUILD=0 OUTPUT=.cache/release-readiness/kview
  VERSION=release-readiness` completed successfully on the final code/dependency
  tree. Clean npm installation, TypeScript checks, ESLint, **829 UI tests in 103
  files**, Go vet/tests and production UI/Go build passed. The binary's
  `--version` returned `release-readiness`.
- Evidence is retained locally under `.cache/release-readiness/` in
  `lint-go.log`, `audit-final.log`, `check-final.log` and `build-final.log`.
  Final documentation-only handoff edits do not change the tested product tree.
- Local inline links/headings were rechecked across all 58 Markdown files;
  all 27 Help source/import/body/H1/index entries match. `git diff --check` passed.
- No remote CI, PR closure, push, tag, server replacement or release is implied.
  The cluster-acceptance limitations above remain unchanged.

## What this audit does not establish

External URL reachability; GitHub-renderer or in-app rendering parity for every
anchor; reference-style/HTML/generated links beyond the simple scanner; visual
screenshots; exhaustive endpoint and setting-default conformance; current
third-party service/security-policy claims; success of historical test commands;
new security approval for recovery or hosted-mode design. Vendor docs and release
history are intentionally not rewritten. Concurrent maintenance may require a
follow-up pin/readme alignment once actual updates and gates are known.
