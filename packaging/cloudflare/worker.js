// Dashboard-deployable ES module. Optional GITHUB_TOKEN is a Worker Secret, never source code.
const RELEASE_PATH = "/api/kview/releases/latest";
const STATS_PATH = "/api/kview/statistics";
const GITHUB = "https://api.github.com/repos/korex-labs/kview/releases/latest";
const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reply = (status) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

async function boundedText(request, limit) {
  if (Number(request.headers.get("content-length")) > limit) throw new Error("size");
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error("size"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

async function statistics(request, env) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return reply(415);
  let data;
  try { data = JSON.parse(await boundedText(request, 512)); }
  catch { return reply(400); }
  if (!data || Array.isArray(data) || typeof data !== "object" ||
      Object.keys(data).sort().join(",") !== "installation_id,version" ||
      typeof data.installation_id !== "string" || !UUID.test(data.installation_id) ||
      typeof data.version !== "string" || data.version.length > 64 ||
      !(data.version === "development" || VERSION.test(data.version))) return reply(400);
  const country = /^[A-Z]{2}$/.test(request.cf?.country || "") ? request.cf.country : "XX";
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  // D1 batch is transactional. One activity row/day; triggers move aggregate buckets.
  // Guard both writes against older requests committing after a newer observation.
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO installations (installation_id, first_seen, last_seen, version, country)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(installation_id) DO UPDATE SET
      last_seen = excluded.last_seen, version = excluded.version, country = excluded.country
      WHERE excluded.last_seen >= installations.last_seen`)
      .bind(data.installation_id, now, now, data.version, country),
    env.DB.prepare(`INSERT INTO daily_activity (installation_id, day, version, country)
      SELECT installation_id, ?, version, country FROM installations
      WHERE installation_id = ? AND last_seen = ?
      ON CONFLICT(installation_id, day) DO UPDATE SET
      version = excluded.version, country = excluded.country
      WHERE daily_activity.version <> excluded.version OR daily_activity.country <> excluded.country`)
      .bind(day, data.installation_id, now),
  ]);
  return reply(204);
}

async function releases(request, env, ctx) {
  // Fixed canonical cache key; query strings/visitor headers never fragment metadata cache.
  const key = new Request("https://korex-labs.com" + RELEASE_PATH + "?cache=v2");
  const cached = await caches.default.match(key);
  if (cached) return cached;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "kview-release-proxy" };
  // Only the server-side secret is used. Never forward visitor headers or follow redirects.
  if (typeof env.GITHUB_TOKEN === "string" && env.GITHUB_TOKEN.trim()) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN.trim()}`;
  }
  const upstream = await fetch(GITHUB, {
    headers,
    redirect: "manual", signal: AbortSignal.timeout(7000),
  });
  if (!upstream.ok) return Response.json({ error: "github_http_error", upstream_status: upstream.status }, {
    status: 502, headers: { "Cache-Control": "no-store" },
  });
  const data = JSON.parse(await boundedText(upstream, 65536));
  if (typeof data.tag_name !== "string" || data.tag_name.length > 65 ||
      !VERSION.test(data.tag_name.replace(/^v/, "")) ||
      data.html_url !== "https://github.com/korex-labs/kview/releases/tag/" + data.tag_name) return reply(502);
  const response = Response.json({ tag_name: data.tag_name, html_url: data.html_url }, {
    headers: { "Cache-Control": "public, max-age=21600" },
  });
  ctx.waitUntil(caches.default.put(key, response.clone()));
  return response;
}

export async function cleanup(env) {
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  // Fixed work budget per hourly invocation; backlog drains on subsequent invocations.
  // Aggregates are independent of raw-row deletion (no decrements on cleanup).
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM daily_activity WHERE rowid IN
      (SELECT rowid FROM daily_activity WHERE day < ? ORDER BY day LIMIT 1000)`).bind(cutoff),

  ]);
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    try {
      if (path === RELEASE_PATH) return request.method === "GET" ? await releases(request, env, ctx) : reply(405);
      if (path === STATS_PATH) return request.method === "POST" ? await statistics(request, env) : reply(405);
      return reply(404);
    } catch { return reply(503); } // Never log request payloads, identifiers or IPs.
  },
  async scheduled(_event, env) { await cleanup(env); },
};
