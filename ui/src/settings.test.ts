// @vitest-environment node

import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDataplaneProfile,
  applySettingsTransferBundle,
  defaultDataplaneSettings,
  defaultUserSettings,
  exportSettingsTransferJSON,
  exportUserSettingsJSON,
  customCommandsForContainer,
  customActionsForResource,
  dataplaneSettingsForContext,
  labelForSmartFilterRules,
  loadUserSettings,
  parseSettingsTransferJSON,
  parseUserSettingsJSON,
  settingsTransferSectionIds,
  smartFilterResourceKeysForScope,
  validateUserSettings,
  USER_SETTINGS_KEY,
} from "./settings";

describe("user settings", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          clear: () => store.clear(),
          getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
          removeItem: (key: string) => store.delete(key),
          setItem: (key: string, value: string) => store.set(key, value),
        },
      },
    });
  });

  it("loads defaults when no profile exists", () => {
    expect(loadUserSettings()).toEqual(defaultUserSettings());
  });

  it("enables dataplane persistence by default", () => {
    expect(defaultUserSettings().dataplane.global.persistence.enabled).toBe(true);
    expect(validateUserSettings({ v: 1 })?.dataplane.global.persistence.enabled).toBe(true);
  });

  it("keeps all-context enrichment disabled by default", () => {
    const defaults = defaultUserSettings().dataplane.global.allContextEnrichment;
    expect(defaults.enabled).toBe(false);
    expect(defaults.maxContextsPerCycle).toBe(1);
    expect(validateUserSettings({ v: 1 })?.dataplane.global.allContextEnrichment.enabled).toBe(false);
  });

  it("applies dataplane signal defaults on first startup", () => {
    const defaults = defaultDataplaneSettings().signals;
    expect(defaultUserSettings().dataplane.global.signals).toEqual(defaults);
    expect(validateUserSettings({ v: 1 })?.dataplane.global.signals).toEqual(defaults);
  });

  it("enables keyboard convenience bindings by default", () => {
    expect(defaultUserSettings().keyboard).toEqual({
      vimTableNavigation: true,
      homeRowTableNavigation: true,
      singleLetterGlobalSearch: true,
    });
    expect(validateUserSettings({ v: 1 })?.keyboard).toEqual(defaultUserSettings().keyboard);
  });

  it("keeps resource tags disabled by default with namespace inheritance ready", () => {
    expect(defaultUserSettings().resourceTags).toEqual({
      enabled: false,
      inheritNamespaceTags: true,
      quickFiltersEnabled: true,
      cleanupMissingAssignments: false,
      definitions: [],
      autoTagRules: [],
      assignments: {},
    });
    expect(validateUserSettings({ v: 1 })?.resourceTags).toEqual(defaultUserSettings().resourceTags);
  });

  it("keeps resource macros and dynamic links disabled by default", () => {
    expect(defaultUserSettings().resourceMacros).toEqual({
      enabled: false,
      maxResolveDepth: 10,
      definitions: [],
      extractors: [],
    });
    expect(defaultUserSettings().dynamicLinks).toEqual({
      enabled: false,
      definitions: [],
    });
    expect(validateUserSettings({ v: 1 })?.resourceMacros).toEqual(defaultUserSettings().resourceMacros);
    expect(validateUserSettings({ v: 1 })?.dynamicLinks).toEqual(defaultUserSettings().dynamicLinks);
  });

  it("keeps saved views empty by default", () => {
    expect(defaultUserSettings().savedViews).toEqual([]);
    expect(validateUserSettings({ v: 1 })?.savedViews).toEqual([]);
  });

  it("validates saved resource views", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      savedViews: [
        {
          id: "pods-prod",
          name: "  Prod pods  ",
          context: "prod",
          namespace: "apps",
          resource: "pods",
          filter: "tag:prod",
          sortModel: [
            { field: "status", sort: "desc" },
            { field: "bad" },
            { field: "name", sort: "sideways" },
          ],
          columnVisibilityModel: {
            status: true,
            internal: false,
            bad: "no",
          },
          columnWidths: {
            name: 260.4,
            tiny: 20,
            huge: 4000,
            bad: "120",
          },
          createdAt: 10,
          updatedAt: 20,
        },
        {
          id: "bad-resource",
          name: "Bad",
          context: "prod",
          namespace: "apps",
          resource: "not-a-resource",
          filter: "",
        },
        {
          id: "pods-prod",
          name: "Duplicate",
          context: "prod",
          namespace: "apps",
          resource: "deployments",
          filter: "",
        },
      ],
    });

    expect(parsed?.savedViews).toEqual([
      {
        id: "pods-prod",
        name: "Prod pods",
        context: "prod",
        namespace: "apps",
        resource: "pods",
        filter: "tag:prod",
        sortModel: [
          { field: "status", sort: "desc" },
        ],
        columnVisibilityModel: {
          status: true,
          internal: false,
        },
        columnWidths: {
          name: 260,
        },
        createdAt: 10,
        updatedAt: 20,
      },
    ]);
  });

  it("validates resource tag definitions and assignments", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      resourceTags: {
        enabled: true,
        inheritNamespaceTags: false,
        quickFiltersEnabled: false,
        cleanupMissingAssignments: false,
        definitions: [
          { id: "team-a", name: "  Team   A  ", color: "#AB12CD" },
          { id: "bad id", name: "Bad", color: "#000000" },
          { id: "ops", name: "Operations", color: "blue" },
          { id: "ops", name: "Duplicate", color: "#111111" },
        ],
        autoTagRules: [
          {
            id: "prod-name",
            enabled: true,
            tagIds: ["team-a", "missing"],
            context: "ctx",
            resources: ["pods", "not-a-resource"],
            source: "name",
            key: "ignored",
            pattern: "prod",
            flags: "ii",
          },
        ],
        assignments: {
          "ctx/pods/app/api": ["team-a", "missing", "team-a"],
          "ctx/namespaces//app": ["ops"],
          "": ["team-a"],
        },
      },
    });

    expect(parsed?.resourceTags).toEqual({
      enabled: true,
      inheritNamespaceTags: false,
      quickFiltersEnabled: false,
      cleanupMissingAssignments: false,
      definitions: [
        { id: "team-a", name: "Team A", color: "#ab12cd" },
        { id: "tag-2", name: "Bad", color: "#000000" },
        { id: "ops", name: "Operations", color: "#607d8b" },
      ],
      autoTagRules: [
        {
          id: "prod-name",
          enabled: true,
          tagIds: ["team-a"],
          context: "ctx",
          resources: ["pods"],
          source: "name",
          key: "",
          pattern: "prod",
          flags: "i",
        },
      ],
      assignments: {
        "ctx/pods/app/api": ["team-a"],
        "ctx/namespaces//app": ["ops"],
      },
    });
  });

  it("falls back to defaults for unsupported versions", () => {
    window.localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify({ v: 99 }));
    expect(loadUserSettings()).toEqual(defaultUserSettings());
  });

  it("validates and normalizes imported settings", () => {
    const parsed = validateUserSettings({
      v: 1,
      appearance: {
        dashboardRefreshSec: 0,
        smartFiltersEnabled: false,
        smartNamespaceSorting: true,
      },
      smartFilters: {
        minCount: 2.2,
        rules: [
          {
            id: "ticket",
            enabled: true,
            context: "kind-dev",
            scope: "namespace",
            namespace: "apps",
            resourceScope: "selected",
            resources: ["pods", "not-a-resource"],
            pattern: "([A-Z]+-[0-9]+)",
            flags: "ii",
            display: "$1",
          },
        ],
      },
    });

    expect(parsed?.appearance.dashboardRefreshSec).toBe(0);
    expect(parsed?.appearance.smartFiltersEnabled).toBe(false);
    expect(parsed?.appearance.smartNamespaceSorting).toBe(true);
    expect(parsed?.appearance.dashboardCombinedSignalFilters).toBe(false);
    expect(parsed?.appearance.dashboardFavouriteNamespaceFilters).toBe(false);
    expect(parsed?.appearance.dashboardRecentNamespaceFilters).toBe(false);
    expect(parsed?.appearance.activityPanelInitiallyOpen).toBe(true);
    expect(parsed?.appearance.releaseChecksEnabled).toBe(false);
    expect(parsed?.appearance.resourceDrawerWidthPx).toBe(820);
    expect(parsed?.appearance.recentMenuEnabled).toBe(false);
    expect(parsed?.appearance.recentMenuLimit).toBe(5);
    expect(parsed?.appearance.performanceDiagnosticsEnabled).toBe(false);
    expect(parsed?.smartFilters.minCount).toBe(2);
    expect(parsed?.smartFilters.rules[0]).toMatchObject({
      id: "ticket",
      flags: "i",
      resources: ["pods"],
    });
    expect(parsed?.customCommands.commands[0]).toMatchObject({
      id: "default-env",
      command: "/bin/env",
      outputType: "keyValue",
    });
    expect(parsed?.keyboard).toEqual(defaultUserSettings().keyboard);
  });

  it("validates keyboard preferences", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      keyboard: {
        vimTableNavigation: false,
        homeRowTableNavigation: "nope",
        singleLetterGlobalSearch: false,
      },
    });

    expect(parsed?.keyboard).toEqual({
      vimTableNavigation: false,
      homeRowTableNavigation: true,
      singleLetterGlobalSearch: false,
    });
  });

  it("rejects invalid imported JSON", () => {
    expect(() => parseUserSettingsJSON("{")).toThrow("not valid");
    expect(() => parseUserSettingsJSON(JSON.stringify({ v: 9 }))).toThrow("v1/v2");
    expect(() =>
      parseUserSettingsJSON(
        JSON.stringify({
          v: 1,
          appearance: {},
          smartFilters: { rules: [{ pattern: "(", flags: "", display: "$1" }] },
        }),
      ),
    ).toThrow("v1");
  });

  it("round-trips exported settings", () => {
    const settings = defaultUserSettings();
    const exported = exportUserSettingsJSON(settings);
    expect(parseUserSettingsJSON(exported)).toEqual(settings);
  });

  it("exports v2 detector-based thresholds without legacy metric/dashboard mirrors", () => {
    const exported = JSON.parse(exportUserSettingsJSON(defaultUserSettings()));
    expect(exported.v).toBe(2);
    expect(exported.dataplane.global.signals.detectors.pod_restarts.restartCount).toBeGreaterThan(0);
    expect(exported.dataplane.global.dashboard.restartElevatedThreshold).toBeUndefined();
    expect(exported.dataplane.global.metrics.containerNearLimitPct).toBeUndefined();
    expect(exported.dataplane.global.metrics.nodePressurePct).toBeUndefined();
  });

  it("exports and parses selected transfer sections", () => {
    const settings = defaultUserSettings();
    settings.resourceTags = {
      enabled: true,
      inheritNamespaceTags: true,
      quickFiltersEnabled: true,
      cleanupMissingAssignments: true,
      definitions: [{ id: "handoff", name: "Handoff", color: "#1e88e5" }],
      autoTagRules: [],
      assignments: { "ctx/pods/apps/api": ["handoff"] },
    };
    settings.resourceMacros = {
      enabled: true,
      maxResolveDepth: 10,
      definitions: [
        {
          id: "jira-url",
          enabled: true,
          macroName: "JIRA_URL",
          value: "https://jira.example.com",
          scope: { scope: "global", context: "", namespace: "", node: "", resource: "", name: "" },
        },
      ],
      extractors: [],
    };
    settings.dynamicLinks = {
      enabled: true,
      definitions: [
        {
          id: "jira-issue",
          enabled: true,
          label: "Jira Issue",
          urlTemplate: "$JIRA_URL/browse/$JIRA_ISSUE",
        },
      ],
    };
    const exported = exportSettingsTransferJSON({
      settings,
      appState: { v: 1, favouriteNamespacesByContext: { ctx: ["apps"] } },
      sections: ["resourceTags", "resourceMacros", "dynamicLinks", "favourites"],
    });

    const parsed = parseSettingsTransferJSON(exported);
    expect(settingsTransferSectionIds(parsed)).toEqual(["resourceTags", "resourceMacros", "dynamicLinks", "favourites"]);
    expect(parsed.sections.resourceTags?.definitions[0].id).toBe("handoff");
    expect(parsed.sections.resourceMacros?.definitions[0].macroName).toBe("JIRA_URL");
    expect(parsed.sections.dynamicLinks?.definitions[0].label).toBe("Jira Issue");
    expect(parsed.sections.favourites?.favouriteNamespacesByContext.ctx).toEqual(["apps"]);
  });

  it("merges transfer sections while keeping local conflicts", () => {
    const current = defaultUserSettings();
    current.customCommands.commands = [
      { ...current.customCommands.commands[0], id: "shared", name: "Local", command: "local" },
    ];
    const incoming = defaultUserSettings();
    incoming.customCommands.commands = [
      { ...incoming.customCommands.commands[0], id: "shared", name: "Imported", command: "imported" },
      { ...incoming.customCommands.commands[0], id: "new", name: "New", command: "new" },
    ];
    const bundle = parseSettingsTransferJSON(exportSettingsTransferJSON({
      settings: incoming,
      appState: { v: 1, favouriteNamespacesByContext: { prod: ["apps"] } },
      sections: ["customCommands", "favourites"],
    }));

    const applied = applySettingsTransferBundle({
      settings: current,
      appState: { v: 1, favouriteNamespacesByContext: { prod: ["default"] } },
      bundle,
      sections: ["customCommands", "favourites"],
      strategy: "keepMine",
    });

    expect(applied.settings.customCommands.commands.map((cmd) => [cmd.id, cmd.command])).toEqual([
      ["shared", "local"],
      ["new", "new"],
    ]);
    expect(applied.appState.favouriteNamespacesByContext.prod).toEqual(["apps", "default"]);
  });

  it("can replace selected transfer sections", () => {
    const current = defaultUserSettings();
    current.resourceTags.definitions = [{ id: "local", name: "Local", color: "#1e88e5" }];
    const incoming = defaultUserSettings();
    incoming.resourceTags.definitions = [{ id: "imported", name: "Imported", color: "#43a047" }];
    const bundle = parseSettingsTransferJSON(exportSettingsTransferJSON({
      settings: incoming,
      appState: { v: 1, favouriteNamespacesByContext: {} },
      sections: ["resourceTags"],
    }));

    const applied = applySettingsTransferBundle({
      settings: current,
      appState: { v: 1, favouriteNamespacesByContext: {} },
      bundle,
      sections: ["resourceTags"],
      strategy: "replaceSections",
    });

    expect(applied.settings.resourceTags.definitions).toEqual([
      { id: "imported", name: "Imported", color: "#43a047" },
    ]);
  });

  it("migrates v1 context overrides to v2 dataplane context overrides", () => {
    const migrated = validateUserSettings({
      v: 1,
      dataplane: {
        ...defaultDataplaneSettings(),
        signals: {
          ...defaultDataplaneSettings().signals,
          contextOverrides: {
            "prod-eu": {
              pod_restarts: { enabled: false, severity: "high" },
            },
          },
        },
      },
    });
    expect(migrated?.v).toBe(2);
    expect(migrated?.dataplane.contextOverrides["prod-eu"]?.signals?.overrides.pod_restarts).toEqual({
      enabled: false,
      severity: "high",
    });
  });

  it("keeps sparse context overrides in v2 imports", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      dataplane: {
        ...defaultUserSettings().dataplane,
        contextOverrides: {
          "stage-us": {
            signals: {
              overrides: {
                pod_restarts: { priority: 7 },
              },
            },
          },
        },
      },
    });
    expect(parsed?.dataplane.contextOverrides["stage-us"]?.signals?.overrides.pod_restarts?.priority).toBe(7);
  });

  it("supports sparse context metric-enabled overrides in v2 imports", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      dataplane: {
        ...defaultUserSettings().dataplane,
        contextOverrides: {
          "stage-us": {
            metrics: {
              enabled: false,
            },
          },
        },
      },
    });
    expect(parsed?.dataplane.contextOverrides["stage-us"]?.metrics?.enabled).toBe(false);
  });

  it("supports sparse all-context enrichment overrides in v2 imports", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      dataplane: {
        ...defaultUserSettings().dataplane,
        contextOverrides: {
          "stage-us": {
            allContextEnrichment: {
              enabled: false,
              intervalSec: 900,
            },
          },
        },
      },
    });
    expect(parsed?.dataplane.contextOverrides["stage-us"]?.allContextEnrichment?.intervalSec).toBe(900);
  });

  it("keeps global metrics TTL unchanged when context override is created", () => {
    const settings = defaultUserSettings();
    const globalPodTtl = settings.dataplane.global.metrics.podMetricsTtlSec;
    const updated = {
      ...settings,
      dataplane: {
        ...settings.dataplane,
        contextOverrides: {
          ...settings.dataplane.contextOverrides,
          "stage-us": {
            metrics: {
              podMetricsTtlSec: 99,
            },
          },
        },
      },
    };
    const effective = dataplaneSettingsForContext(updated.dataplane, "stage-us");
    expect(updated.dataplane.global.metrics.podMetricsTtlSec).toBe(globalPodTtl);
    expect(updated.dataplane.contextOverrides["stage-us"]?.metrics?.podMetricsTtlSec).toBe(99);
    expect(effective.metrics.podMetricsTtlSec).toBe(99);
  });

  it("resolves effective dataplane settings per context override", () => {
    const base = defaultUserSettings();
    const settings: ReturnType<typeof defaultUserSettings> = {
      ...base,
      dataplane: {
        ...base.dataplane,
        global: {
          ...base.dataplane.global,
          metrics: {
            ...base.dataplane.global.metrics,
            enabled: true,
          },
        },
        contextOverrides: {
          "prod-eu": {
            metrics: { enabled: false },
            signals: {
              overrides: {
                pod_restarts: { severity: "high" as const },
              },
            },
          },
        },
      },
    };
    const inherited = dataplaneSettingsForContext(settings.dataplane, "dev-us");
    const overridden = dataplaneSettingsForContext(settings.dataplane, "prod-eu");
    expect(inherited.metrics.enabled).toBe(true);
    expect(overridden.metrics.enabled).toBe(false);
    expect(overridden.signals.overrides.pod_restarts?.severity).toBe("high");
  });

  it("preserves explicit dataplane persistence when normalizing settings", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      dataplane: {
        ...defaultUserSettings().dataplane,
        global: {
          ...defaultUserSettings().dataplane.global,
          persistence: {
            ...defaultUserSettings().dataplane.global.persistence,
            enabled: false,
          },
        },
      },
    });

    expect(parsed?.dataplane.global.persistence.enabled).toBe(false);
  });

  it("keeps dataplane persistence unchanged when applying a profile", () => {
    const current = {
      ...defaultUserSettings().dataplane.global,
      persistence: {
        enabled: false,
        maxAgeHours: 12,
      },
    };

    const next = applyDataplaneProfile(current, "wide");

    expect(next.profile).toBe("wide");
    expect(next.namespaceEnrichment.sweep.enabled).toBe(true);
    expect(next.persistence).toEqual({ enabled: false, maxAgeHours: 12 });
  });

  it("keeps dataplane signal thresholds unchanged when applying a profile", () => {
    const current = {
      ...defaultUserSettings().dataplane.global,
      signals: {
        ...defaultUserSettings().dataplane.global.signals,
        longRunningJobSec: 7200,
        quotaWarnPercent: 70,
        quotaCriticalPercent: 85,
      },
    };
    const next = applyDataplaneProfile(current, "wide");
    expect(next.profile).toBe("wide");
    expect(next.signals).toEqual(current.signals);
  });

  it("provides and matches default custom commands", () => {
    const settings = defaultUserSettings();
    expect(settings.customCommands.commands[0]).toMatchObject({
      enabled: true,
      name: "Environment",
      containerPattern: "",
      command: "/bin/env",
      outputType: "keyValue",
      safety: "safe",
    });
    expect(customCommandsForContainer(settings.customCommands.commands, "app")).toHaveLength(1);
  });

  it("provides default deployment DEBUG custom actions", () => {
    const settings = defaultUserSettings();
    expect(settings.customActions.actions).toHaveLength(2);
    expect(settings.customActions.actions[0]).toMatchObject({
      name: "Enable DEBUG",
      resources: ["deployments"],
      action: "set",
      target: "env",
      key: "DEBUG",
      value: "true",
    });
    expect(settings.customActions.actions[1]).toMatchObject({
      name: "Disable DEBUG",
      resources: ["deployments"],
      action: "unset",
      target: "env",
      key: "DEBUG",
    });
    expect(customActionsForResource(settings.customActions.actions, "deployments")).toHaveLength(2);
  });

  it("validates custom command imports and rejects invalid patterns", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      customCommands: {
        commands: [
          {
            id: "artisan",
            enabled: true,
            name: "Laravel status",
            containerPattern: "^php",
            workdir: "/app",
            command: "php artisan about",
            outputType: "csv",
            codeLanguage: "text",
            fileName: "",
            compress: false,
            safety: "dangerous",
          },
        ],
      },
    });
    expect(parsed?.customCommands.commands[0]).toMatchObject({
      id: "artisan",
      enabled: true,
      outputType: "csv",
      safety: "dangerous",
    });
    expect(customCommandsForContainer(parsed?.customCommands.commands || [], "php-fpm")).toHaveLength(1);
    expect(customCommandsForContainer(parsed?.customCommands.commands || [], "nginx")).toHaveLength(0);

    expect(
      validateUserSettings({
        ...defaultUserSettings(),
        customCommands: { commands: [{ command: "/bin/env", containerPattern: "(" }] },
      }),
    ).toBeNull();
  });

  it("validates custom action imports and matches workload resources", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      customActions: {
        actions: [
          {
            id: "debug-env",
            enabled: true,
            name: "Enable debug",
            resources: ["deployments", "not-a-resource"],
            action: "set",
            target: "env",
            key: "DEBUG",
            value: "true",
            runtimeValue: false,
            containerPattern: "",
            patchType: "merge",
            patchBody: "{}",
            safety: "safe",
          },
        ],
      },
    });
    expect(parsed?.customActions.actions[0]).toMatchObject({
      id: "debug-env",
      resources: ["deployments"],
      key: "DEBUG",
    });
    expect(customActionsForResource(parsed?.customActions.actions || [], "deployments")).toHaveLength(1);
    expect(customActionsForResource(parsed?.customActions.actions || [], "daemonsets")).toHaveLength(0);
  });

  it("matches ordered scoped smart filter rules and uses JS replacement templates", () => {
    const settings = defaultUserSettings();
    const rules = [
      {
        ...settings.smartFilters.rules[0],
        id: "pods-only",
        resourceScope: "selected" as const,
        resources: ["pods" as const],
        pattern: "^(api)-([0-9]+).*$",
        flags: "",
        display: "$1-$2",
      },
      {
        ...settings.smartFilters.rules[1],
        id: "fallback",
        scope: "all" as const,
        pattern: "^(api).*$",
        display: "$1",
      },
    ];

    expect(
      labelForSmartFilterRules("api-42-worker", rules, {
        contextName: "kind-dev",
        namespace: "apps",
        resourceKey: "pods",
      }),
    ).toBe("api-42");

    expect(
      labelForSmartFilterRules("api-42-worker", rules, {
        contextName: "kind-dev",
        namespace: "apps",
        resourceKey: "deployments",
      }),
    ).toBe("api");
  });

  it("limits smart filter resource choices to the selected scope", () => {
    expect(smartFilterResourceKeysForScope("namespace")).toContain("pods");
    expect(smartFilterResourceKeysForScope("namespace")).not.toContain("nodes");
    expect(smartFilterResourceKeysForScope("cluster")).toContain("nodes");
    expect(smartFilterResourceKeysForScope("cluster")).not.toContain("pods");
  });

  it("normalizes smart filter selected resources against cluster scope", () => {
    const parsed = validateUserSettings({
      ...defaultUserSettings(),
      smartFilters: {
        minCount: 3,
        rules: [
          {
            id: "cluster-only",
            enabled: true,
            context: "",
            scope: "cluster",
            namespace: "",
            resourceScope: "selected",
            resources: ["nodes", "pods"],
            pattern: "^(node).*$",
            flags: "",
            display: "$1",
          },
        ],
      },
    });

    expect(parsed?.smartFilters.rules[0].resources).toEqual(["nodes"]);
  });

  it("renders unanchored default capture rules from the match only", () => {
    const settings = defaultUserSettings();
    expect(
      labelForSmartFilterRules("ABC-123-worker", settings.smartFilters.rules, {
        contextName: "kind-dev",
        namespace: "apps",
        resourceKey: "pods",
      }),
    ).toBe("ABC-123");
  });

  it("respects namespace and context scopes", () => {
    const rule = {
      ...defaultUserSettings().smartFilters.rules[0],
      context: "prod",
      scope: "namespace" as const,
      namespace: "payments",
      pattern: "^(release).*$",
      display: "$1",
    };

    expect(
      labelForSmartFilterRules("release-web", [rule], {
        contextName: "prod",
        namespace: "payments",
        resourceKey: "deployments",
      }),
    ).toBe("release");
    expect(
      labelForSmartFilterRules("release-web", [rule], {
        contextName: "prod",
        namespace: "orders",
        resourceKey: "deployments",
      }),
    ).toBeNull();
    expect(
      labelForSmartFilterRules("release-web", [rule], {
        contextName: "dev",
        namespace: "payments",
        resourceKey: "deployments",
      }),
    ).toBeNull();
  });
});
