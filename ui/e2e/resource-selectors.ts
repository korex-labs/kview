import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

type ApiRecord = Record<string, unknown>;

export async function apiGet(page: Page, token: string, path: string): Promise<ApiRecord> {
  return page.evaluate(
    async ({ token: requestToken, path: requestPath }) => {
      const response = await fetch(requestPath, {
        headers: { Authorization: `Bearer ${requestToken}` },
      });
      if (!response.ok) throw new Error(`GET ${requestPath} failed with ${response.status}`);
      return response.json();
    },
    { token, path },
  );
}

function asRecord(value: unknown): ApiRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ApiRecord : {};
}

function asArray(value: unknown): ApiRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value || 0);
}

function uniqueNames(items: Array<string | null | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => !!item))];
}

function containerIsRunning(container: ApiRecord): boolean {
  return asString(container.state).toLowerCase() === "running";
}

async function podRunningContainerScore(page: Page, token: string, namespace: string, podName: string): Promise<number> {
  const details = await apiGet(page, token, `/api/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(podName)}`).catch(() => null);
  const containers = asArray(asRecord(details?.item).containers);
  if (containerIsRunning(containers[0] || {})) return 2;
  return containers.some(containerIsRunning) ? 1 : 0;
}

export async function chooseInterestingNamespace(page: Page, token: string): Promise<string> {
  const dashboard = await apiGet(page, token, "/api/dashboard/cluster?signalsFilter=top&signalsLimit=50");
  const dashboardItem = asRecord(dashboard.item);
  const dashboardSignals = asRecord(dashboardItem.signals);
  const signals = [
    ...asArray(dashboardSignals.items),
    ...asArray(dashboardSignals.top),
  ];
  const quotaSignal = signals.find((signal) =>
    asString(signal.namespace) && `${asString(signal.signalType)} ${asString(signal.reason)}`.toLowerCase().includes("quota"));
  if (asString(quotaSignal?.namespace)) return asString(quotaSignal?.namespace);

  const namespacedSignal = signals.find((signal) => asString(signal.namespace));
  if (asString(namespacedSignal?.namespace)) return asString(namespacedSignal?.namespace);

  const namespaces = await apiGet(page, token, "/api/namespaces");
  const first = asString(asArray(namespaces.items)[0]?.name);
  if (!first) throw new Error("No namespace is available for E2E selection");
  return first;
}

export async function chooseNamespaceWithDeployments(page: Page, token: string, fallback: string): Promise<string> {
  const namespaces = await apiGet(page, token, "/api/namespaces");
  const candidates = [
    fallback,
    ...asArray(namespaces.items).map((item) => asString(item.name)).filter(Boolean),
  ];
  for (const namespace of [...new Set(candidates)]) {
    const deployments = await apiGet(page, token, `/api/namespaces/${encodeURIComponent(namespace)}/deployments`).catch(() => null);
    if (asArray(deployments?.items).length > 0) return namespace;
  }
  return fallback;
}

export async function chooseInterestingPod(page: Page, token: string, namespace: string): Promise<string | null> {
  const pods = await apiGet(page, token, `/api/namespaces/${encodeURIComponent(namespace)}/pods`);
  const items = asArray(pods.items);
  const running = items.filter((pod) => `${asString(pod.phase)} ${asString(pod.status)}`.toLowerCase().includes("running"));
  const signaled = running.find((pod) =>
    pod.listSignalSeverity ||
    pod.signalSeverity ||
    asNumber(pod.signalCount) > 0 ||
    asNumber(pod.signals) > 0 ||
    asNumber(pod.restartCount) > 0 ||
    asNumber(pod.restarts) > 0);
  const highMetric = running.find((pod) =>
    Math.max(
      asNumber(pod.cpuPct),
      asNumber(pod.cpuPercent),
      asNumber(pod.memoryPct),
      asNumber(pod.memoryPercent),
      asNumber(pod.cpuUsagePct),
      asNumber(pod.memoryUsagePct),
    ) >= 70);

  const fallback = asString(running[0]?.name) || asString(items[0]?.name) || null;
  const candidates = uniqueNames([
    asString(signaled?.name),
    asString(highMetric?.name),
    ...running.map((pod) => asString(pod.name)),
    ...items.map((pod) => asString(pod.name)),
  ]);

  let bestWithAnyRunningContainer: string | null = null;
  for (const podName of candidates) {
    const score = await podRunningContainerScore(page, token, namespace, podName);
    if (score === 2) return podName;
    if (score === 1 && !bestWithAnyRunningContainer) bestWithAnyRunningContainer = podName;
  }

  return bestWithAnyRunningContainer || fallback;
}

export async function chooseAnyDeployment(page: Page, token: string, namespace: string): Promise<string | null> {
  const deployments = await apiGet(page, token, `/api/namespaces/${encodeURIComponent(namespace)}/deployments`);
  return asString(asArray(deployments.items)[0]?.name) || null;
}

export async function listDeployments(page: Page, token: string, namespace: string, limit = 5): Promise<string[]> {
  const deployments = await apiGet(page, token, `/api/namespaces/${encodeURIComponent(namespace)}/deployments`);
  return asArray(deployments.items)
    .map((item) => asString(item.name))
    .filter(Boolean)
    .slice(0, limit);
}

export async function selectSidebarNamespace(page: Page, namespace: string): Promise<void> {
  const clusterScopedNamespaceField = page.getByText("Cluster-scoped resource");
  if (await clusterScopedNamespaceField.isVisible().catch(() => false)) {
    await page.getByTestId("nav-pods").click();
    await expect(page.getByTestId("resource-list-pods")).toBeVisible({ timeout: 30_000 });
  }
  const input = page.getByRole("combobox", { name: "Namespace" });
  await expect(input).toBeEnabled({ timeout: 30_000 });
  await input.click();
  await input.fill(namespace);
  const option = page.getByRole("option", { name: namespace }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
  } else {
    await input.press("Enter");
  }
  await expect(input).toHaveValue(namespace, { timeout: 30_000 });
}

export async function openSection(page: Page, section: string): Promise<void> {
  await page.getByTestId(`nav-${section}`).click();
  await expect(page.getByTestId(`resource-list-${section}`)).toBeVisible({ timeout: 30_000 });
}

export async function openFirstResourceDrawer(page: Page, section: string): Promise<boolean> {
  const list = page.getByTestId(`resource-list-${section}`);
  const firstRow = list.locator(".MuiDataGrid-row[data-id]").first();
  if (!(await firstRow.isVisible({ timeout: 20_000 }).catch(() => false))) return false;
  await firstRow.dblclick();
  await expect(page.getByTestId(`drawer-${section}`)).toBeVisible({ timeout: 30_000 });
  return true;
}

export async function openResourceDrawerByName(page: Page, section: string, name: string): Promise<boolean> {
  const list = page.getByTestId(`resource-list-${section}`);
  const row = list.locator(".MuiDataGrid-row", { hasText: name }).first();
  if (!(await row.isVisible({ timeout: 45_000 }).catch(() => false))) return false;
  await row.dblclick();
  await expect(page.getByTestId(`drawer-${section}`)).toBeVisible({ timeout: 30_000 });
  return true;
}
