# Cached search filters and focused map entry

Status: initial implementation locally verified after `dbe9925`; manual review
requested inline chips, dropdown Map entries and namespace-first results. These
follow-up changes are implemented. Focused Go search/HTTP tests, 23 parser tests,
30 mounted search regressions, typecheck and lint passed. A separate
failed-partition retry prevents repeated local errors from blocking broad
pagination. Production UI/backend build, binary help and diff checks passed;
The maintainer manually accepted the result and authorized committing it.
No agent-driven live restart or push.

## Manual-feedback follow-up

- Recognized filters replace draft text with inline removable chips on delimiter
  or blur; fixed input height and bounded horizontal chip strip.
- Resource Map is an explicit keyboard-selectable dropdown entry immediately
  after its resource; ordinary selection still opens details.
- Namespace-scoped views start separate current-namespace/rest requests in the
  same debounce tick, publish local results independently and retain local-first
  ordering. Explicit namespace filters bypass preference. Paging, cancellation
  and partial errors are tracked independently; one successful partition cannot
  clear another's failure. Free-solo Enter parses the full query including chips.
- RAM search avoids unrelated namespace/kind stores; persistence rejects keys
  before JSON decoding and uses bounded top-K selection without a schema change.
- Isolated RAM benchmark (100 namespaces, 100 pods each, three iterations):
  unscoped 585.46 ms/op; namespace-first 3.66 ms/op. This is not persisted-cache,
  HTTP or browser latency; the existing name index still requires traversal.

Initial verification: Backend search tests, targeted drawer/search tests, 22 parser tests,
final 18-test GlobalSearchInput regression suite, typecheck/lint, production
UI/backend build, binary help invocation and diff checks passed. Review findings
around automatic highlight, command hover and disabled/token transitions are
fixed. No browser E2E, live restart, commit or push was performed.

## Coherent scope

Add simple AND-combined key:value filters to the existing enriched cached search:
kind, ns/namespace, name, cluster/context, health, status, signal, and boolean
attention. Preserve plain text and command palette behavior. Unknown keys,
invalid booleans and incomplete filters remain literal text rather than silently
broadening results. Exact lexical and matching behavior must agree across the
Go matcher, TypeScript chips and user documentation. Both parsers recognize
`key:"value with spaces"`, reject escapes and malformed quote suffixes as literal
text, and cap parsing at 4,096 UTF-8 bytes / 64 terms. Name matching is substring;
other string predicates are exact, and kind supports explicit aliases.

Show recognized removable filter chips. Ordinary result selection keeps its
existing behavior. An explicit Map action opens the selected exact identity at
the Resource Map surface, using shared drawer/navigation ownership. This is a
centered bounded relationship view, not a newly computed shortest impact path.

## Safety and compatibility

- Search remains active-context, RAM/persisted-cache-only. No implicit hydration,
  Kubernetes scans or additional background enrichment.
- RAM identity wins over disk before filtering, including when the newer row no
  longer matches. Matching precedes paging; hasMore remains truthful.
- Keep lazy UI boundaries, keyboard/mouse parity, command prefixes, context
  resets, investigation snapshots and stacked drawer ownership.
- Do not claim note/stale/service predicates until indexed evidence supports
  their semantics. Those are later extensions, not fabricated metadata.
- No migration or new infrastructure. No automatic push/commit/live restart.

## Acceptance

Focused backend tests cover aliases, AND semantics, literal fallback, persisted
matching, RAM precedence, scope and pagination. UI logic/targeted mounted tests
cover chips/removal and explicit map selection without breaking ordinary
keyboard/mouse selection. Use capped pinned Docker checks, one coherent
production build and manual browser acceptance; no routine Chrome/Playwright.

## Delivery

Parent owns integration and docs; Go and UI implementations are separate scopes.
Final report must distinguish implemented, verified and manually accepted state.
