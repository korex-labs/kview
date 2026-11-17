import { expect, it } from "vitest";
import { historyError } from "./historyPresentation";

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
