import { describe, expect, it } from "vitest";
import {
  buildResourceTagsIndex,
  cleanupResourceTagAssignmentsForScope,
  namespaceTagTarget,
  resourceTagFilterMatches,
  resourceTagsForTarget,
  resourceTagTargetKey,
  withResourceTagAssignment,
  type ResourceTagTarget,
} from "./resourceTags";
import type { ResourceTagsSettings } from "./settings";

function baseSettings(): ResourceTagsSettings {
  return {
    enabled: true,
    inheritNamespaceTags: true,
    quickFiltersEnabled: true,
    cleanupMissingAssignments: true,
    definitions: [
      { id: "team-a", name: "Team A", color: "#1e88e5" },
      { id: "prod", name: "Prod", color: "#d32f2f" },
    ],
    autoTagRules: [],
    assignments: {},
  };
}

describe("resource tags", () => {
  it("builds stable escaped target keys", () => {
    expect(resourceTagTargetKey({
      context: "kind/dev",
      resource: "pods",
      namespace: "app",
      name: "api",
    })).toBe("kind%2Fdev/pods/app/api");
  });

  it("resolves direct and inherited namespace tags", () => {
    const pod: ResourceTagTarget = { context: "kind", resource: "pods", namespace: "app", name: "api" };
    const settings = withResourceTagAssignment(
      withResourceTagAssignment(baseSettings(), namespaceTagTarget("kind", "app"), ["team-a"]),
      pod,
      ["prod", "team-a"],
    );
    const tags = resourceTagsForTarget(settings, buildResourceTagsIndex(settings), pod);

    expect(tags).toEqual([
      { id: "prod", name: "Prod", color: "#d32f2f", inherited: false, source: "direct" },
      { id: "team-a", name: "Team A", color: "#1e88e5", inherited: false, source: "direct" },
    ]);
  });

  it("marks namespace-only tags as inherited on namespace resources", () => {
    const pod: ResourceTagTarget = { context: "kind", resource: "pods", namespace: "app", name: "api" };
    const settings = withResourceTagAssignment(baseSettings(), namespaceTagTarget("kind", "app"), ["team-a"]);
    const tags = resourceTagsForTarget(settings, buildResourceTagsIndex(settings), pod);

    expect(tags).toEqual([{ id: "team-a", name: "Team A", color: "#1e88e5", inherited: true, source: "inherited" }]);
  });

  it("updates direct assignments without storing unknown tag ids", () => {
    const pod: ResourceTagTarget = { context: "kind", resource: "pods", namespace: "app", name: "api" };
    const settings = withResourceTagAssignment(baseSettings(), pod, ["missing", "prod", "prod"]);

    expect(settings.assignments).toEqual({
      [resourceTagTargetKey(pod)]: ["prod"],
    });
    expect(withResourceTagAssignment(settings, pod, []).assignments).toEqual({});
  });

  it("cleans assignments only inside the visible scope", () => {
    const api: ResourceTagTarget = { context: "kind", resource: "pods", namespace: "app", name: "api" };
    const worker: ResourceTagTarget = { context: "kind", resource: "pods", namespace: "app", name: "worker" };
    const other: ResourceTagTarget = { context: "kind", resource: "deployments", namespace: "app", name: "api" };
    const settings = withResourceTagAssignment(
      withResourceTagAssignment(withResourceTagAssignment(baseSettings(), api, ["team-a"]), worker, ["prod"]),
      other,
      ["prod"],
    );

    const cleaned = cleanupResourceTagAssignmentsForScope(settings, [api], true);

    expect(cleaned.assignments).toEqual({
      [resourceTagTargetKey(api)]: ["team-a"],
      [resourceTagTargetKey(other)]: ["prod"],
    });
  });

  it("matches tag filters against resolved tags", () => {
    const pod: ResourceTagTarget = { context: "kind", resource: "pods", namespace: "app", name: "api" };
    const settings = withResourceTagAssignment(baseSettings(), namespaceTagTarget("kind", "app"), ["team-a"]);
    const index = buildResourceTagsIndex(settings);

    expect(resourceTagFilterMatches(settings, index, pod, "tag:team")).toBe(true);
    expect(resourceTagFilterMatches(settings, index, pod, "api")).toBe(false);
  });

  it("resolves auto tags from resource names and labels", () => {
    const pod: ResourceTagTarget = {
      context: "kind",
      resource: "pods",
      namespace: "app",
      name: "prod-api",
      labels: { team: "platform" },
    };
    const settings: ResourceTagsSettings = {
      ...baseSettings(),
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
          id: "auto-team",
          enabled: true,
          tagIds: ["team-a"],
          context: "kind",
          resources: [],
          source: "label",
          key: "team",
          pattern: "platform",
          flags: "",
        },
      ],
    };

    const tags = resourceTagsForTarget(settings, buildResourceTagsIndex(settings), pod);

    expect(tags).toEqual([
      { id: "prod", name: "Prod", color: "#d32f2f", inherited: false, source: "auto" },
      { id: "team-a", name: "Team A", color: "#1e88e5", inherited: false, source: "auto" },
    ]);
  });

  it("inherits namespace auto tags on namespaced resources", () => {
    const pod: ResourceTagTarget = {
      context: "kind",
      resource: "pods",
      namespace: "prod-app",
      name: "api",
    };
    const settings: ResourceTagsSettings = {
      ...baseSettings(),
      autoTagRules: [
        {
          id: "auto-namespace",
          enabled: true,
          tagIds: ["prod"],
          context: "",
          resources: ["namespaces"],
          source: "name",
          key: "",
          pattern: "^prod-",
          flags: "",
        },
      ],
    };

    expect(resourceTagsForTarget(settings, buildResourceTagsIndex(settings), pod)).toEqual([
      { id: "prod", name: "Prod", color: "#d32f2f", inherited: true, source: "inherited" },
    ]);
  });

  it("ignores incomplete auto tag rules", () => {
    const pod: ResourceTagTarget = { context: "kind", resource: "pods", namespace: "app", name: "prod-api" };
    const settings: ResourceTagsSettings = {
      ...baseSettings(),
      autoTagRules: [
        {
          id: "auto-empty",
          enabled: true,
          tagIds: ["prod"],
          context: "",
          resources: [],
          source: "name",
          key: "",
          pattern: "",
          flags: "",
        },
      ],
    };

    expect(resourceTagsForTarget(settings, buildResourceTagsIndex(settings), pod)).toEqual([]);
  });
});
