// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import HelmChartDrawer from "./HelmChartDrawer";
import { UserSettingsProvider } from "../../../settingsContext";

const apiGet = vi.hoisted(() => vi.fn());
vi.mock("../../../api", () => ({ apiGet }));
vi.mock("../../layout/RightDrawer", () => ({
  useRightDrawerLayout: () => null,
  default: ({ children }: { children: React.ReactNode }) => <UserSettingsProvider>{children}</UserSettingsProvider>,
}));
vi.mock("../namespaces/NamespaceDrawer", () => ({ default: () => null }));
vi.mock("./HelmReleaseDrawer", () => ({ default: () => null }));
vi.mock("../../shared/AttentionSummary", () => ({ default: () => null }));
vi.mock("../../shared/ResourceYamlPanel", () => ({ default: () => <div data-testid="yaml-panel" /> }));

afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

it("styles both existing browse lists without opting in clipped frames or YAML", async () => {
  const chart = {
    chartName: "sample-chart", chartVersion: "1.0.0", appVersion: "1.0", releases: 1,
    versions: [{ chartVersion: "1.0.0", appVersion: "1.0", releases: 1, deployments: [
      { name: "sample-release", namespace: "apps", revision: 1, status: "deployed", manifest: "kind: Service" },
    ] }],
  };
  apiGet.mockResolvedValue({ item: chart });
  render(<HelmChartDrawer open token="token" chart={chart} onClose={vi.fn()} />);
  const tablist = await screen.findByRole("tablist");
  expect(screen.getAllByRole("tablist")).toHaveLength(1);
  fireEvent.click(within(tablist).getByRole("tab", { name: "Versions" }));
  const tables = await screen.findAllByRole("table");
  expect(tables).toHaveLength(2);
  for (const [index, table] of tables.entries()) {
    const owner = table.parentElement!;
    expect(owner.classList.contains("kview-native-scrollbar")).toBe(true);
    expect(getComputedStyle(owner).overflow).toBe("auto");
    expect(getComputedStyle(owner).maxHeight).toBe(index === 0 ? "220px" : "180px");
  }
  const yaml = screen.getByTestId("yaml-panel");
  expect(yaml.closest(".kview-native-scrollbar")).toBeNull();
  expect(getComputedStyle(yaml.parentElement!).overflow).toBe("hidden");
  expect(within(tablist).getByRole("tab", { name: "Notes" })).toBeTruthy();
});
