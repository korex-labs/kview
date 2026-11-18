#!/usr/bin/env node
// Like the Go audit wrapper: retain raw output, reject scanner failures and stale exceptions.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

export function evaluateAudit(result, exceptions, lock, installedLock, now = new Date()) {
  requireThat(!result.error && !result.signal && [0, 1].includes(result.status),
    `scanner failed (status ${result.status}, signal ${result.signal ?? 'none'})`);
  const report = JSON.parse(result.stdout);
  requireThat(object(report) && !report.error && report.auditReportVersion === 2 &&
    object(report.vulnerabilities) && object(report.metadata?.vulnerabilities), 'malformed audit report');
  requireThat(Array.isArray(exceptions) && exceptions.length <= 1, 'invalid exceptions');
  const findings = report.vulnerabilities;
  const counts = report.metadata.vulnerabilities;
  const actual = Object.fromEntries(severities.map((severity) => [severity, 0]));
  for (const finding of Object.values(findings)) {
    requireThat(object(finding) && severities.includes(finding.severity), 'malformed finding');
    actual[finding.severity]++;
  }
  requireThat(severities.every((severity) => counts[severity] === actual[severity]) &&
    counts.total === Object.keys(findings).length, 'inconsistent audit counts');
  requireThat(result.status === (counts.total ? 1 : 0), 'inconsistent scanner exit status');
  if (!counts.total) {
    requireThat(!exceptions.length, 'stale exception: advisory gone; remove exception');
    return 'npm audit policy PASS: zero vulnerabilities';
  }
  requireThat(exceptions.length === 1, 'unexpected vulnerabilities without exception');
  const exception = exceptions[0];
  requireThat(object(exception) && exception.advisory === 'GHSA-fc5q-39xc-vjpf' &&
    exception.url === `https://github.com/advisories/${exception.advisory}` &&
    exception.package === 'picomatch' && Number.isInteger(exception.source) &&
    typeof exception.reason === 'string' && exception.reason.trim() &&
    (exception.trackingIssue === null || /^https:\/\/github\.com\/korex-labs\/kview\/issues\/[1-9][0-9]*$/.test(exception.trackingIssue)) &&
    object(exception.paths), 'invalid exception metadata');
  requireThat(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/.test(exception.expires) &&
    Number.isFinite(Date.parse(exception.expires)) &&
    new Date(exception.expires).toISOString() === exception.expires.replace('Z', '.000Z') &&
    Number.isFinite(now.getTime()) &&
    now.getTime() < Date.parse(exception.expires), 'exception expired or invalid expiration');
  requireThat(object(lock?.packages) && object(installedLock?.packages), 'missing lock package data');
  const hasAdvisory = new Set();
  const edges = new Map();
  const seenPaths = new Set();
  for (const [name, finding] of Object.entries(findings)) {
    requireThat(finding.name === name && Array.isArray(finding.nodes) && finding.nodes.length &&
      Array.isArray(finding.via) && finding.via.length, `malformed finding: ${name}`);
    for (const path of finding.nodes) {
      requireThat(typeof path === 'string' && Object.hasOwn(exception.paths, path) &&
        exception.paths[path] === name && !seenPaths.has(path), `unapproved package path: ${path}`);
      seenPaths.add(path);
      const pinned = lock.packages[path];
      const installed = installedLock.packages[path];
      requireThat(pinned?.dev === true && installed?.dev === true && !pinned.link && !installed.link &&
        !pinned.devOptional && !installed.devOptional && typeof pinned.version === 'string' &&
        pinned.version === installed.version, `non-dev or drifted package path: ${path}`);
    }
    const dependencies = [];
    for (const via of finding.via) {
      if (typeof via === 'string') {
        requireThat(Object.hasOwn(findings, via), `unresolved via edge: ${via}`);
        dependencies.push(via);
      } else {
        requireThat(object(via) && via.url === exception.url && via.source === exception.source &&
          via.name === exception.package && via.dependency === exception.package &&
          name === exception.package && severities.includes(via.severity),
        `unexpected advisory in ${name}`);
        hasAdvisory.add(name);
      }
    }
    edges.set(name, dependencies);
  }
  requireThat(hasAdvisory.size, 'stale exception: advisory gone; remove exception');
  // Propagate through cycles (Vitest/coverage), but reject disconnected cycles.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, dependencies] of edges) {
      if (!hasAdvisory.has(name) && dependencies.some((dependency) => hasAdvisory.has(dependency))) {
        hasAdvisory.add(name);
        changed = true;
      }
    }
  }
  requireThat(hasAdvisory.size === Object.keys(findings).length, 'finding does not lead to approved advisory');
  return `WARNING: npm audit policy PASS with accepted residual risk, NOT FIXED: ${exception.advisory}; ` +
    `${counts.total} vulnerable packages (${severities.map((s) => `${s}=${counts[s]}`).join(', ')}); ` +
    `expires ${exception.expires}; tracking ${exception.trackingIssue ?? 'PENDING — attach issue before commit'}`;
}

// Fixed command, no shell or scanner-path override; JSON/lock files are data, never executable input.
export function runAudit({ cwd = resolve(root, 'ui'), scan = spawnSync,
  read = readFileSync, out = (text) => process.stdout.write(text),
  warn = (text) => process.stderr.write(`${text}\n`) } = {}) {
  try {
    const result = scan('npm', ['audit', '--json', '--include=dev', '--include=optional', '--include=peer', '--audit-level=low'],
      { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, shell: false });
    // Emit even malformed/failed scanner output before inspecting or loading policy.
    if (result.stdout) out(result.stdout);
    if (result.stderr) warn(result.stderr);
    const load = (path) => JSON.parse(read(path, 'utf8'));
    const exceptions = load(resolve(root, 'scripts/npm-audit-exceptions.json'));
    const lock = load(resolve(cwd, 'package-lock.json'));
    const installed = load(resolve(cwd, 'node_modules/.package-lock.json'));
    const message = evaluateAudit(result, exceptions, lock, installed);
    // Also prove the installed package version, not merely the hidden lock snapshot.
    for (const finding of Object.values(JSON.parse(result.stdout).vulnerabilities)) {
      for (const path of finding.nodes) {
        requireThat(load(resolve(cwd, path, 'package.json')).version === lock.packages[path].version,
          `installed package version drift: ${path}`);
      }
    }
    warn(message);
    return 0;
  } catch (error) {
    warn(`npm audit policy FAIL: ${error.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runAudit();
}
