import path from "node:path";
import { expect, openKview, test } from "./fixtures";

test("explains dataplane list metadata lazily without widening the layout", async ({ sanitizedPage: page, kview }) => {
  const explanationRequests: Array<{ context: string | undefined }> = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname !== "/api/dataplane/explanation") return;
    explanationRequests.push({ context: request.headers()["x-kview-context"] });
  });

  await openKview(page, kview.token);
  const nodesNav = page.getByTestId("nav-nodes").last();
  await expect(nodesNav).toBeVisible({ timeout: 30_000 });
  await nodesNav.click();
  await expect(page.getByTestId("resource-list-nodes")).toBeVisible({ timeout: 30_000 });

  const explain = page.getByRole("button", { name: "Explain" }).first();
  await expect(explain).toBeVisible({ timeout: 30_000 });
  expect(explanationRequests).toHaveLength(0);

  await explain.click();
  const dialog = page.getByRole("dialog", { name: "Dataplane explanation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Snapshot", level: 3 })).toBeVisible();
  await expect(dialog.getByText("Surface snapshot facts stay authoritative.", { exact: false })).toBeVisible();
  await expect(dialog.getByText("Loading runtime explanation…")).toBeHidden({ timeout: 30_000 });

  expect(explanationRequests).toHaveLength(1);
  expect(explanationRequests[0]?.context).toBeTruthy();

  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(520);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.screenshot({
    path: path.resolve("../.artifacts/playwright/dataplane-explanation.png"),
    fullPage: true,
  });
});
