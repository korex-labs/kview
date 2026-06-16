// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  loadPersistedColumnWidths,
  resourceListRowMatchesSearchFields,
  savePersistedColumnWidths,
  shouldCleanupResourceTagAssignments,
} from "./ResourceListPage";
import type { DataplaneListMeta } from "../../types/api";

afterEach(() => {
  window.localStorage.clear();
});

const completeHotMeta: DataplaneListMeta = {
  state: "ok",
  freshness: "hot",
  coverage: "full",
  completeness: "complete",
};

describe("ResourceListPage resource tag cleanup", () => {
  it("does not cleanup namespace tag assignments from namespace list rows", () => {
    expect(shouldCleanupResourceTagAssignments("namespaces", completeHotMeta)).toBe(false);
  });

  it("requires an authoritative hot complete list before cleanup", () => {
    expect(shouldCleanupResourceTagAssignments("pods", completeHotMeta)).toBe(true);
    expect(shouldCleanupResourceTagAssignments("pods", { ...completeHotMeta, freshness: "cold" })).toBe(false);
    expect(shouldCleanupResourceTagAssignments("pods", { ...completeHotMeta, coverage: "partial" })).toBe(false);
    expect(shouldCleanupResourceTagAssignments("pods", { ...completeHotMeta, completeness: "unknown" })).toBe(false);
    expect(shouldCleanupResourceTagAssignments("pods", null)).toBe(false);
  });
});

describe("ResourceListPage persisted column widths", () => {
  it("loads only finite reasonable numeric widths", () => {
    const key = "kview:test:column-widths";
    window.localStorage.setItem(key, JSON.stringify({
      name: 240,
      tiny: 10,
      huge: 5000,
      bad: "120",
      ageSec: 129.6,
    }));

    expect(loadPersistedColumnWidths(key)).toEqual({ name: 240, ageSec: 130 });
  });

  it("saves cleaned widths and removes empty width state", () => {
    const key = "kview:test:column-widths-empty";

    savePersistedColumnWidths(key, { name: 250, bad: Number.NaN, tiny: 20 });
    expect(JSON.parse(window.localStorage.getItem(key) || "{}")).toEqual({ name: 250 });

    savePersistedColumnWidths(key, { bad: Number.NaN });
    expect(window.localStorage.getItem(key)).toBeNull();
  });
});

describe("ResourceListPage descriptor search fields", () => {
  it("matches scalar, array, and projected array-object fields", () => {
    const row = {
      name: "quota-main",
      status: "ok",
      clusterIPs: ["10.0.0.10", "10.0.0.11"],
      entries: [
        { key: "requests.cpu", used: "200m" },
        { key: "limits.memory", used: "1Gi" },
      ],
    };

    expect(resourceListRowMatchesSearchFields(row, ["name"], "quota")).toBe(true);
    expect(resourceListRowMatchesSearchFields(row, ["clusterIPs"], "10.0.0.11")).toBe(true);
    expect(resourceListRowMatchesSearchFields(row, ["entries.key"], "limits.memory")).toBe(true);
    expect(resourceListRowMatchesSearchFields(row, ["entries.used"], "500m")).toBe(false);
  });
});
