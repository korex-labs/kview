import { describe, expect, it } from "vitest";
import { buildTagQuickFilters } from "./listFilters";
import type { ResourceTagsSettings } from "../settings";

type Row = {
  name: string;
  namespace: string;
  labels?: Record<string, string>;
};

function settings(patch: Partial<ResourceTagsSettings> = {}): ResourceTagsSettings {
  return {
    enabled: true,
    inheritNamespaceTags: true,
    quickFiltersEnabled: true,
    cleanupMissingAssignments: false,
    definitions: [
      { id: "prod", name: "Prod", color: "#d32f2f" },
      { id: "team-a", name: "Team A", color: "#1e88e5" },
      { id: "platform", name: "Platform", color: "#43a047" },
    ],
    autoTagRules: [
      {
        id: "auto-prod",
        enabled: true,
        tagIds: ["prod"],
        context: "",
        resources: ["pods"],
        source: "name",
        key: "",
        pattern: "^prod-",
        flags: "",
      },
      {
        id: "auto-platform",
        enabled: true,
        tagIds: ["platform"],
        context: "",
        resources: ["pods"],
        source: "label",
        key: "team",
        pattern: "platform",
        flags: "",
      },
    ],
    assignments: {
      "kind/namespaces//apps": ["team-a"],
    },
    ...patch,
  };
}

describe("buildTagQuickFilters", () => {
  const rows: Row[] = [
    { name: "prod-api", namespace: "apps", labels: { team: "platform" } },
    { name: "worker", namespace: "apps" },
  ];

  it("builds quick filters from direct, inherited, and auto tags", () => {
    const filters = buildTagQuickFilters(rows, settings(), (row) => ({
      context: "kind",
      resource: "pods",
      namespace: row.namespace,
      name: row.name,
      labels: row.labels,
    }));

    expect(filters).toEqual([
      { id: "tag:prod", label: "Prod", value: "tag:prod", count: 1, kind: "tag", color: "#d32f2f" },
      { id: "tag:team-a", label: "Team A", value: "tag:team-a", count: 2, kind: "tag", color: "#1e88e5" },
      { id: "tag:platform", label: "Platform", value: "tag:platform", count: 1, kind: "tag", color: "#43a047" },
    ]);
  });

  it("respects the tag quick filter setting", () => {
    const filters = buildTagQuickFilters(rows, settings({ quickFiltersEnabled: false }), (row) => ({
      context: "kind",
      resource: "pods",
      namespace: row.namespace,
      name: row.name,
    }));

    expect(filters).toEqual([]);
  });
});
