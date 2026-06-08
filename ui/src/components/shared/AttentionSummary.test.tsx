// @vitest-environment jsdom

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  it("shows acknowledgement and investigation actions when historyKey is missing", () => {
    render(<AttentionSummary token="token" signals={[signal({ reason: "Missing key" })]} />);
    const row = screen.getByText("Missing key").closest("[data-signal-row]");
    expect(row).toBeTruthy();
    if (row) {
      expect(within(row as HTMLElement).getAllByLabelText("Acknowledge signal").length).toBeGreaterThan(0);
      expect(within(row as HTMLElement).getAllByLabelText("Investigate signal").length).toBeGreaterThan(0);
    }
  });
});
