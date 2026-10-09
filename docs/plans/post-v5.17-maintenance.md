# Post-v5.17 maintenance

Status: verified locally. Resource Map feature work is deliberately separate.

## Scope

- Upgrade Helm to 3.22.0 and align Kubernetes direct and release-line transitive modules to 0.37.1.
- Upgrade the build/runtime compiler to Go 1.26.9 (digest-pinned Docker image, Makefile image tag, native release CI and minimum version in go.mod), plus golang.org/x/net 0.60.0 and its required companion modules. The first security gate exposed nine reachable advisories involving the old standard library and x/net; do not allowlist these fixable findings.
- Upgrade Vitest and its coverage provider together to 5.0.3; include `@vitest/*` in Dependabot's frontend-tooling group.
- Refresh the inventoried compatible frontend patches/minors, including DataGrid, React Flow, Vite, ESLint, Playwright and Testing Library.
- Resolve fixable npm audit findings in brace-expansion, source-map-js and undici through package-manager-generated lockfile changes.
- Preserve the TS7 native compiler / TS6 library compatibility bridge, the deliberate jsdom pin and single-worker test scripts.
- No push, PR merge, release tag or cluster mutation as part of local maintenance.

The npm inventory is newer than the open dependency PRs; the local consolidated refresh therefore may supersede their proposed versions, not merely reproduce their lockfiles.

## Migration review

Vitest 5 requires Node >=22.12 and Vite >=6.4, supported by the pinned Node 22.23.1 build image and Vite 8. Its default mock-history clearing, stricter asynchronous assertions and top-level mock rules require exercising the complete existing suite and coverage provider. No blanket compatibility override or timeout increase is planned.

Reference: https://vitest.dev/guide/migration.html

## Verification

The Go 1.26.9 / x/net 0.60.0 tree passed module verification, npm audit (0), govulncheck (0 reachable, one non-reachable module advisory), workflow lint, full check (829 UI tests / 103 files plus Go vet/tests) and Go lint (0 issues). The subsequent coverage chain was stopped at the maintainer's request because routine verification was consuming excessive local resources. The resource-capped production build subsequently passed (`make build DOCKER_BUILD=0`, 2 CPUs / 4 GiB); `./kview --version` returned `v5.17.0` (the existing HEAD tag, not a new release). Test visibility was also verified inside the pinned container. No full/coverage/browser rerun was performed.

The maintainer explicitly changed the verification contract: basic checks by default, full mounted suites and coverage opt-in, browser E2E only for concrete troubleshooting. `make check` now excludes mounted `*.test.tsx` scenarios, uses an explicit eight-package Go contract/logic baseline, and caps container CPU/memory plus Go concurrency. PR/push CI no longer runs coverage automatically; manual extended CI remains available. Full tests were retained, not deleted or weakened. The new basic gate was verified in stages without repeating passing tests: typecheck/ESLint and 294 UI tests in 43 files passed (221.01s versus 964.76s for the earlier full UI run); all eight selected Go packages passed vet/tests; actionlint, shell syntax and basic/full/CI-tier contract assertions passed. The UI run included the old install-time audit delay; subsequent installs disable that redundant request and prefer cache. No browser was launched for this change. Do not resume the cancelled full/coverage chain.

Local evidence is under `.cache/post-release-maintenance/` (ignored).

## Next: recursive Resource Map (not implemented here)

After maintenance acceptance, assess recursive Helm release topology from manifest roots plus confirmed cached ownership chains. Keep reference/selector links distinct from ownership and prevent traversal through shared dependencies from absorbing unrelated resources.

Group homogeneous children by their actual owner, expose problem-state summaries and bounded member lists, preserve rollout-history controls and stable identities, and distinguish collapsed known members from incomplete/truncated cache coverage. Bound traversal, edges and visible nodes; no per-node live Kubernetes reads. Validate high replica counts, multiple revisions, cycles, shared dependencies and incomplete cache before selecting limits or expanding the scope to other map surfaces.
