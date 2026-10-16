# kview update proxy and installation statistics

Deploy manually through the Cloudflare web dashboard. No Terraform, Wrangler, npm installation, Git integration, build step, or secret embedded in kview is required. `worker.js` is a standalone JavaScript ES module; `schema.sql` is the database schema. This guide does not imply the service has been deployed or verified on Cloudflare.

## Contract

- `GET /api/kview/releases/latest`: fixed GitHub release metadata proxy, independently cached for six hours. Does not write statistics.
- `POST /api/kview/statistics`: JSON `{ "installation_id": "<random UUID v4>", "version": "<normalized release version or development>" }`; successful ingestion returns 204. No cookies or browser analytics scripts.
- Local kview UI calls its authenticated Go backend. The backend supplies the installation ID and compiled version; no cluster context, resources, username, hostname or credentials are forwarded.
- Statistics require a separate, initially disabled browser-local checkbox. Settings/profile imports do not grant consent. Checks and statistics operate independently.
- Country is the backend's network egress country (VPN/proxy/remote server may change it), not proven user location. Dates are server UTC dates.
- Use one running kview backend per configuration directory. The local send lock deduplicates browser tabs within that backend, not independent processes sharing its state file; copying that file also copies installation identity.
- Counts describe participating installations, not people or total downloads. Stable random IDs are pseudonymous, not mathematically anonymous. The service receives IPs through ordinary networking; the application does not store them in D1 or log request payloads. Cloudflare's own operational/security processing is separate.

## 1. Create the D1 database

1. Open Cloudflare dashboard, **Storage & databases → D1** (navigation labels may change).
2. Create a database named `kview-statistics` on the intended account.
3. Open its **Console** and execute `schema.sql`. If the console only accepts one statement at a time, execute each complete statement separately; a `CREATE TRIGGER ... BEGIN ... END;` block is ONE statement.
4. Verify tables with `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;`.

The initial schema is rerunnable on the same schema version, not a migration mechanism for future changes. Do not delete an existing production database to apply updates.

## 2. Create the Worker

1. Open **Workers & Pages → Create application → Create Worker** (the Hello World/start-from-scratch option).
2. Name it `kview-services` and create it.
3. Open **Edit code**. Replace the starter module with the complete contents of `worker.js`; save/deploy.
4. Under the Worker's **Bindings**, add a **D1 database** binding. Variable name MUST be `DB`; select `kview-statistics`.
5. Save/deploy the binding change if requested. There are no required environment variables or secrets.
6. Review Worker observability/logging settings: do not add request-body, ID or IP logging. The supplied Worker does not log these values.

Do not enable interactive browser challenges on API paths: the client is a Go HTTP client. The public endpoint intentionally has no client secret. Input validation and deduplication are not authentication; determined callers can fabricate IDs. Monitor request/D1 quotas, and apply suitable dashboard rate limits if available under the account's plan. Do not assume every WAF/rate-limiting feature is included in Free. Emergency stop: remove the statistics route or temporarily return 503 for POST; update checks should remain available.

## 3. Verify on workers.dev first

Use the Worker's displayed `https://<worker>.<account>.workers.dev` URL with the SAME paths as production. Opening `/api/kview/releases/latest` should return JSON with `tag_name` and `html_url`. A statistics GET should return 405, and an unknown path 404.

To verify ingestion, issue a POST from a terminal or an HTTP client. Use a freshly generated test UUID v4 and record it for cleanup; do not use a real installation identity. For example, after replacing the placeholders:

```sh
curl -i -X POST 'https://<worker>.<account>.workers.dev/api/kview/statistics' \
  -H 'Content-Type: application/json' \
  --data '{"installation_id":"<test UUID v4>","version":"0.0.0"}'
```

Expected: HTTP 204. Submit the identical payload again and read back the database:

```sql
SELECT * FROM installations WHERE installation_id = '<test UUID v4>';
SELECT * FROM daily_activity WHERE installation_id = '<test UUID v4>';
SELECT * FROM daily_totals WHERE version = '0.0.0';
```

The duplicate must not increase the daily count. Submit a changed version for the same test ID and verify there is still only one installation/day and the aggregate moves to the new version. Use the **actual current schema** for cleanup: deleting raw activity alone intentionally does NOT decrement historical totals. Before any real clients are enabled, the simplest clean start is deleting all rows from `daily_activity`, `installations`, and `daily_totals` in this fresh test database. NEVER do this after real users have contributed data.

## 4. Attach only the API path to the existing site

Prerequisites: active `korex-labs.com` zone in this account, and existing hostname proxied by Cloudflare (orange cloud).

1. Worker → **Settings → Domains & Routes → Add → Route**.
2. Zone: `korex-labs.com`.
3. Route: **`korex-labs.com/api/kview/*`**.
4. Save. Check for overlapping routes or redirect/cache rules that would bypass the Worker.

**Do not attach the entire hostname as a Worker Custom Domain; do not change the site's S3 origin/DNS target.** This narrow route adds the API beside the existing site. Verify both the homepage and `/api/kview/releases/latest` after saving.

Repeat the test POST on the production hostname and read back its exact D1 row before declaring the deployment ready. Do not distribute a client release that depends on this service before this check. kview update checks fall back to direct GitHub on service failure; statistics failures are optional and do not affect Kubernetes operations.

## 5. Enable bounded retention maintenance

In the Worker's settings, add a **Cron Trigger**: `0 * * * *` (hourly, UTC). The `scheduled` handler performs bounded cleanup; a backlog may require multiple invocations. Cloudflare warns trigger changes can take up to 15 minutes to propagate. Verify an execution in the dashboard and inspect old raw-row counts before/after; absence of new logs does not prove execution.

Daily per-installation activity is retained for approximately 90 days, subject to bounded cleanup progress. Aggregate daily version/country counters are retained without installation IDs. The compact `installations` registry is retained until manually removed: it holds the random ID, first/last observation timestamps and latest version/country, so returning installations are not falsely counted as new. This is NOT deletion of every identifier after 90 days. Disabling consent stops future requests; it does not erase previously received data. Revisit registry retention if product/privacy requirements change.

## Reports and operating limits

`queries.sql` contains separate read-only reports to paste into the D1 console. DAU/WAU/MAU mean distinct observed installation IDs over UTC calendar windows including today. Historical daily version buckets are additive for a day, not across days; summing daily counts does not produce monthly unique users. Current version distribution uses the latest observation, not every version an installation used.

Monitor Workers requests, D1 rows read/written and database size in the dashboard. Other workloads share account quotas. Free quotas are hard availability boundaries, not unlimited capacity. Keep statistics errors independent of release checks. Cache is edge-local, not a global serialized GitHub fetch; bursts/cold edges may still encounter upstream rate limits. No public statistics/admin endpoint is included: use the authenticated Cloudflare dashboard.

## Deployment acceptance checklist

Do not mark cloud deployment complete from a successful Save/Deploy alone:

- [ ] Homepage still serves the existing site.
- [ ] Production release endpoint returns the expected GitHub tag and release URL.
- [ ] A test POST returns 204 and its exact ID is visible in D1.
- [ ] Duplicate POST does not increase daily active count; same-day version replacement keeps one installation/day.
- [ ] Unknown fields, invalid IDs and non-POST statistics requests are rejected.
- [ ] Cron execution is visible and expired raw rows are removed without losing aggregate history.
- [ ] Test data is removed before public use, without erasing genuine data.
- [ ] In kview, statistics OFF produces no statistics request; ON produces the expected D1 record.
- [ ] Updates and statistics settings work independently; disabling statistics stops subsequent sends.

## Updating and rollback

Keep the previous Worker source before pasting an update; use Worker deployment version rollback when available. Apply reviewed SQL migrations before code requiring them. Roll back Worker code without deleting statistics. Removing the narrow route restores ordinary origin handling for those paths; clients fall back to GitHub and statistics attempts fail harmlessly. The rest of the site must remain unchanged.

## References

- D1 dashboard creation and bindings: https://developers.cloudflare.com/d1/get-started/
- Worker routes: https://developers.cloudflare.com/workers/configuration/routing/routes/
- Cron triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- D1 quotas: https://developers.cloudflare.com/d1/platform/pricing/
