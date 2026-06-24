import { describe, expect, it } from "vitest";
import {
  defaultResourceMemoryStore,
  getResourceMemoryRecord,
  normalizeResourceMemoryStore,
  removeResourceMemoryRecord,
  resourceMemoryTargetKey,
  upsertResourceMemoryRecord,
  type ResourceMemoryTarget,
} from "./resourceMemory";

const target: ResourceMemoryTarget = {
  context: "kind-dev",
  resource: "pods",
  namespace: "app-prod",
  name: "api-7f",
};

describe("resourceMemory", () => {
  it("keys records by context, resource, namespace, and name", () => {
    expect(resourceMemoryTargetKey(target)).toBe("kind-dev\x00pods\x00app-prod\x00api-7f");
  });

  it("upserts and removes local resource memory records", () => {
    const created = upsertResourceMemoryRecord(defaultResourceMemoryStore(), target, {
      status: "investigating",
      note: "Crash looping after deploy",
      runbookUrl: "https://runbooks.example/api",
      now: 1000,
    });

    expect(getResourceMemoryRecord(created, target)).toMatchObject({
      status: "investigating",
      note: "Crash looping after deploy",
      runbookUrl: "https://runbooks.example/api",
      createdAt: 1000,
      updatedAt: 1000,
    });

    const updated = upsertResourceMemoryRecord(created, target, {
      status: "known",
      note: "Known rollout issue",
      runbookUrl: "",
      now: 2000,
    });
    expect(getResourceMemoryRecord(updated, target)).toMatchObject({
      status: "known",
      note: "Known rollout issue",
      createdAt: 1000,
      updatedAt: 2000,
    });

    expect(getResourceMemoryRecord(removeResourceMemoryRecord(updated, target), target)).toBeNull();
  });

  it("normalizes persisted data and drops invalid records", () => {
    const key = resourceMemoryTargetKey(target);
    const normalized = normalizeResourceMemoryStore({
      v: 1,
      records: {
        [key]: {
          key,
          target,
          status: "do-not-touch",
          note: "  preserve during migration  ",
          runbookUrl: " https://runbooks.example/preserve ",
          createdAt: 10,
          updatedAt: 20,
        },
        bad: {
          target: { context: "", resource: "pods", name: "" },
          status: "broken",
        },
      },
    });

    expect(Object.keys(normalized.records)).toEqual([key]);
    expect(normalized.records[key]).toMatchObject({
      status: "do-not-touch",
      note: "preserve during migration",
      runbookUrl: "https://runbooks.example/preserve",
    });
  });
});
