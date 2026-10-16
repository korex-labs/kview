// Local execution against real SQLite, not a Cloudflare deployment/emulator.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const { default: worker, cleanup } = await import("data:text/javascript;base64," +
  Buffer.from(readFileSync(new URL("worker.js", import.meta.url))).toString("base64"));
function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("schema.sql", import.meta.url), "utf8"));
  return { sqlite, DB: {
    prepare(sql) { return { bind(...args) { return { sql, args }; } }; },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { for (const { sql, args } of statements) sqlite.prepare(sql).run(...args); sqlite.exec("COMMIT"); }
      catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    },
  } };
}
const id = "11111111-2222-4333-8444-555555555555";
function request(data, country = "FI") {
  const req = new Request("https://korex-labs.com/api/kview/statistics", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  req.cf = { country };
  return req;
}
test("D1 SQL: duplicate/version/day semantics, trusted country/date and aggregates", async () => {
  const env = database();
  const send = (v = "5.2.1", c) => worker.fetch(request({ installation_id: id, version: v }, c), env, {});
  assert.equal((await send()).status, 204);
  assert.equal((await send()).status, 204);
  assert.equal((await send("5.2.2", "US")).status, 204);
  assert.equal((await send("development", "bad-country")).status, 204);
  assert.equal(env.sqlite.prepare("SELECT count(*) AS n FROM installations").get().n, 1);
  assert.equal(env.sqlite.prepare("SELECT count(*) AS n FROM daily_activity").get().n, 1);
  assert.equal(env.sqlite.prepare("SELECT sum(installations) AS n FROM daily_totals").get().n, 1);
  assert.equal(env.sqlite.prepare("SELECT country FROM daily_activity WHERE version='development'").get().country, "XX");
  assert.equal(env.sqlite.prepare("SELECT day FROM daily_activity LIMIT 1").get().day, new Date().toISOString().slice(0, 10));
  env.sqlite.close();
});
test("rejects invalid schema, UUID, version, oversized bodies, methods and paths", async () => {
  const env = database();
  for (const payload of [null, [], {}, { installation_id: "not-uuid", version: "5.2.1" },
    { installation_id: id, version: "commit123" }, { installation_id: id, version: "v5.2.1" },
    { installation_id: id, version: "5.2.1", country: "US" },
    { installation_id: id, version: "x".repeat(600) }]) {
    assert.equal((await worker.fetch(request(payload), env, {})).status, 400);
  }
  assert.equal((await worker.fetch(new Request("https://korex-labs.com/api/kview/statistics"), env, {})).status, 405);
  assert.equal((await worker.fetch(new Request("https://korex-labs.com/other"), env, {})).status, 404);
  assert.equal(env.sqlite.prepare("SELECT count(*) AS n FROM installations").get().n, 0);
  env.sqlite.close();
});
test("cleanup bounds raw deletion and preserves historical totals and first seen", async () => {
  const env = database();
  const insert = env.sqlite.prepare("INSERT INTO daily_activity VALUES (?, '2000-01-01', '1.0.0', 'XX')");
  for (let n = 0; n < 1005; n++) insert.run(String(n));
  env.sqlite.prepare("INSERT INTO installations VALUES (?, '2000-01-01T00:00:00.000Z', '2000-01-01T00:00:00.000Z', '1.0.0', 'XX')").run(id);
  await worker.fetch(request({ installation_id: id, version: "5.2.1" }), env, {});
  await cleanup(env);
  assert.equal(env.sqlite.prepare("SELECT count(*) AS n FROM daily_activity").get().n, 6);
  assert.equal(env.sqlite.prepare("SELECT sum(installations) AS n FROM daily_totals").get().n, 1006);
  await cleanup(env);
  assert.equal(env.sqlite.prepare("SELECT count(*) AS n FROM daily_activity").get().n, 1);
  assert.equal(env.sqlite.prepare("SELECT sum(installations) AS n FROM daily_totals").get().n, 1006);
  const registry = env.sqlite.prepare("SELECT * FROM installations").get();
  assert.equal(registry.first_seen, "2000-01-01T00:00:00.000Z");
  assert.equal(registry.version, "5.2.1");
  assert.equal(registry.country, "FI");
  assert.match(registry.last_seen, /T/);
  env.sqlite.close();
});
test("duplicate activity does not rewrite buckets; upgrade and rollback move one count", async () => {
  const env = database();
  const send = version => worker.fetch(request({ installation_id: id, version }), env, {});
  await send("5.2.1");
  env.sqlite.exec("CREATE TABLE updates(n INTEGER); INSERT INTO updates VALUES(0); CREATE TRIGGER count_updates AFTER UPDATE ON daily_activity BEGIN UPDATE updates SET n=n+1; END");
  await send("5.2.1");
  assert.equal(env.sqlite.prepare("SELECT n FROM updates").get().n, 0);
  await send("5.2.2");
  await send("5.2.1");
  assert.equal(env.sqlite.prepare("SELECT n FROM updates").get().n, 2);
  const totals = env.sqlite.prepare("SELECT version, installations FROM daily_totals").all();
  assert.deepEqual(totals.map(r => ({...r})), [{version: "5.2.1", installations: 1}]);
  env.sqlite.close();
});
test("an older overlapping request cannot overwrite a newer registry or daily bucket", async () => {
  const env = database();
  await worker.fetch(request({ installation_id: id, version: "5.2.2" }), env, {});
  // Simulate a newer request winning the transactional write before an older one.
  env.sqlite.exec("UPDATE installations SET last_seen='2099-01-01T00:00:00.000Z'");
  await worker.fetch(request({ installation_id: id, version: "5.2.1" }), env, {});
  assert.equal(env.sqlite.prepare("SELECT version FROM installations").get().version, "5.2.2");
  assert.equal(env.sqlite.prepare("SELECT version FROM daily_activity").get().version, "5.2.2");
  assert.equal(env.sqlite.prepare("SELECT sum(installations) AS n FROM daily_totals").get().n, 1);
  env.sqlite.close();
});
test("manual reporting SQL executes against the deployed schema", () => {
  const env = database();
  const sql = readFileSync(new URL("queries.sql", import.meta.url), "utf8");
  for (const statement of sql.replace(/--[^\n]*/g, "").split(";").filter(part => part.trim())) {
    env.sqlite.prepare(statement).all();
  }
  env.sqlite.close();
});
test("release proxy rejects redirects without following or caching them", async () => {
  const savedFetch = globalThis.fetch;
  const savedCaches = globalThis.caches;
  let calls = 0;
  globalThis.caches = { default: { async match() { return undefined; }, async put() { assert.fail("redirect cached"); } } };
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "manual");
    return new Response(null, { status: 302, headers: { Location: "https://example.invalid/" } });
  };
  try {
    const res = await worker.fetch(new Request("https://korex-labs.com/api/kview/releases/latest"), {}, {});
    assert.equal(res.status, 502);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = savedFetch; globalThis.caches = savedCaches; }
});
test("Worker secret authenticates only fixed GitHub fetch and never enters cache or response", async () => {
  const savedFetch = globalThis.fetch, savedCaches = globalThis.caches;
  const secret = "test-only-not-a-real-token";
  let cached, calls = 0;
  globalThis.caches = { default: {
    async match() { return cached?.clone(); },
    async put(key, res) { assert.equal(key.headers.get("Authorization"), null); cached = res; },
  } };
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, "https://api.github.com/repos/korex-labs/kview/releases/latest");
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.equal(options.redirect, "manual");
    return Response.json({ tag_name: "v5.2.1", html_url: "https://github.com/korex-labs/kview/releases/tag/v5.2.1" });
  };
  try {
    const pending = [], ctx = { waitUntil(p) { pending.push(p); } };
    const req = new Request("https://korex-labs.com/api/kview/releases/latest", { headers: { Authorization: "Bearer visitor-not-forwarded" } });
    const res = await worker.fetch(req, { GITHUB_TOKEN: secret }, ctx);
    assert.equal(res.status, 200);
    assert.equal((await res.text()).includes(secret), false);
    assert.equal(JSON.stringify([...res.headers]).includes(secret), false);
    await Promise.all(pending);
    assert.equal((await cached.clone().text()).includes(secret), false);
    assert.equal((await worker.fetch(req, { GITHUB_TOKEN: secret }, ctx)).status, 200);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = savedFetch; globalThis.caches = savedCaches; }
});
test("release cache is separate from D1/statistics and strips unrelated metadata", async () => {
  const savedFetch = globalThis.fetch;
  const savedCaches = globalThis.caches;
  let cached; let calls = 0;
  globalThis.caches = { default: {
    async match() { return cached?.clone(); }, async put(_key, value) { cached = value; },
  } };
  globalThis.fetch = async (url, options) => {
    calls++; assert.equal(url, "https://api.github.com/repos/korex-labs/kview/releases/latest");
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, "manual");
    return Response.json({ tag_name: "v5.2.1", html_url: "https://github.com/korex-labs/kview/releases/tag/v5.2.1", author: "discard" });
  };
  try {
    const pending = []; const ctx = { waitUntil(p) { pending.push(p); } };
    const req = new Request("https://korex-labs.com/api/kview/releases/latest?ignored=1");
    assert.equal((await worker.fetch(req, {}, ctx)).status, 200);
    await Promise.all(pending);
    const res = await worker.fetch(req, {}, ctx);
    assert.equal(calls, 1); assert.equal(res.headers.get("cache-control"), "public, max-age=21600");
    assert.deepEqual(await res.json(), { tag_name: "v5.2.1", html_url: "https://github.com/korex-labs/kview/releases/tag/v5.2.1" });
  } finally { globalThis.fetch = savedFetch; globalThis.caches = savedCaches; }
});
