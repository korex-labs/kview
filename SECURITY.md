# Security Policy

## Supported Versions

Security fixes are applied to the latest released version on the default branch.

If you are running an older version, upgrade and verify the issue still reproduces before reporting.

## Reporting a Vulnerability

Please do not open public GitHub issues for suspected security vulnerabilities.

Report privately by opening a [GitHub Security Advisory](https://github.com/korex-labs/kview/security/advisories/new) for this repository.

For general repository security information, see the [Security tab](https://github.com/korex-labs/kview/security).

When reporting, include:

- A clear description of the issue and impact
- Reproduction steps or a proof of concept
- Affected versions, environments, and configuration details
- Any suggested mitigation (if known)

You can expect an initial acknowledgement within 5 business days.

## Dependency audit policy

`make audit DOCKER_BUILD=0` verifies Go modules, runs the npm audit wrapper and
its regression tests, then the existing govulncheck wrapper/tests and actionlint.
Run the normal pinned-container dependency install first (`npm ci` in `ui`);
the npm gate checks both the committed and installed lockfiles and installed
package versions. No dependencies are omitted from the scan, and raw npm JSON,
severity counts and scanner stderr remain visible.

The maintainer approved a temporary exception for the published picomatch
advisory **GHSA-fc5q-39xc-vjpf**. Its reason, tracking issue and exact affected
development-tool paths live in `scripts/npm-audit-exceptions.json`. Acceptance
is **not a fix or a zero-vulnerability result**. It expires at the **start of
December 2, 2026 UTC (`2026-12-02T00:00:00Z`)**, not the end of that day.
Attach the tracking issue before committing if its field is still null.

The gate matches the exact GitHub advisory URL, npm advisory source ID and
package identity, never the title. Every advisory and every `via` edge is
checked, including cycles; all affected nodes must be explicitly listed and
marked exclusively development-only in both lockfiles. New paths, production
exposure, unknown advisories, invalid scanner output/status, transport errors,
expired exceptions and stale exceptions after remediation fail closed.
Severity changes remain visible but do not alter identity/path-based acceptance.
After remediation, remove the stale exception (use an empty JSON array when
none remain) and rerun the audit. Do not extend the deadline or broaden paths
without a new maintainer review. Go vulnerability policy is unchanged.
