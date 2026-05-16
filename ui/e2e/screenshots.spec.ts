import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openKview } from "./fixtures";
import {
  apiGetForContext,
  listContexts,
  openFirstResourceDrawer,
  openResourceDrawerByName,
  openSection,
  selectSidebarContext,
  selectSidebarNamespace,
} from "./resource-selectors";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");
const screenshotDir = path.resolve(repoRoot, ".artifacts/screenshots");
const themes = ["light"] as const;
type ScreenshotTheme = typeof themes[number];
type WarmScreenshotContext = Awaited<ReturnType<typeof chooseWarmContext>>;
let cachedWarmContext: WarmScreenshotContext | null = null;

test.setTimeout(900_000);

async function screenshotPage(page: Page, theme: ScreenshotTheme, name: string) {
  const themeDir = path.join(screenshotDir, theme);
  await mkdir(themeDir, { recursive: true });
  await page.waitForTimeout(750);
  await page.screenshot({ path: path.join(themeDir, `${name}.png`), fullPage: false });
}

async function waitForSettled(locator: Locator, timeout = 90_000) {
  await expect(locator.locator(".MuiCircularProgress-root:visible")).toHaveCount(0, { timeout });
  await expect(locator.getByText(/^Loading(\.\.\.)?$/).filter({ visible: true })).toHaveCount(0, { timeout });
}

async function waitForDrawerSettled(drawer: Locator) {
  await waitForSettled(drawer);
  await expect(drawer.getByText(/request failed/i)).toHaveCount(0, { timeout: 5_000 });
  await drawer.waitFor({ state: "visible", timeout: 90_000 });
}

async function waitForDashboardSettled(dashboard: Locator) {
  await waitForSettled(dashboard);
  await expect(dashboard.getByText("Known Resources")).toBeVisible({ timeout: 30_000 });
}

async function drawerHasRequestFailed(drawer: Locator) {
  return drawer.getByText(/request failed/i).first().isVisible({ timeout: 5_000 }).catch(() => false);
}

async function closeDrawer(page: Page, testId: string) {
  const drawer = page.getByTestId(testId);
  if (!await drawer.isVisible().catch(() => false)) return;
  await page.keyboard.press("Escape");
  if (await drawer.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await drawer.getByRole("button", { name: "Close drawer" }).click();
  }
  await expect(drawer).toHaveCount(0, { timeout: 10_000 });
}

async function tryScreenshotDeploymentDetail(page: Page, theme: ScreenshotTheme, closeAfter = true) {
  if (!await openFirstResourceDrawer(page, "deployments")) return;
  const drawer = page.getByTestId("drawer-deployments");
  await waitForSettled(drawer);
  if (!await drawerHasRequestFailed(drawer)) {
    await screenshotPage(page, theme, "deployment-detail");
  }
  if (closeAfter) await closeDrawer(page, "drawer-deployments");
}

function asRecords(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item)) : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value || 0);
}

function namespaceWithHighestCount(items: Array<Record<string, unknown>>, countKey: "podCount" | "deploymentCount"): string {
  return items
    .map((item) => ({ name: asString(item.name), count: asNumber(item[countKey]) }))
    .filter((item) => item.name && item.count > 0)
    .sort((a, b) => b.count - a.count)[0]?.name || "";
}

async function chooseWarmContext(page: Page, token: string) {
  const contexts = await listContexts(page, token);
  const candidates = [...new Set([contexts.active, ...contexts.names].filter(Boolean))];
  let best = {
    context: candidates[0] || "",
    score: -1,
    namespaces: [] as string[],
    selectedNamespaces: [] as string[],
    hasNodes: false,
    podNamespace: "",
    deploymentNamespace: "",
  };

  for (const context of candidates) {
    const dashboard = await apiGetForContext(page, token, "/api/dashboard/cluster?signalsFilter=top&signalsLimit=50", context).catch(() => null);
    const namespaces = await apiGetForContext(page, token, "/api/namespaces", context).catch(() => null);
    const nodes = await apiGetForContext(page, token, "/api/nodes", context).catch(() => null);
    const status = await apiGetForContext(page, token, "/api/status", context).catch(() => null);
    const cluster = status?.cluster && typeof status.cluster === "object" ? status.cluster as Record<string, unknown> : {};
    const clusterReachable = cluster.ok === true;
    const dashboardItem = dashboard?.item && typeof dashboard.item === "object" ? dashboard.item as Record<string, unknown> : {};
    const coverage = dashboardItem.coverage && typeof dashboardItem.coverage === "object" ? dashboardItem.coverage as Record<string, unknown> : {};
    const signals = dashboardItem.signals && typeof dashboardItem.signals === "object" ? dashboardItem.signals as Record<string, unknown> : {};
    const namespaceRows = asRecords(namespaces?.items);
    const namespaceNames = namespaceRows.map((item) => asString(item.name)).filter(Boolean);
    const nodeCount = asRecords(nodes?.items).length;
    const selectedNamespaces = chooseTopScreenshotNamespaces(namespaceRows);
    const screenshotNamespace = selectedNamespaces[0] || "";
    const podNamespace = screenshotNamespace || namespaceWithHighestCount(namespaceRows, "podCount") || await chooseNamespaceWithItems(page, token, context, "pods", namespaceNames, "");
    const deploymentNamespace = screenshotNamespace || namespaceWithHighestCount(namespaceRows, "deploymentCount") || await chooseNamespaceWithItems(page, token, context, "deployments", namespaceNames, podNamespace);
    const knownNamespaces = asNumber(coverage.namespacesInResourceTotals);
    const rowProjectionNamespaces = asNumber(coverage.rowProjectionCachedNamespaces);
    const relatedNamespaces = asNumber(coverage.relatedEnrichedNamespaces);
    const detailNamespaces = asNumber(coverage.detailEnrichedNamespaces);
    const visibleNamespaces = asNumber(coverage.visibleNamespaces);
    const score =
      knownNamespaces * 10_000 +
      rowProjectionNamespaces * 8_000 +
      relatedNamespaces * 5_000 +
      detailNamespaces * 2_000 +
      visibleNamespaces * 50 +
      asNumber(signals.total) * 25 +
      nodeCount * 20 +
      selectedNamespaces.length * 1_000 +
      (podNamespace ? 150 : 0) +
      (deploymentNamespace ? 120 : 0) +
      namespaceNames.length +
      (clusterReachable ? 1_000_000_000 : -1_000_000_000);
    console.log(
      `Screenshot context candidate ${context}: reachable=${clusterReachable} known=${knownNamespaces} visible=${visibleNamespaces} rowProjection=${rowProjectionNamespaces} related=${relatedNamespaces} detail=${detailNamespaces} signals=${asNumber(signals.total)} score=${score}`,
    );
    if (score > best.score) {
      best = { context, score, namespaces: namespaceNames, selectedNamespaces, hasNodes: nodeCount > 0, podNamespace, deploymentNamespace };
    }
  }
  return best;
}

function chooseTopScreenshotNamespaces(rows: Array<Record<string, unknown>>): string[] {
  return rows
    .map((row) => {
      const name = asString(row.name);
      const signals = asNumber(row.listSignalCount);
      const pods = asNumber(row.podCount);
      const deployments = asNumber(row.deploymentCount);
      const workload = pods + deployments;
      return { name, signals, workload, score: signals * 100_000 + workload };
    })
    .filter((row) => row.name && row.workload > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map((row) => row.name);
}

async function chooseContextWithNodes(page: Page, token: string, preferred: string): Promise<string | null> {
  const contexts = await listContexts(page, token);
  const candidates = [...new Set([preferred, contexts.active, ...contexts.names].filter(Boolean))];
  for (const context of candidates) {
    const nodes = await apiGetForContext(page, token, "/api/nodes", context).catch(() => null);
    if (asRecords(nodes?.items).length > 0) return context;
  }
  return null;
}

async function chooseInterestingNamespaceForContext(page: Page, token: string, context: string): Promise<string> {
  const dashboard = await apiGetForContext(page, token, "/api/dashboard/cluster?signalsFilter=top&signalsLimit=50", context);
  const dashboardItem = dashboard?.item && typeof dashboard.item === "object" ? dashboard.item as Record<string, unknown> : {};
  const dashboardSignals = dashboardItem.signals && typeof dashboardItem.signals === "object" ? dashboardItem.signals as Record<string, unknown> : {};
  const signals = [
    ...asRecords(dashboardSignals.items),
    ...asRecords(dashboardSignals.top),
  ];
  const quotaSignal = signals.find((signal) =>
    asString(signal.namespace) && `${asString(signal.signalType)} ${asString(signal.reason)}`.toLowerCase().includes("quota"));
  if (asString(quotaSignal?.namespace)) return asString(quotaSignal?.namespace);

  const namespacedSignal = signals.find((signal) => asString(signal.namespace));
  if (asString(namespacedSignal?.namespace)) return asString(namespacedSignal?.namespace);

  const namespaces = await apiGetForContext(page, token, "/api/namespaces", context);
  const first = asString(asRecords(namespaces.items)[0]?.name);
  if (!first) throw new Error("No namespace is available for E2E selection");
  return first;
}

async function chooseNamespaceWithItems(
  page: Page,
  token: string,
  context: string,
  resource: "pods" | "deployments",
  candidates: string[],
  fallback: string,
): Promise<string> {
  for (const namespace of [...new Set([fallback, ...candidates].filter(Boolean))].slice(0, 120)) {
    const res = await apiGetForContext(page, token, `/api/namespaces/${encodeURIComponent(namespace)}/${resource}`, context).catch(() => null);
    if (asRecords(res?.items).length > 0) return namespace;
  }
  return fallback;
}

async function chooseFirstResourceNameForContext(
  page: Page,
  token: string,
  context: string,
  namespace: string,
  resource: "pods" | "deployments",
): Promise<string> {
  const res = await apiGetForContext(page, token, `/api/namespaces/${encodeURIComponent(namespace)}/${resource}`, context);
  return asString(asRecords(res.items)[0]?.name);
}

async function seedScreenshotState(page: Page, context: string, namespaces: string[]) {
  const favourites = namespaces.slice(0, 4);
  const recent = namespaces.slice(0, 6);
  const [primary = "", secondary = "", tertiary = ""] = favourites;
  await page.evaluate(
    ({ context, favourites, recent, primary, secondary, tertiary }) => {
      const userSettingsKey = "kview:userSettings:v1";
      const stateKey = "kview.state.v1";
      const existingSettings = JSON.parse(window.localStorage.getItem(userSettingsKey) || "{}");
      const existingAppearance = existingSettings.appearance || {};
      const existingDataplane = existingSettings.dataplane || {};
      const globalDataplane = existingDataplane.global || existingDataplane || {};
      const definitions = [
        { id: "prod", name: "Prod", color: "#d32f2f" },
        { id: "shared", name: "Shared", color: "#1976d2" },
        { id: "watch", name: "Watch", color: "#f57c00" },
      ];
      const assignments: Record<string, string[]> = {};
      const tagKey = (namespace: string) => [context, "namespaces", "", namespace].map((part) => encodeURIComponent(part.trim())).join("/");
      if (primary) assignments[tagKey(primary)] = ["prod", "watch"];
      if (secondary) assignments[tagKey(secondary)] = ["shared"];
      if (tertiary) assignments[tagKey(tertiary)] = ["watch"];
      const customActions = {
        actions: [
          {
            id: "default-enable-debug-env",
            enabled: true,
            name: "Enable DEBUG",
            resources: ["deployments"],
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
          {
            id: "screenshot-set-log-level",
            enabled: true,
            name: "Set LOG_LEVEL",
            resources: ["deployments", "statefulsets"],
            action: "set",
            target: "env",
            key: "LOG_LEVEL",
            value: "debug",
            runtimeValue: false,
            containerPattern: ".*",
            patchType: "merge",
            patchBody: "{}",
            safety: "safe",
          },
          {
            id: "screenshot-annotate-rollout",
            enabled: true,
            name: "Annotate rollout",
            resources: ["deployments"],
            action: "patch",
            target: "env",
            key: "",
            value: "",
            runtimeValue: false,
            containerPattern: "",
            patchType: "merge",
            patchBody: "{\n  \"spec\": {\n    \"template\": {\n      \"metadata\": {\n        \"annotations\": {\n          \"kview.dev/screenshot\": \"true\"\n        }\n      }\n    }\n  }\n}",
            safety: "safe",
          },
        ],
      };
      const nextSettings = {
        ...existingSettings,
        v: 2,
        appearance: {
          ...existingAppearance,
          smartFiltersEnabled: true,
          smartNamespaceSorting: true,
          dashboardCombinedSignalFilters: true,
          dashboardFavouriteNamespaceFilters: true,
          dashboardRecentNamespaceFilters: true,
          recentMenuEnabled: true,
          recentMenuLimit: 8,
          yamlSmartCollapse: true,
          activityPanelInitiallyOpen: false,
        },
        resourceTags: {
          enabled: true,
          inheritNamespaceTags: true,
          cleanupMissingAssignments: false,
          definitions,
          assignments,
        },
        customActions,
        dataplane: {
          ...existingDataplane,
          global: {
            ...globalDataplane,
            profile: "wide",
            dashboard: {
              ...(globalDataplane.dashboard || {}),
              refreshSec: 10,
            },
            namespaceEnrichment: {
              ...(globalDataplane.namespaceEnrichment || {}),
              enabled: true,
              includeFocus: true,
              includeRecent: true,
              includeFavourites: true,
              enrichDetails: true,
              enrichPods: true,
              enrichDeployments: true,
              maxTargets: 24,
            },
          },
        },
      };
      const nextState = {
        v: 1,
        activeContext: context,
        activeNamespace: favourites[0] || recent[0] || "",
        activeSection: "dashboard",
        favouriteNamespacesByContext: { [context]: favourites },
        recentNamespacesByContext: { [context]: recent },
        recentSections: [],
        sidebarCollapsedGroups: {},
        activityPanelOpen: false,
        activityPanelHeightPx: 320,
      };
      window.localStorage.setItem(userSettingsKey, JSON.stringify(nextSettings));
      window.localStorage.setItem(stateKey, JSON.stringify(nextState));
      window.localStorage.setItem("kview_theme", "light");
    },
    { context, favourites, recent, primary, secondary, tertiary },
  );
}

async function setTheme(page: Page, theme: ScreenshotTheme) {
  const button = page.getByRole("button", { name: /Theme:/ });
  const expectedName = theme === "light" ? /Theme: Light/ : /Theme: Dark/;
  for (let i = 0; i < 3; i += 1) {
    const name = await button.getAttribute("aria-label");
    if (name && expectedName.test(name)) return;
    await button.click();
    await expect(button).toHaveAccessibleName(expectedName, { timeout: 10_000 }).catch(() => undefined);
  }
  await expect(button).toHaveAccessibleName(expectedName, { timeout: 10_000 });
}

async function closeActivityPanel(page: Page) {
  const panel = page.getByTestId("activity-panel");
  const toggle = page.getByTestId("activity-panel-toggle");
  const panelHeight = await panel.evaluate((node) => node.getBoundingClientRect().height).catch(() => 0);
  if (await toggle.isVisible().catch(() => false) && panelHeight > 80) {
    await toggle.click();
    await expect.poll(
      () => panel.evaluate((node) => node.getBoundingClientRect().height).catch(() => 0),
      { timeout: 10_000 },
    ).toBeLessThan(80);
  }
}

async function captureSettingsScreenshots(page: Page, theme: ScreenshotTheme) {
  await closeDrawer(page, "drawer-namespaces");
  await closeDrawer(page, "drawer-pods");
  await closeDrawer(page, "drawer-deployments");
  await closeDrawer(page, "drawer-nodes");
  await page.getByTestId("settings-toggle").click();
  const settings = page.getByTestId("settings-view");
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("settings-nav-appearance").click();
  await screenshotPage(page, theme, "settings-appearance");
  await page.getByTestId("settings-nav-dataplane").click();
  await expect(page.getByTestId("settings-section-dataplane")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("settings-dataplane-tab-enrichment").click();
  await expect(page.getByTestId("settings-dataplane-tab-enrichment")).toHaveAttribute("aria-selected", "true");
  await screenshotPage(page, theme, "settings-dataplane-enrichment");
  await page.getByTestId("settings-dataplane-tab-signals").click();
  await expect(page.getByTestId("settings-dataplane-tab-signals")).toHaveAttribute("aria-selected", "true");
  await waitForSettled(page.getByTestId("settings-section-dataplane"));
  await screenshotPage(page, theme, "settings-dataplane-signals");
  await page.getByTestId("settings-nav-actions").click();
  await screenshotPage(page, theme, "settings-custom-actions");
  await page.getByTestId("settings-toggle").click();
  await expect(settings).toHaveCount(0, { timeout: 30_000 });
}

async function captureNamespaceDetailScreenshots(page: Page, theme: ScreenshotTheme, namespace: string) {
  await openSection(page, "namespaces");
  if (!await openResourceDrawerByName(page, "namespaces", namespace) && !await openFirstResourceDrawer(page, "namespaces")) {
    throw new Error(`Namespace drawer row was not found for ${namespace}`);
  }
  const drawer = page.getByTestId("drawer-namespaces");
  await waitForDrawerSettled(drawer);
  await screenshotPage(page, theme, "namespace-detail-signals");
  await drawer.getByRole("tab", { name: "Inventory" }).click();
  await waitForDrawerSettled(drawer);
  await screenshotPage(page, theme, "namespace-detail-inventory");
  await drawer.getByRole("tab", { name: "Capacity" }).click();
  await waitForDrawerSettled(drawer);
  await screenshotPage(page, theme, "namespace-detail-capacity");
}

async function chooseVisibleNamespaceWithPods(page: Page): Promise<string> {
  await openSection(page, "namespaces");
  const namespaceList = page.getByTestId("resource-list-namespaces");
  await expect(namespaceList).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  const rows = namespaceList.getByRole("row");
  const count = await rows.count();
  for (let index = 1; index < count; index += 1) {
    const text = await rows.nth(index).textContent();
    const namespace = text?.match(/\b(namespace-\d+)\b/)?.[1] || "";
    const pods = Number(text?.match(/pods \/ deployments:\s*([0-9]+)/i)?.[1] || 0);
    if (namespace && pods > 0) return namespace;
  }
  return "";
}

async function chooseNamespaceWithVisibleRows(page: Page, namespaces: string[], section: "pods" | "deployments"): Promise<string> {
  for (const namespace of namespaces.filter(Boolean)) {
    await selectSidebarNamespace(page, namespace);
    await openSection(page, section);
    const list = page.getByTestId(`resource-list-${section}`);
    await waitForSettled(list);
    if (await list.getByRole("row").nth(1).isVisible({ timeout: 3_000 }).catch(() => false)) {
      return namespace;
    }
  }
  return "";
}

async function captureAppScreenshots(
  page: Page,
  token: string,
  theme: ScreenshotTheme,
  warmContext: string,
  warmNamespaces: string[],
  podNamespaceHint: string,
  deploymentNamespaceHint: string,
) {
  await setTheme(page, theme);
  await closeActivityPanel(page);

  await page.getByTestId("nav-dashboard").last().click();
  const dashboard = page.getByTestId("cluster-dashboard");
  await expect(dashboard).toBeVisible({ timeout: 60_000 });
  await waitForDashboardSettled(dashboard);
  await screenshotPage(page, theme, "cluster-dashboard");

  const preferredNamespaces = warmNamespaces.slice(0, 3);
  const namespace = preferredNamespaces[0] || podNamespaceHint || await chooseInterestingNamespaceForContext(page, token, warmContext);
  await openSection(page, "namespaces");
  const namespaceList = page.getByTestId("resource-list-namespaces");
  await waitForSettled(namespaceList);
  await screenshotPage(page, theme, "namespace-list");

  const podNamespace = podNamespaceHint ||
    preferredNamespaces[0] ||
    await chooseNamespaceWithItems(page, token, warmContext, "pods", warmNamespaces, namespace);
  await selectSidebarNamespace(page, podNamespace);
  await openSection(page, "pods");
  const podList = page.getByTestId("resource-list-pods");
  await waitForSettled(podList);
  await screenshotPage(page, theme, "pods-list");

  const deploymentNamespace = deploymentNamespaceHint ||
    preferredNamespaces[0] ||
    await chooseNamespaceWithItems(page, token, warmContext, "deployments", warmNamespaces, namespace);
  console.log(`Screenshot ${theme}: context=${warmContext} namespace=${namespace} pods=${podNamespace || "(none)"} deployments=${deploymentNamespace || "(none)"}`);
  await selectSidebarNamespace(page, deploymentNamespace);
  await openSection(page, "deployments");
  const deploymentsList = page.getByTestId("resource-list-deployments");
  await waitForSettled(deploymentsList);
  await screenshotPage(page, theme, "deployments-list");

  const nodeContext = await chooseContextWithNodes(page, token, warmContext);
  if (nodeContext) {
    await selectSidebarContext(page, nodeContext);
  }
  await openSection(page, "nodes");
  const nodesList = page.getByTestId("resource-list-nodes");
  await waitForSettled(nodesList);
  await screenshotPage(page, theme, "nodes-list");

  await captureSettingsScreenshots(page, theme);
}

async function prepareScreenshotPage(page: Page, token: string, theme: ScreenshotTheme): Promise<WarmScreenshotContext> {
  await page.goto(`/?token=${token}`, { waitUntil: "domcontentloaded" });
  const warm = cachedWarmContext || await chooseWarmContext(page, token);
  cachedWarmContext = warm;
  console.log(`Screenshot prepare: context=${warm.context} selected=${warm.selectedNamespaces.join(",")} pod=${warm.podNamespace || "(none)"} deployment=${warm.deploymentNamespace || "(none)"}`);
  if (warm.context) {
    const selectedNamespaces = [...warm.selectedNamespaces, ...warm.namespaces.filter((namespace) => !warm.selectedNamespaces.includes(namespace))];
    await seedScreenshotState(page, warm.context, selectedNamespaces);
    await openKview(page, token);
    await selectSidebarContext(page, warm.context);
  }
  await setTheme(page, theme);
  await closeActivityPanel(page);
  return warm;
}

async function capturePodDrawerScreenshots(page: Page, token: string, theme: ScreenshotTheme, warm: WarmScreenshotContext) {
  const candidates = [...warm.selectedNamespaces, ...warm.namespaces.filter((namespace) => !warm.selectedNamespaces.includes(namespace))].slice(0, 40);
  const namespace = warm.podNamespace || await chooseNamespaceWithVisibleRows(page, candidates, "pods");
  if (!namespace) throw new Error("No namespace with pods was found for pod drawer screenshot");
  const podName = await chooseFirstResourceNameForContext(page, token, warm.context, namespace, "pods");
  if (!podName) throw new Error(`No pod was found in namespace ${namespace}`);
  console.log(`Screenshot pod drawer: namespace=${namespace} pod=${podName}`);
  await selectSidebarNamespace(page, namespace);
  console.log("Screenshot pod drawer: namespace selected");
  await openSection(page, "pods");
  console.log("Screenshot pod drawer: pods section opened");
  const podList = page.getByTestId("resource-list-pods");
  await waitForSettled(podList);
  console.log("Screenshot pod drawer: pod list settled");
  if (!await openResourceDrawerByName(page, "pods", podName) && !await openFirstResourceDrawer(page, "pods")) {
    throw new Error(`Pod drawer row was not found for ${podName} in namespace ${namespace}`);
  }
  const drawer = page.getByTestId("drawer-pods");
  await waitForDrawerSettled(drawer);
  await screenshotPage(page, theme, "pod-detail");
  await drawer.getByRole("tab", { name: "Containers" }).click();
  await waitForDrawerSettled(drawer);
  const firstContainerSummary = drawer.locator(".MuiAccordionSummary-root").first();
  if (await firstContainerSummary.isVisible().catch(() => false)) {
    const expanded = await firstContainerSummary.getAttribute("aria-expanded");
    if (expanded !== "true") await firstContainerSummary.click();
  }
  await screenshotPage(page, theme, "pod-detail-containers");
}

async function captureDeploymentDrawerScreenshots(page: Page, token: string, theme: ScreenshotTheme, warm: WarmScreenshotContext) {
  const candidates = [...warm.selectedNamespaces, ...warm.namespaces.filter((namespace) => !warm.selectedNamespaces.includes(namespace))].slice(0, 40);
  const namespace = await chooseNamespaceWithVisibleRows(page, candidates, "deployments") ||
    warm.deploymentNamespace ||
    await chooseNamespaceWithItems(page, token, warm.context, "deployments", warm.namespaces, warm.podNamespace);
  if (!namespace) throw new Error("No namespace with deployments was found for deployment drawer screenshot");
  const deploymentName = await chooseFirstResourceNameForContext(page, token, warm.context, namespace, "deployments");
  if (!deploymentName) throw new Error(`No deployment was found in namespace ${namespace}`);
  await selectSidebarNamespace(page, namespace);
  await openSection(page, "deployments");
  if (!await openResourceDrawerByName(page, "deployments", deploymentName) && !await openFirstResourceDrawer(page, "deployments")) {
    throw new Error(`Deployment drawer row was not found for ${deploymentName} in namespace ${namespace}`);
  }
  const drawer = page.getByTestId("drawer-deployments");
  await waitForSettled(drawer);
  if (await drawerHasRequestFailed(drawer)) throw new Error(`Deployment drawer failed to load in namespace ${namespace}`);
  await screenshotPage(page, theme, "deployment-detail");
}

async function captureNodeDrawerScreenshots(page: Page, token: string, theme: ScreenshotTheme, warm: WarmScreenshotContext) {
  const nodeContext = await chooseContextWithNodes(page, token, warm.context);
  if (nodeContext) await selectSidebarContext(page, nodeContext);
  await openSection(page, "nodes");
  const nodesList = page.getByTestId("resource-list-nodes");
  await waitForSettled(nodesList);
  if (!await openFirstResourceDrawer(page, "nodes")) return;
  const drawer = page.getByTestId("drawer-nodes");
  await expect(drawer).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await screenshotPage(page, theme, "node-detail");
}

test.describe.serial("curated sanitized real-cluster screenshots", () => {
  for (const theme of themes) {
    test(`@screenshots-overview captures ${theme} overview screenshots`, async ({ sanitizedPage: page, kview }) => {
      const warm = await prepareScreenshotPage(page, kview.token, theme);
      const selectedNamespaces = warm.selectedNamespaces.length ? warm.selectedNamespaces : warm.namespaces;
      await captureAppScreenshots(page, kview.token, theme, warm.context, selectedNamespaces, warm.podNamespace, warm.deploymentNamespace);
    });

    test(`@screenshots-pod captures ${theme} pod drawer screenshots`, async ({ sanitizedPage: page, kview }) => {
      const warm = await prepareScreenshotPage(page, kview.token, theme);
      await capturePodDrawerScreenshots(page, kview.token, theme, warm);
    });

    test(`@screenshots-node captures ${theme} node drawer screenshots`, async ({ sanitizedPage: page, kview }) => {
      const warm = await prepareScreenshotPage(page, kview.token, theme);
      await captureNodeDrawerScreenshots(page, kview.token, theme, warm);
    });

    test(`@screenshots-namespace captures ${theme} namespace drawer screenshots`, async ({ sanitizedPage: page, kview }) => {
      const warm = await prepareScreenshotPage(page, kview.token, theme);
      const namespace = warm.selectedNamespaces[0] || await chooseInterestingNamespaceForContext(page, kview.token, warm.context).catch(() => warm.namespaces[0] || "");
      if (!namespace) throw new Error("No namespace was found for namespace drawer screenshot");
      await captureNamespaceDetailScreenshots(page, theme, namespace);
    });

    test(`@screenshots-deployment captures ${theme} deployment drawer screenshots`, async ({ sanitizedPage: page, kview }) => {
      const warm = await prepareScreenshotPage(page, kview.token, theme);
      await captureDeploymentDrawerScreenshots(page, kview.token, theme, warm);
    });
  }
});
