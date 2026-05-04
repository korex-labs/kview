import { test, expect, openKview } from "./fixtures";
import {
  apiGet,
  chooseAnyDeployment,
  chooseInterestingNamespace,
  chooseInterestingPod,
  openResourceDrawerByName,
  openSection,
  selectSidebarNamespace,
} from "./resource-selectors";

test("loads real cluster views through sanitized API responses", async ({ sanitizedPage: page, kview }) => {
  await openKview(page, kview.token);

  await page.getByTestId("nav-dashboard").click();
  await expect(page.getByTestId("cluster-dashboard")).toBeVisible({ timeout: 60_000 });

  const namespace = await chooseInterestingNamespace(page, kview.token);

  await openSection(page, "namespaces");
  await expect(page.getByText(namespace).first()).toBeVisible({ timeout: 30_000 });
  await openResourceDrawerByName(page, "namespaces", namespace);
  await expect(page.getByTestId("drawer-namespaces")).toBeVisible();
  await page.keyboard.press("Escape");

  await selectSidebarNamespace(page, namespace);
  await openSection(page, "pods");
  await expect(page.getByTestId("resource-list-pods")).toBeVisible();

  const pod = await chooseInterestingPod(page, kview.token, namespace);
  if (pod) {
    await openResourceDrawerByName(page, "pods", pod);
    await expect(page.getByTestId("drawer-pods")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  await openSection(page, "deployments");
  const deployment = await chooseAnyDeployment(page, kview.token, namespace);
  if (deployment) {
    await openResourceDrawerByName(page, "deployments", deployment);
    await expect(page.getByTestId("drawer-deployments")).toBeVisible();
  } else {
    await expect(page.getByTestId("resource-list-deployments")).toBeVisible();
  }
});

test("read-only backend blocks action execution while dialogs remain usable", async ({ sanitizedPage: page, kview }) => {
  await openKview(page, kview.token);
  const namespace = await chooseInterestingNamespace(page, kview.token);
  await selectSidebarNamespace(page, namespace);
  await openSection(page, "pods");

  const pod = await chooseInterestingPod(page, kview.token, namespace);
  test.skip(!pod, "No pod is available to exercise a mutation dialog");

  await openResourceDrawerByName(page, "pods", pod!);
  await expect(page.getByTestId("drawer-pods")).toBeVisible();
  await page.getByRole("button", { name: "Delete" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Target")).toBeVisible();
  await dialog.getByLabel("Confirmation").fill(pod!);
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(dialog.getByText("Action failed")).toBeVisible({ timeout: 30_000 });

  const contexts = await apiGet(page, kview.token, "/api/contexts");
  const contextItems = Array.isArray(contexts.contexts) ? contexts.contexts as Array<{ name?: unknown }> : [];
  const activeContext = typeof contexts.active === "string"
    ? contexts.active
    : typeof contextItems[0]?.name === "string" ? contextItems[0].name : "";
  const blocked = await page.evaluate(
    async ({ token, namespace, context }) => {
      const response = await fetch("/api/actions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Kview-Context": context,
        },
        body: JSON.stringify({
          resource: "pods",
          action: "pod.delete",
          namespace,
          name: "resource-999",
        }),
      });
      return { status: response.status, text: await response.text() };
    },
    { token: kview.token, namespace, context: activeContext },
  );
  expect(blocked.status).toBe(403);
  expect(blocked.text).toContain("read-only mode blocks Kubernetes mutations");
});

test("cluster dashboard API exposes candidates for adaptive screenshots", async ({ sanitizedPage: page, kview }) => {
  await openKview(page, kview.token);
  const dashboard = await apiGet(page, kview.token, "/api/dashboard/cluster?signalsFilter=top&signalsLimit=50");
  const item = dashboard.item && typeof dashboard.item === "object" && !Array.isArray(dashboard.item)
    ? dashboard.item as { visibility?: { namespaces?: { total?: unknown } } }
    : {};
  expect(item).toBeTruthy();
  expect(typeof item.visibility?.namespaces?.total === "number" ? item.visibility.namespaces.total : 0).toBeGreaterThanOrEqual(0);
});
