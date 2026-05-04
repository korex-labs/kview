import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { test, expect, openKview } from "./fixtures";
import {
  chooseInterestingNamespace,
  chooseInterestingPod,
  chooseNamespaceWithDeployments,
  listDeployments,
  openFirstResourceDrawer,
  openResourceDrawerByName,
  openSection,
  selectSidebarNamespace,
} from "./resource-selectors";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../..");
const screenshotDir = path.resolve(repoRoot, ".artifacts/screenshots");

test.setTimeout(600_000);

async function screenshotPage(page: Page, name: string) {
  await mkdir(screenshotDir, { recursive: true });
  await page.waitForTimeout(750);
  await page.screenshot({ path: path.join(screenshotDir, `${name}.png`), fullPage: true });
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

async function drawerHasRequestFailed(drawer: Locator) {
  return drawer.getByText(/request failed/i).first().isVisible({ timeout: 5_000 }).catch(() => false);
}

async function tryScreenshotDeploymentDetail(page: Page, deploymentNames: string[]) {
  for (const deployment of deploymentNames) {
    if (!await openResourceDrawerByName(page, "deployments", deployment)) continue;
    const drawer = page.getByTestId("drawer-deployments");
    await waitForSettled(drawer);
    if (!await drawerHasRequestFailed(drawer)) {
      await screenshotPage(page, "deployment-detail");
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0, { timeout: 10_000 });
      return;
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0, { timeout: 10_000 });
  }
}

async function closeActivityPanel(page: Page) {
  const collapseToggle = page.getByLabel("Collapse activity panel");
  if (await collapseToggle.isVisible().catch(() => false)) {
    await collapseToggle.click();
    await expect(page.getByTestId("activity-panel-toggle")).toHaveAccessibleName("Expand activity panel", { timeout: 10_000 });
  }
}

test("captures sanitized real-cluster app screenshots", async ({ sanitizedPage: page, kview }) => {
  await openKview(page, kview.token);
  await closeActivityPanel(page);

  await page.getByTestId("nav-dashboard").click();
  const dashboard = page.getByTestId("cluster-dashboard");
  await expect(dashboard).toBeVisible({ timeout: 60_000 });
  await waitForSettled(dashboard);
  await screenshotPage(page, "cluster-dashboard");

  const namespace = await chooseInterestingNamespace(page, kview.token);
  const deploymentNamespace = await chooseNamespaceWithDeployments(page, kview.token, namespace);
  await openSection(page, "namespaces");
  const namespaceList = page.getByTestId("resource-list-namespaces");
  await waitForSettled(namespaceList);
  await screenshotPage(page, "namespace-list");
  if (await openResourceDrawerByName(page, "namespaces", namespace)) {
    const drawer = page.getByTestId("drawer-namespaces");
    await waitForDrawerSettled(drawer);
    await screenshotPage(page, "namespace-detail");
    await page.keyboard.press("Escape");
  }

  await selectSidebarNamespace(page, namespace);
  await openSection(page, "pods");
  const podList = page.getByTestId("resource-list-pods");
  await waitForSettled(podList);
  await screenshotPage(page, "pods-list");
  const pod = await chooseInterestingPod(page, kview.token, namespace);
  if (pod && await openResourceDrawerByName(page, "pods", pod)) {
    const drawer = page.getByTestId("drawer-pods");
    await waitForDrawerSettled(drawer);
    await screenshotPage(page, "pod-detail");
    await drawer.getByRole("tab", { name: "Containers" }).click();
    await waitForDrawerSettled(drawer);
    await screenshotPage(page, "pod-detail-containers");
    await page.keyboard.press("Escape");
  }

  await selectSidebarNamespace(page, deploymentNamespace);
  await openSection(page, "deployments");
  const deploymentsList = page.getByTestId("resource-list-deployments");
  const deployments = await listDeployments(page, kview.token, deploymentNamespace);
  if (deployments[0]) {
    await expect(deploymentsList.locator(".MuiDataGrid-row", { hasText: deployments[0] }).first()).toBeVisible({ timeout: 90_000 });
  }
  await waitForSettled(deploymentsList);
  await screenshotPage(page, "deployments-list");
  await tryScreenshotDeploymentDetail(page, deployments);

  await openSection(page, "nodes");
  const nodesList = page.getByTestId("resource-list-nodes");
  await waitForSettled(nodesList);
  await screenshotPage(page, "nodes-list");
  if (await openFirstResourceDrawer(page, "nodes")) {
    const drawer = page.getByTestId("drawer-nodes");
    await waitForDrawerSettled(drawer);
    await screenshotPage(page, "node-detail");
    await page.keyboard.press("Escape");
  }

  await page.getByTestId("settings-toggle").click();
  const settings = page.getByTestId("settings-view");
  await expect(settings).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("settings-nav-dataplane").click();
  await expect(page.getByTestId("settings-section-dataplane")).toBeVisible({ timeout: 30_000 });
  await screenshotPage(page, "settings-dataplane");
  await page.getByTestId("settings-dataplane-tab-enrichment").click();
  await expect(page.getByTestId("settings-dataplane-tab-enrichment")).toHaveAttribute("aria-selected", "true");
  await screenshotPage(page, "settings-dataplane-enrichment");
  await page.getByTestId("settings-dataplane-tab-signals").click();
  await expect(page.getByTestId("settings-dataplane-tab-signals")).toHaveAttribute("aria-selected", "true");
  await waitForSettled(page.getByTestId("settings-section-dataplane"));
  await screenshotPage(page, "settings-dataplane-signals");
});
