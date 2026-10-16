-- Fresh-schema setup in D1 dashboard Console; safe to re-run this version.
-- Compact installation registry and anonymous daily totals are retained indefinitely.
CREATE TABLE IF NOT EXISTS installations (
  installation_id TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  version TEXT NOT NULL,
  country TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS installations_last_seen ON installations(last_seen);
CREATE TABLE IF NOT EXISTS daily_activity (
  installation_id TEXT NOT NULL,
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  country TEXT NOT NULL,
  UNIQUE (installation_id, day)
);
CREATE INDEX IF NOT EXISTS daily_activity_day ON daily_activity(day);
CREATE TABLE IF NOT EXISTS daily_totals (
  day TEXT NOT NULL,
  version TEXT NOT NULL,
  country TEXT NOT NULL,
  installations INTEGER NOT NULL CHECK (installations >= 0),
  UNIQUE (day, version, country)
);
CREATE INDEX IF NOT EXISTS daily_totals_day ON daily_totals(day);
CREATE TRIGGER IF NOT EXISTS activity_insert_totals AFTER INSERT ON daily_activity
BEGIN
  INSERT INTO daily_totals(day, version, country, installations)
  VALUES (NEW.day, NEW.version, NEW.country, 1)
  ON CONFLICT(day, version, country) DO UPDATE SET installations = installations + 1;
END;
CREATE TRIGGER IF NOT EXISTS activity_update_totals AFTER UPDATE ON daily_activity
WHEN OLD.version <> NEW.version OR OLD.country <> NEW.country
BEGIN
  UPDATE daily_totals SET installations = installations - 1
    WHERE day = OLD.day AND version = OLD.version AND country = OLD.country;
  DELETE FROM daily_totals WHERE day = OLD.day AND version = OLD.version
    AND country = OLD.country AND installations = 0;
  INSERT INTO daily_totals(day, version, country, installations)
  VALUES (NEW.day, NEW.version, NEW.country, 1)
  ON CONFLICT(day, version, country) DO UPDATE SET installations = installations + 1;
END;
-- No delete trigger: expiring raw activity must not erase historical totals.
