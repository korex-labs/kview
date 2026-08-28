// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import AttentionSummary from "./AttentionSummary";
import type { DashboardSignalItem } from "../../types/api";

function signal(overrides: Partial<DashboardSignalItem> = {}): DashboardSignalItem {
  return {
    kind: "Pod",
    severity: "medium",
    score: 1,
    reason: "CrashLoopBackOff",
    ...overrides,
  };
}

afterEach(cleanup);

describe("AttentionSummary", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<AttentionSummary />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when given only empty arrays", () => {
    const { container } = render(<AttentionSummary signals={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders ranked top 3 signals and counts overflow", () => {
    const signals: DashboardSignalItem[] = [
      signal({ reason: "low old", severity: "low", score: 99, lastSeenAt: 100 }),
      signal({ reason: "high fresh", severity: "high", score: 1, lastSeenAt: 500 }),
      signal({ reason: "medium newest", severity: "medium", score: 1, lastSeenAt: 900 }),
      signal({ reason: "high older", severity: "high", score: 90, lastSeenAt: 200 }),
      signal({ reason: "medium older", severity: "medium", score: 80, lastSeenAt: 300 }),
    ];
    render(<AttentionSummary signals={signals} />);
    expect(screen.getByText(/high fresh/)).toBeTruthy();
    expect(screen.getByText(/high older/)).toBeTruthy();
    expect(screen.getByText(/medium newest/)).toBeTruthy();
    expect(screen.queryByText(/low old/)).toBeNull();
    expect(screen.getByText("+2 more signals")).toBeTruthy();
  });

  it("uses priority and score after severity and freshness", () => {
    const signals: DashboardSignalItem[] = [
      signal({ reason: "score", severity: "medium", score: 99, signalPriority: 5, lastSeenAt: 100 }),
      signal({ reason: "priority", severity: "medium", score: 10, signalPriority: 1, lastSeenAt: 100 }),
      signal({ reason: "fresh", severity: "medium", score: 1, signalPriority: 9, lastSeenAt: 200 }),
    ];
    const { container } = render(<AttentionSummary signals={signals} />);
    const rows = Array.from(container.querySelectorAll("[data-testid='attention-signal-row']")).map((row) => row.textContent || "");
    expect(rows[0]).toContain("fresh");
    expect(rows[1]).toContain("priority");
    expect(rows[2]).toContain("score");
  });

  it("does not render tab navigation chips", () => {
    render(<AttentionSummary signals={[signal()]} />);
    expect(screen.queryByText("Conditions")).toBeNull();
    expect(screen.queryByText("Events")).toBeNull();
    expect(screen.queryByText("Spec")).toBeNull();
  });

  it("shows signal severity before its reason text", () => {
    render(
      <AttentionSummary
        signals={[
          signal({
            severity: "high",
            reason: "ImagePullBackOff",
            actualData: "ImagePullBackOff",
            calculatedData: "image myimg",
          }),
        ]}
      />,
    );
    const row = screen.getByText("ImagePullBackOff").closest("[data-signal-row]");
    expect(row).toBeTruthy();
    if (row) {
      const rowText = row.textContent || "";
      expect(rowText.indexOf("High")).toBeLessThan(rowText.indexOf("ImagePullBackOff"));
      expect(within(row as HTMLElement).getByText("image myimg")).toBeTruthy();
    }
  });

  it("shows acknowledgement, investigation, and exclusion actions when historyKey is missing", () => {
    render(<AttentionSummary token="token" signals={[signal({ signalType: "pod_restarts", name: "api-0", reason: "Missing key" })]} />);
    const row = screen.getByText("Missing key").closest("[data-signal-row]");
    expect(row).toBeTruthy();
    if (row) {
      expect(within(row as HTMLElement).getAllByLabelText("Acknowledge signal").length).toBeGreaterThan(0);
      expect(within(row as HTMLElement).getAllByLabelText("Investigate signal").length).toBeGreaterThan(0);
      expect(within(row as HTMLElement).getAllByLabelText("Exclude this signal").length).toBeGreaterThan(0);
      expect(within(row as HTMLElement).queryByLabelText("Suppress signal")).toBeNull();
    }
  });

  it("renders a suppressed-only summary with rows hidden initially", () => {
    render(
      <AttentionSummary
        suppressedSignalCount={1}
        suppressedSignals={[
          signal({
            kind: "Deployment",
            namespace: "apps",
            name: "api",
            reason: "Paused rollout",
            suppression: { mode: "until_changed", comment: "expected during migration" },
          }),
        ]}
      />,
    );

    const toggle = screen.getByRole("button", { name: "Show suppressed (1)" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("1 suppressed")).toBeTruthy();
    expect(screen.queryByText("Paused rollout")).toBeNull();
  });

  it("shows suppressed metadata and one restore control without changing visible ranking", () => {
    const visibleSignals = [
      signal({ reason: "visible high", severity: "high", lastSeenAt: 300 }),
      signal({ reason: "visible medium", severity: "medium", lastSeenAt: 200 }),
      signal({ reason: "visible low", severity: "low", lastSeenAt: 100 }),
      signal({ reason: "visible overflow", severity: "low", lastSeenAt: 50 }),
    ];
    render(
      <AttentionSummary
        token="token"
        signals={visibleSignals}
        suppressedSignalCount={1}
        suppressedSignals={[
          signal({
            kind: "Deployment",
            namespace: "apps",
            name: "api",
            severity: "high",
            reason: "suppressed high",
            historyKey: "deployment/apps/api/suppressed-high",
            suppression: { mode: "snooze", expiresAt: 2_000_000_000, comment: "maintenance window" },
          }),
        ]}
      />,
    );

    expect(screen.getAllByTestId("attention-signal-row")).toHaveLength(3);
    expect(screen.getByText("+1 more signal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show suppressed (1)" }));

    const targetId = screen.getByRole("button", { name: "Hide suppressed (1)" }).getAttribute("aria-controls") || "";
    const section = document.getElementById(targetId) as HTMLElement;
    expect(section).toBeTruthy();
    expect(within(section).getByText("Deployment")).toBeTruthy();
    expect(within(section).getByText("apps/api")).toBeTruthy();
    expect(within(section).getByText("suppressed high")).toBeTruthy();
    expect(within(section).getByText("Snoozed")).toBeTruthy();
    expect(within(section).getByText(/Expires /)).toBeTruthy();
    expect(within(section).getByText("Comment: maintenance window")).toBeTruthy();
    expect(within(section).getAllByRole("button", { name: /^Show signal now/ })).toHaveLength(1);
    expect(within(section).queryByRole("button", { name: "Suppress signal" })).toBeNull();
    expect(screen.getAllByTestId("attention-signal-row")).toHaveLength(3);
    expect(screen.getByText("+1 more signal")).toBeTruthy();
  });

  it("shows a capped suppressed-list note", () => {
    render(
      <AttentionSummary
        suppressedSignalCount={4}
        suppressedSignals={[
          signal({ reason: "capped item", suppression: { mode: "until_changed" } }),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show suppressed (4)" }));
    expect(screen.getByText("Showing 1 of 4 suppressed.")).toBeTruthy();
  });

  it("uses a focusable native button with expanded state for the suppressed toggle", () => {
    render(<AttentionSummary suppressedSignalCount={2} suppressedSignals={[]} />);
    const toggle = screen.getByRole("button", { name: "Show suppressed (2)" });
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Hide suppressed (2)" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("uses distinct suppressed-list ARIA targets for multiple instances", () => {
    render(
      <>
        <AttentionSummary suppressedSignalCount={1} suppressedSignals={[]} />
        <AttentionSummary suppressedSignalCount={1} suppressedSignals={[]} />
      </>,
    );
    const toggles = screen.getAllByRole("button", { name: "Show suppressed (1)" });
    const targetIds = toggles.map((toggle) => toggle.getAttribute("aria-controls"));

    expect(targetIds[0]).toBeTruthy();
    expect(targetIds[1]).toBeTruthy();
    expect(targetIds[0]).not.toBe(targetIds[1]);

    fireEvent.click(toggles[0]);
    fireEvent.click(toggles[1]);
    for (const targetId of targetIds) {
      const targets = Array.from(document.querySelectorAll("[id]")).filter((element) => element.id === targetId);
      expect(targets).toHaveLength(1);
      expect(document.getElementById(targetId || "")).toBe(targets[0]);
    }
  });
});
