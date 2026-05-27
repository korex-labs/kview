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

  it("renders top 3 signals and counts overflow", () => {
    const signals: DashboardSignalItem[] = [
      signal({ reason: "first" }),
      signal({ reason: "second" }),
      signal({ reason: "third" }),
      signal({ reason: "fourth" }),
      signal({ reason: "fifth" }),
    ];
    render(<AttentionSummary signals={signals} />);
    expect(screen.getByText(/first/)).toBeTruthy();
    expect(screen.getByText(/second/)).toBeTruthy();
    expect(screen.getByText(/third/)).toBeTruthy();
    expect(screen.queryByText(/fourth/)).toBeNull();
    expect(screen.getByText("+2 more signals")).toBeTruthy();
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
