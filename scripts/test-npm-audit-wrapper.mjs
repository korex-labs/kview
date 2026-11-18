import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateAudit, runAudit } from './check-npm-vulnerabilities.mjs';

// Synthetic data, no network, subprocesses, package imports or executable fixture files.
const now = new Date('2026-11-18T00:00:00Z');
function fixture() {
  const advisory = { source: 1247710, name: 'picomatch', dependency: 'picomatch',
    url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf', severity: 'high' };
  const report = { auditReportVersion: 2, vulnerabilities: {
    picomatch: { name: 'picomatch', severity: 'high', nodes: ['node_modules/picomatch'], via: [advisory] },
    vite: { name: 'vite', severity: 'high', nodes: ['node_modules/vite'], via: ['picomatch'] },
  }, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0, total: 2 } } };
  const exceptions = [{ advisory: 'GHSA-fc5q-39xc-vjpf', url: advisory.url, source: advisory.source,
    package: 'picomatch', reason: 'Reviewed temporary development-tool risk', trackingIssue: null,
    expires: '2026-12-02T00:00:00Z', paths: { 'node_modules/picomatch': 'picomatch', 'node_modules/vite': 'vite' } }];
  const lock = { packages: { 'node_modules/picomatch': { dev: true, version: '4.0.7' },
    'node_modules/vite': { dev: true, version: '8.0.0' } } };
  return { report, exceptions, lock, installed: structuredClone(lock), status: 1, now };
}
const evaluate = (f) => evaluateAudit({ status: f.status, stdout: JSON.stringify(f.report),
  error: f.error, signal: f.signal }, f.exceptions, f.lock, f.installed, f.now);
function clean(f) {
  f.report.vulnerabilities = {};
  f.report.metadata.vulnerabilities.high = 0;
  f.report.metadata.vulnerabilities.total = 0;
  f.status = 0;
}
test('allowed risk remains visibly NOT FIXED', () => assert.match(evaluate(fixture()), /WARNING:.*NOT FIXED/));
test('clean with no exceptions', () => {
  const f = fixture(); clean(f); f.exceptions = [];
  assert.match(evaluate(f), /zero vulnerabilities/);
});
const failures = [
  ['stale on clean scan', (f) => clean(f), /stale exception/],
  ['unexpected advisory URL despite matching title', (f) => {
    f.report.vulnerabilities.picomatch.via[0].url += '?spoof';
    f.report.vulnerabilities.picomatch.via[0].title = 'picomatch vulnerable to ReDoS through single-branch repeated extglobs';
  }, /unexpected advisory/],
  ['unexpected second advisory', (f) => f.report.vulnerabilities.picomatch.via.push({ url: 'https://github.com/advisories/GHSA-xxxx-yyyy-zzzz' }), /unexpected advisory/],
  ['source identity mismatch', (f) => f.report.vulnerabilities.picomatch.via[0].source++, /unexpected advisory/],
  ['package identity mismatch', (f) => f.report.vulnerabilities.picomatch.via[0].dependency = 'other', /unexpected advisory/],
  ['expiry at start of UTC deadline', (f) => f.now = new Date('2026-12-02T00:00:00Z'), /expired/],
  ['after expiry', (f) => f.now = new Date('2026-12-03T00:00:00Z'), /expired/],
  ['bad expiry', (f) => f.exceptions[0].expires = 'tomorrow', /expired/],
  ['invalid calendar expiry', (f) => f.exceptions[0].expires = '2026-11-31T00:00:00Z', /expired/],
  ['malformed report', (f) => f.report = {}, /malformed/],
  ['registry transport error', (f) => f.report.error = { code: 'ECONNRESET' }, /malformed/],
  ['nonexpected scanner exit', (f) => f.status = 2, /scanner failed/],
  ['spawn failure', (f) => f.error = new Error('ENOENT'), /scanner failed/],
  ['timeout signal', (f) => f.signal = 'SIGTERM', /scanner failed/],
  ['false successful scanner exit', (f) => f.status = 0, /inconsistent scanner/],
  ['failed clean scanner', (f) => { clean(f); f.status = 1; }, /inconsistent scanner/],
  ['new development path', (f) => f.report.vulnerabilities.picomatch.nodes.push('node_modules/new/node_modules/picomatch'), /unapproved package path/],
  ['production path in committed lock', (f) => delete f.lock.packages['node_modules/vite'].dev, /non-dev/],
  ['production path in installed lock', (f) => delete f.installed.packages['node_modules/picomatch'].dev, /non-dev/],
  ['optional production path', (f) => f.installed.packages['node_modules/vite'].devOptional = true, /non-dev/],
  ['linked path', (f) => f.lock.packages['node_modules/picomatch'].link = true, /non-dev/],
  ['installed version drift', (f) => f.installed.packages['node_modules/picomatch'].version = '9.0.0', /drifted/],
  ['missing installed lock', (f) => f.installed = {}, /missing lock/],
  ['all via edges checked', (f) => f.report.vulnerabilities.vite.via.push('unknown'), /unresolved via/],
  ['unrooted cycle', (f) => f.report.vulnerabilities.vite.via = ['vite'], /does not lead/],
  ['stale advisory in cyclic findings', (f) => f.report.vulnerabilities.picomatch.via = ['vite'], /stale exception/],
  ['malformed via', (f) => f.report.vulnerabilities.vite.via = [null], /unexpected advisory/],
  ['empty nodes', (f) => f.report.vulnerabilities.vite.nodes = [], /malformed/],
  ['counts inconsistent', (f) => f.report.metadata.vulnerabilities.total++, /inconsistent audit counts/],
  ['no exception for findings', (f) => f.exceptions = [], /without exception/],
];
for (const [name, mutate, message] of failures) {
  test(name, () => { const f = fixture(); mutate(f); assert.throws(() => evaluate(f), message); });
}
test('accepted until the last millisecond before deadline', () => {
  const f = fixture(); f.now = new Date('2026-12-01T23:59:59.999Z'); assert.match(evaluate(f), /PASS/);
});
test('severity changes do not conceal a new ID or bind policy to counts', () => {
  const f = fixture(); f.report.vulnerabilities.picomatch.severity = 'critical';
  f.report.vulnerabilities.picomatch.via[0].severity = 'critical';
  f.report.metadata.vulnerabilities.high = 1; f.report.metadata.vulnerabilities.critical = 1;
  assert.match(evaluate(f), /critical=1/);
});
test('cycles rooted in approved advisory are accepted', () => {
  const f = fixture(); f.report.vulnerabilities.picomatch.via.push('vite');
  assert.match(evaluate(f), /PASS/);
});
test('malformed JSON fails', () => assert.throws(() => evaluateAudit({ status: 1, stdout: '{' }, [], {}, {}, now)));

function runFixture(f, raw = JSON.stringify(f.report), packageVersion = '4.0.7') {
  let stdout = ''; let stderr = ''; let called = false;
  const code = runAudit({
    scan: (command, args, options) => {
      called = true; assert.equal(command, 'npm'); assert.equal(options.shell, false);
      assert.deepEqual(args, ['audit', '--json', '--include=dev', '--include=optional', '--include=peer', '--audit-level=low']);
      return { status: f.status, stdout: raw, stderr: 'scanner stderr', error: f.error, signal: f.signal };
    },
    read: (path) => JSON.stringify(path.endsWith('npm-audit-exceptions.json') ? f.exceptions :
      path.endsWith('node_modules/.package-lock.json') ? f.installed :
      path.endsWith('package-lock.json') ? f.lock :
      { version: path.includes('/vite/') ? '8.0.0' : packageVersion }),
    out: (text) => stdout += text, warn: (text) => stderr += text,
  });
  assert.ok(called); assert.equal(stdout, raw); assert.match(stderr, /scanner stderr/);
  return { code, stderr };
}
test('runner retains raw malformed scanner output without executing it', () => {
  const f = fixture(); const r = runFixture(f, 'process.exit(0);');
  assert.equal(r.code, 1); assert.match(r.stderr, /FAIL/);
});
test('runner retains raw output for scanner failure', () => {
  const f = fixture(); f.status = 42; assert.equal(runFixture(f).code, 1);
});
test('runner checks real installed package versions', () => {
  const f = fixture(); f.exceptions[0].expires = '2099-12-02T00:00:00Z';
  const r = runFixture(f, JSON.stringify(f.report), '0.0.0');
  assert.equal(r.code, 1); assert.match(r.stderr, /installed package version drift/);
});
test('runner emits acceptance with untouched raw counts', () => {
  const f = fixture(); f.exceptions[0].expires = '2099-12-02T00:00:00Z';
  const r = runFixture(f); assert.equal(r.code, 0); assert.match(r.stderr, /NOT FIXED/);
});
