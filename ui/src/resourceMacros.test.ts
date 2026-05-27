import { describe, expect, it } from "vitest";
import type { DynamicLinksSettings, ResourceMacrosSettings } from "./settings";
import { dynamicLinksForResource, resolveResourceMacros } from "./resourceMacros";

function macros(partial: Partial<ResourceMacrosSettings>): ResourceMacrosSettings {
  return {
    enabled: true,
    maxResolveDepth: 10,
    definitions: [],
    extractors: [],
    ...partial,
  };
}

const target = {
  context: "dev",
  resource: "deployments" as const,
  namespace: "apps",
  name: "api-OPS-1234",
  labels: { "app.kubernetes.io/part-of": "Web/Ops" },
  annotations: { "branch": "WPO-1234" },
};

describe("resource macros", () => {
  it("resolves inherited manual macros and resource-local overrides", () => {
    const result = resolveResourceMacros(macros({
      definitions: [
        {
          id: "global-url",
          enabled: true,
          macroName: "JIRA_URL",
          value: "https://jira.example.com",
          scope: { scope: "global", context: "", namespace: "", node: "", resource: "", name: "" },
        },
        {
          id: "local-url",
          enabled: true,
          macroName: "JIRA_URL",
          value: "https://jira.dev.example.com",
          scope: { scope: "namespace", context: "dev", namespace: "apps", node: "", resource: "", name: "" },
        },
      ],
    }), target);

    expect(result.macros.JIRA_URL.value).toBe("https://jira.dev.example.com");
  });

  it("matches namespace-scoped macros in namespace drawers", () => {
    const result = resolveResourceMacros(macros({
      definitions: [
        {
          id: "project",
          enabled: true,
          macroName: "GITLAB_PROJECT",
          value: "team/service",
          scope: { scope: "namespace", context: "dev", namespace: "apps", node: "", resource: "", name: "" },
        },
      ],
    }), {
      context: "dev",
      resource: "namespaces",
      namespace: "",
      name: "apps",
    });

    expect(result.macros.GITLAB_PROJECT.value).toBe("team/service");
  });

  it("extracts macros from names, labels, and annotations", () => {
    const result = resolveResourceMacros(macros({
      extractors: [
        {
          id: "issue",
          enabled: true,
          macroName: "JIRA_ISSUE",
          resources: ["deployments"],
          source: "name",
          key: "",
          pattern: "([A-Z]+-[0-9]+)",
          flags: "",
          valueTemplate: "$1",
          transform: "none",
        },
        {
          id: "project",
          enabled: true,
          macroName: "GITLAB_PROJECT",
          resources: [],
          source: "label",
          key: "app.kubernetes.io/part-of",
          pattern: "(.+)",
          flags: "",
          valueTemplate: "$1",
          transform: "none",
        },
        {
          id: "branch",
          enabled: true,
          macroName: "GITLAB_BRANCH",
          resources: [],
          source: "annotation",
          key: "branch",
          pattern: "(.+)",
          flags: "",
          valueTemplate: "$1",
          transform: "none",
        },
      ],
    }), target);

    expect(result.macros.JIRA_ISSUE.value).toBe("OPS-1234");
    expect(result.macros.GITLAB_PROJECT.value).toBe("Web/Ops");
    expect(result.macros.GITLAB_BRANCH.value).toBe("WPO-1234");
  });

  it("applies extracted macro value transforms", () => {
    const result = resolveResourceMacros(macros({
      extractors: [
        {
          id: "branch",
          enabled: true,
          macroName: "GITLAB_BRANCH",
          resources: ["deployments"],
          source: "name",
          key: "",
          pattern: "api-([a-z]+-[0-9]+)",
          flags: "",
          valueTemplate: "$1",
          transform: "uppercase",
        },
        {
          id: "project",
          enabled: true,
          macroName: "PROJECT_SLUG",
          resources: ["deployments"],
          source: "label",
          key: "app.kubernetes.io/part-of",
          pattern: "(.+)",
          flags: "",
          valueTemplate: "$1",
          transform: "lowercase",
        },
        {
          id: "owner",
          enabled: true,
          macroName: "OWNER",
          resources: ["deployments"],
          source: "annotation",
          key: "owner",
          pattern: "(.+)",
          flags: "",
          valueTemplate: "$1",
          transform: "ucfirst",
        },
      ],
    }), {
      ...target,
      name: "api-wpo-1234",
      annotations: { owner: "platform" },
    });

    expect(result.macros.GITLAB_BRANCH.value).toBe("WPO-1234");
    expect(result.macros.PROJECT_SLUG.value).toBe("web/ops");
    expect(result.macros.OWNER.value).toBe("Platform");
  });

  it("lets resource-local manual macros override extracted values", () => {
    const result = resolveResourceMacros(macros({
      definitions: [
        {
          id: "manual-issue",
          enabled: true,
          macroName: "JIRA_ISSUE",
          value: "OPS-9999",
          scope: { scope: "resource", context: "dev", namespace: "apps", node: "", resource: "deployments", name: "api-OPS-1234" },
        },
      ],
      extractors: [
        {
          id: "issue",
          enabled: true,
          macroName: "JIRA_ISSUE",
          resources: ["deployments"],
          source: "name",
          key: "",
          pattern: "([A-Z]+-[0-9]+)",
          flags: "",
          valueTemplate: "$1",
          transform: "none",
        },
      ],
    }), target);

    expect(result.macros.JIRA_ISSUE.value).toBe("OPS-9999");
  });

  it("resolves macros recursively and reports cycles", () => {
    const result = resolveResourceMacros(macros({
      definitions: [
        {
          id: "url",
          enabled: true,
          macroName: "JIRA_URL",
          value: "https://jira.example.com",
          scope: { scope: "global", context: "", namespace: "", node: "", resource: "", name: "" },
        },
        {
          id: "issue",
          enabled: true,
          macroName: "JIRA_ISSUE_URL",
          value: "$JIRA_URL/browse/OPS-1234",
          scope: { scope: "global", context: "", namespace: "", node: "", resource: "", name: "" },
        },
        {
          id: "a",
          enabled: true,
          macroName: "A",
          value: "$B",
          scope: { scope: "global", context: "", namespace: "", node: "", resource: "", name: "" },
        },
        {
          id: "b",
          enabled: true,
          macroName: "B",
          value: "$A",
          scope: { scope: "global", context: "", namespace: "", node: "", resource: "", name: "" },
        },
      ],
    }), target);

    expect(result.macros.JIRA_ISSUE_URL.value).toBe("https://jira.example.com/browse/OPS-1234");
    expect(result.errors.some((err) => err.includes("cycle"))).toBe(true);
  });

  it("builds only resolvable http links", () => {
    const macroSettings = macros({
      definitions: [
        {
          id: "gitlab-url",
          enabled: true,
          macroName: "GITLAB_URL",
          value: "https://git.example.com",
          scope: { scope: "global", context: "", namespace: "", node: "", resource: "", name: "" },
        },
      ],
      extractors: [
        {
          id: "project",
          enabled: true,
          macroName: "GITLAB_PROJECT",
          resources: [],
          source: "label",
          key: "app.kubernetes.io/part-of",
          pattern: "(.+)",
          flags: "",
          valueTemplate: "$1",
          transform: "none",
        },
      ],
    });
    const linkSettings: DynamicLinksSettings = {
      enabled: true,
      definitions: [
        {
          id: "repo",
          enabled: true,
          label: "GitLab Repo",
          urlTemplate: "$GITLAB_URL/$GITLAB_PROJECT",
        },
        {
          id: "missing",
          enabled: true,
          label: "Missing",
          urlTemplate: "$GITLAB_URL/$MISSING",
        },
      ],
    };

    expect(dynamicLinksForResource(macroSettings, linkSettings, target)).toEqual([
      { id: "repo", label: "GitLab Repo", url: "https://git.example.com/Web/Ops" },
    ]);
  });
});
