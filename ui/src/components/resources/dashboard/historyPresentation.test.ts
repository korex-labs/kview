import { expect, it } from "vitest";
import { historyError, historyStorage } from "./historyPresentation";

it.each([
  [0, "0 B"], [512, "512 B"], [2048, "2.0 KB"],
  [1572864, "1.5 MB"], [1073741824, "1.0 GB"],
])("formats retained payload %s with shared human-readable units", (retainedBytes, formatted) => {
  const storage = historyStorage({ retainedHours: 31, retainedBytes: Number(retainedBytes), databaseBytes: 2097152 });
  expect(storage.label).toBe(`Persisted 31h · ${formatted}`);
  expect(storage.title).toContain("Retained hourly records for this context, not the selected period.");
  expect(storage.title).toContain(`Payload ${formatted} across contexts (hourly records and current state)`);
  expect(storage.title).toContain("database 2.0 MB includes overhead and other history data");
});

it.each([401, 403])("reports denied access for %s", status => {
  expect(historyError({ status })).toContain("access denied");
});
it("reports unavailable scope, storage and transport errors without gauge instructions", () => {
  expect(historyError({ status: 404 })).toBe("No retained signal history is available for this exact scope.");
  expect(historyError({ status: 422 })).toContain("shorter period");
  expect(historyError({ status: 422 })).not.toContain("storage is unavailable");
  expect(historyError({ status: 503 })).toContain("storage is unavailable");
  expect(historyError({ status: 409 })).toContain("Settings → Dataplane → History");
  expect(historyError(new Error("offline"))).toBe("History error: offline");
  expect(historyError(null)).toContain("Could not read local history");
});
