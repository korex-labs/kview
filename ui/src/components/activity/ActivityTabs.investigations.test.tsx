// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiGet } from "../../api";
import { listInvestigationSnapshots } from "../../investigationSnapshots";
import ActivityTabs from "./ActivityTabs";

vi.mock("../../api", async (original) => ({ ...await original<typeof import("../../api")>(), apiGet: vi.fn() }));
vi.mock("../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy" }) }));
vi.mock("../../utils/usePageVisible", () => ({ default: () => true }));
vi.mock("../../investigationSnapshots", () => ({ listInvestigationSnapshots: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });

it("does not turn durable triage records into perpetual runtime activities", async () => {
  vi.useFakeTimers();
  const snapshots = [{ id: "saved-bundle", title: "Saved evidence", triageState: "investigating" as const,
    createdAt: 1, signal: { type: "fixture", title: "Saved signal" }, markdown: "Saved evidence", source: "investigate-signal",
    primaryResource: { kind: "Pod", namespace: "fixture", name: "example" } }];
  vi.mocked(listInvestigationSnapshots).mockResolvedValue(snapshots);
  vi.mocked(apiGet).mockResolvedValue({ items: [] });
  await act(async () => { render(<ActivityTabs panelOpen tab={0} token="fixture-token" />); });
  expect(screen.queryByText("Saved evidence")).toBeNull();
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(listInvestigationSnapshots).not.toHaveBeenCalled();
  expect(snapshots[0].triageState).toBe("investigating");
  expect(screen.getByText("No active activities yet.")).toBeTruthy();
});

it("preserves long-running work and failures, then uses existing removal animation for retired work", async () => {
  vi.useFakeTimers();
  const running = { id: "work-one", kind: "worker", type: "dataplane-snapshot", title: "Long running work",
    status: "running", createdAt: "2020-01-01T00:00:00Z" };
  const failed = { ...running, id: "work-failed", title: "Failed work", status: "failed" };
  vi.mocked(listInvestigationSnapshots).mockResolvedValue([]);
  vi.mocked(apiGet).mockResolvedValue({ items: [running, failed] });
  await act(async () => { render(<ActivityTabs panelOpen tab={0} token="fixture-token" />); });
  await act(async () => { vi.advanceTimersByTime(60000); });
  expect(screen.getByText("Long running work")).toBeTruthy();
  expect(screen.getByText("Failed work")).toBeTruthy();
  vi.mocked(apiGet).mockResolvedValue({ items: [{ ...running, status: "stopped" }, failed] });
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByText("Stopped")).toBeTruthy();
  vi.mocked(apiGet).mockResolvedValue({ items: [failed] });
  await act(async () => { vi.advanceTimersByTime(5000); });
  expect(screen.getByText("Long running work").closest("tr")?.dataset.exiting).toBe("true");
  await act(async () => { vi.advanceTimersByTime(2400); });
  expect(screen.queryByText("Long running work")).toBeNull();
  expect(screen.getByText("Failed work")).toBeTruthy();
});
