-- Execute each SELECT separately in the Cloudflare D1 dashboard Console.
-- UTC calendar windows including today; participating installations, not people.

-- Daily / weekly / monthly active installations.
SELECT
  COUNT(DISTINCT CASE WHEN day = date('now') THEN installation_id END) AS dau,
  COUNT(DISTINCT CASE WHEN day >= date('now', '-6 days') THEN installation_id END) AS wau,
  COUNT(DISTINCT installation_id) AS mau
FROM daily_activity WHERE day >= date('now', '-29 days');

-- Latest observed version among installations active in the last 30 UTC days.
SELECT version, COUNT(*) AS installations
FROM installations WHERE date(last_seen) >= date('now', '-29 days')
GROUP BY version ORDER BY installations DESC, version;

-- Latest observed egress country, not necessarily the person's location.
SELECT country, COUNT(*) AS installations
FROM installations WHERE date(last_seen) >= date('now', '-29 days')
GROUP BY country ORDER BY installations DESC, country;

-- First observations, not proven new people/downloads.
SELECT date(first_seen) AS day, COUNT(*) AS first_observed
FROM installations WHERE date(first_seen) >= date('now', '-29 days')
GROUP BY date(first_seen) ORDER BY day;

-- Historical daily active installations: valid only with one version/country per ID/day.
-- Never sum these across days to derive monthly unique installations.
SELECT day, SUM(installations) AS daily_active
FROM daily_totals WHERE day >= date('now', '-89 days')
GROUP BY day ORDER BY day;

-- Daily release adoption, retaining the final observed version per installation/day.
SELECT day, version, SUM(installations) AS installations
FROM daily_totals WHERE day >= date('now', '-29 days') AND installations > 0
GROUP BY day, version ORDER BY day, installations DESC;

-- Retention backlog (bounded hourly cleanup can take time to drain).
SELECT COUNT(*) AS expired_activity_rows
FROM daily_activity WHERE day < date('now', '-90 days');
