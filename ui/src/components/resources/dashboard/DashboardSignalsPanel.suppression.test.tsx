// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSignalItem, DashboardSignalsPanel as DashboardSignalsPanelData } from "../../../types/api";
import DashboardSignalsPanel from "./DashboardSignalsPanel";

vi.mock("../../shared/SignalActions", () => ({
  default: ({ signal }: { signal: DashboardSignalItem }) => (
    <button type="button">{signal.suppression ? "Show signal now" : "Suppress signal"}</button>
  ),
}));

vi.mock("../../shared/SignalInvestigationDialog", () => ({ default: () => null }));

const visibleSignal: DashboardSignalItem = {
  kind: "Pod",
  namespace: "apps",
  name: "visible-only",
  severity: "high",
  score: 10,
  reason: "Visible reason",
};

const suppressedSignals: DashboardSignalItem[] = [
  {
    kind: "Deployment",
    namespace: "apps",
    name: "suppressed-snooze",
    severity: "medium",
    score: 8,
    reason: "Snoozed reason",
    historyKey: "deployment/apps/suppressed-snooze/reason",
    suppression: { mode: "snooze", expiresAt: 2_000_000_000, comment: "maintenance window" },
  },
  {
    kind: "Service",
    namespace: "payments",
    name: "suppressed-change",
    severity: "low",
    score: 3,
    reason: "Until changed reason",
    historyKey: "service/payments/suppressed-change/reason",
    suppression: { mode: "until_changed", comment: "known topology" },
  },
];

function panel(): DashboardSignalsPanelData {
  return {
    total: 42,
    high: 1,
    medium: 0,
    low: 0,
    emptyNamespaces: 0,
    stuckHelmReleases: 0,
    abnormalJobs: 0,
    abnormalCronJobs: 0,
    emptyConfigMaps: 0,
    emptySecrets: 0,
    potentiallyUnusedPVCs: 0,
    potentiallyUnusedServiceAccounts: 0,
    quotaWarnings: 0,
    podRestartSignals: 0,
    workloadWarnings: 0,
    serviceWarnings: 0,
    ingressWarnings: 0,
    pvcWarnings: 0,
    roleWarnings: 0,
    roleBindingWarnings: 0,
    hpaWarnings: 0,
    containerNearLimit: 0,
    nodeResourcePressure: 0,
    items: [visibleSignal],
    itemsTotal: 42,
    itemsOffset: 20,
    itemsLimit: 10,
    suppressed: { total: 5, snoozed: 3, untilChanged: 2 },
    suppressedItems: suppressedSignals,
  };
}

function renderPanel() {
  return render(
    <DashboardSignalsPanel
      token="token"
      signalPanel={panel()}
      signalFilter="high"
      signalFilters={["high"]}
      onSignalFilterChange={vi.fn()}
      signalsQuery="visible"
      onSignalsQueryChange={vi.fn()}
      signalsSort="priority"
      onSignalsSortChange={vi.fn()}
      signalsPage={2}
      onSignalsPageChange={vi.fn()}
      signalsRowsPerPage={10}
      onSignalsRowsPerPageChange={vi.fn()}
      onInspect={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("DashboardSignalsPanel suppressed signals", () => {
  it("summarizes by mode, stays hidden by default, and renders an independent capped list", () => {
    const view = renderPanel();
    const toggle = screen.getByRole("button", { name: /show suppressed \(5 total · 3 snoozed · 2 until changed\)/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Suppressed signals")).toBeNull();
    expect(screen.getByText(/Showing 1 of 42 high severity signals\./)).toBeTruthy();
    expect(screen.getByText("visible-only")).toBeTruthy();
    expect(getComputedStyle(screen.getByRole("columnheader", { name: "Status" })).width).toBe("212px");
    expect(getComputedStyle(screen.getByRole("button", { name: "Suppress signal" }).parentElement as HTMLElement).flexWrap).toBe("nowrap");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const section = view.container.querySelector("#dashboard-suppressed-signals") as HTMLElement;
    expect(section).toBeTruthy();
    expect(within(section).getByText("Showing 2 of 5 suppressed.")).toBeTruthy();
    expect(within(section).getByText("suppressed-snooze")).toBeTruthy();
    expect(within(section).getByText("suppressed-change")).toBeTruthy();
    expect(within(section).getByText("Snoozed")).toBeTruthy();
    expect(within(section).getByText("Until changed")).toBeTruthy();
    expect(within(section).getByText(/Expires /)).toBeTruthy();
    expect(within(section).getByText("Comment: maintenance window")).toBeTruthy();
    expect(within(section).getByText("Comment: known topology")).toBeTruthy();
    expect(within(section).getAllByRole("button", { name: "Show signal now" })).toHaveLength(2);
    expect(within(section).queryByRole("button", { name: "Suppress signal" })).toBeNull();
    expect(screen.getByText(/Showing 1 of 42 high severity signals\./)).toBeTruthy();
  });
});
