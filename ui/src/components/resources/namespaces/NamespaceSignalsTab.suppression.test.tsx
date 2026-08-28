// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSignalItem } from "../../../types/api";
import NamespaceSignalsTab from "./NamespaceSignalsTab";

vi.mock("../../shared/AttentionSummary", () => ({
  default: ({ signals }: { signals: DashboardSignalItem[] }) => <div data-testid="attention-count">{signals.length}</div>,
}));
vi.mock("../../shared/SignalActions", () => ({
  default: ({ signal }: { signal: DashboardSignalItem }) => (
    <button type="button">{signal.suppression ? "Show signal now" : "Suppress signal"}</button>
  ),
}));
vi.mock("../../shared/SignalInvestigationDialog", () => ({ default: () => null }));
vi.mock("./NamespaceActions", () => ({ default: () => null }));

const visibleSignal: DashboardSignalItem = {
  kind: "Pod",
  namespace: "apps",
  name: "visible-pod",
  severity: "high",
  score: 9,
  reason: "Visible namespace reason",
};

const suppressedSignal: DashboardSignalItem = {
  kind: "Service",
  namespace: "apps",
  name: "suppressed-service",
  severity: "medium",
  score: 5,
  reason: "Suppressed namespace reason",
  historyKey: "service/apps/suppressed-service/reason",
  suppression: { mode: "snooze", expiresAt: 2_000_000_000, comment: "planned rollout" },
};

function renderTab() {
  return render(
    <NamespaceSignalsTab
      token="token"
      namespaceName="apps"
      signals={[visibleSignal]}
      suppressedSignalCount={2}
      suppressedSignals={[suppressedSignal]}
      problematic={[]}
      quotaPressure={{ critical: 0, warning: 0 }}
      onClose={vi.fn()}
      onOpenPod={vi.fn()}
      onOpenDeployment={vi.fn()}
      onOpenJob={vi.fn()}
      onOpenHPA={vi.fn()}
      onOpenCustomResource={vi.fn()}
      onOpenHelmRelease={vi.fn()}
      onOpenResourceQuota={vi.fn()}
      onNavigate={vi.fn()}
      onSelectCapacityTab={vi.fn()}
    />,
  );
}

afterEach(cleanup);

describe("NamespaceSignalsTab suppressed signals", () => {
  it("keeps visible signals and attention unchanged while toggling the suppressed list", () => {
    const view = renderTab();
    const toggle = screen.getByRole("button", { name: "Show suppressed (2)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("attention-count").textContent).toBe("1");
    expect(screen.getByText("apps/visible-pod")).toBeTruthy();
    expect(screen.queryByText("apps/suppressed-service")).toBeNull();
    expect(getComputedStyle(screen.getByRole("columnheader", { name: "Signal" })).width).toBe("212px");
    expect(getComputedStyle(screen.getByRole("button", { name: "Suppress signal" }).parentElement as HTMLElement).flexWrap).toBe("nowrap");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const section = view.container.querySelector("#namespace-suppressed-signals") as HTMLElement;
    expect(section).toBeTruthy();
    expect(within(section).getByText("Showing 1 of 2 suppressed.")).toBeTruthy();
    expect(within(section).getByText("apps/suppressed-service")).toBeTruthy();
    expect(within(section).getByText("Suppressed namespace reason")).toBeTruthy();
    expect(within(section).getByText("Snoozed")).toBeTruthy();
    expect(within(section).getByText(/Expires /)).toBeTruthy();
    expect(within(section).getByText("Comment: planned rollout")).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Show signal now" })).toBeTruthy();
    expect(within(section).queryByRole("button", { name: "Suppress signal" })).toBeNull();
    expect(screen.getByTestId("attention-count").textContent).toBe("1");
    expect(screen.getByText("apps/visible-pod")).toBeTruthy();
  });
});
