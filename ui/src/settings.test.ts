// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import {
  defaultUserSettings,
  exportUserSettingsJSON,
  customCommandsForContainer,
  customActionsForResource,
  labelForSmartFilterRules,
  loadUserSettings,
  parseUserSettingsJSON,
  validateUserSettings,
  USER_SETTINGS_KEY,
} from "./settings";

describe("user settings", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("loads defaults when no profile exists", () => {
    expect(loadUserSettings()).toEqual(defaultUserSettings());
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
    expect(parsed?.appearance.activityPanelInitiallyOpen).toBe(true);
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
  });

  it("rejects invalid imported JSON", () => {
    expect(() => parseUserSettingsJSON("{")).toThrow("not valid");
    expect(() => parseUserSettingsJSON(JSON.stringify({ v: 2 }))).toThrow("v1");
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
