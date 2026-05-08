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
    cleanupMissingAssignments: true,
    definitions: [
      { id: "team-a", name: "Team A", color: "#1e88e5" },
      { id: "prod", name: "Prod", color: "#d32f2f" },
    ],
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
      { id: "prod", name: "Prod", color: "#d32f2f", inherited: false },
      { id: "team-a", name: "Team A", color: "#1e88e5", inherited: false },
    ]);
  });

  it("marks namespace-only tags as inherited on namespace resources", () => {
    const pod: ResourceTagTarget = { context: "kind", resource: "pods", namespace: "app", name: "api" };
    const settings = withResourceTagAssignment(baseSettings(), namespaceTagTarget("kind", "app"), ["team-a"]);
    const tags = resourceTagsForTarget(settings, buildResourceTagsIndex(settings), pod);

    expect(tags).toEqual([{ id: "team-a", name: "Team A", color: "#1e88e5", inherited: true }]);
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
});
