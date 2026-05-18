import { describe, expect, it } from "vitest";
import { shouldCleanupResourceTagAssignments } from "./ResourceListPage";
import type { DataplaneListMeta } from "../../types/api";

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
