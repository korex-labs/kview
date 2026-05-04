import { test as base, expect, type Page } from "@playwright/test";
import { ApiSanitizer } from "./sanitizer";
import { readKviewState, type KviewE2EState } from "./state";

type Fixtures = {
  kview: KviewE2EState;
  sanitizedPage: Page;
};

export const test = base.extend<Fixtures>({
  // Playwright requires fixture callbacks to use object destructuring.
  // eslint-disable-next-line no-empty-pattern
  kview: async ({}, run) => {
    await run(await readKviewState());
  },
  sanitizedPage: async ({ page, kview }, run) => {
    const sanitizer = new ApiSanitizer();
    await page.route("**/api/**", (route) => sanitizer.handle(route, kview.backendURL));
    try {
      await run(page);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  },
});

export { expect };

async function dialogText(page: Page): Promise<string> {
  return page
    .locator(".MuiDialog-root")
    .first()
    .evaluate((node) => node.textContent || "", { timeout: 1_000 })
    .then((text) => text.replace(/\s+/g, " ").trim())
    .catch(() => "");
}

async function waitForStartupReady(page: Page): Promise<void> {
  const deadline = Date.now() + 180_000;
  const dialogs = page.locator(".MuiDialog-root");
  while (Date.now() < deadline) {
    const count = await dialogs.count();
    if (count === 0) return;

    const text = await dialogText(page);
    if (
      text.includes("No kube context available") ||
      text.includes("Startup did not complete") ||
      text.includes("unauthorized") ||
      text.includes("No Kubernetes contexts were loaded")
    ) {
      throw new Error(`kview did not reach ready state: ${text}`);
    }

    await page.waitForTimeout(1_000);
  }

  const text = await dialogText(page);
  throw new Error(`Timed out waiting for kview startup dialog to close. Last dialog text: ${text}`);
}

export async function openKview(page: Page, token: string): Promise<void> {
  await page.goto(`/?token=${token}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/^kview/).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId("nav-dashboard")).toBeVisible({ timeout: 120_000 });
  await waitForStartupReady(page);
}
