// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import GlobalSearchInput, { ResourceOption, SnapshotOption } from "./GlobalSearchInput";
import { apiGetWithContext } from "../../api";
import { listInvestigationSnapshots } from "../../investigationSnapshots";

vi.mock("../../api", () => ({
  apiGet: vi.fn(),
  apiGetWithContext: vi.fn(),
  apiPost: vi.fn(),
}));

vi.mock("../../investigationSnapshots", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../investigationSnapshots")>();
  return {
    ...actual,
    listInvestigationSnapshots: vi.fn(),
  };
});

const mockedApiGetWithContext = vi.mocked(apiGetWithContext);
const mockedListInvestigationSnapshots = vi.mocked(listInvestigationSnapshots);

afterEach(() => {
  cleanup();
  mockedApiGetWithContext.mockReset();
  mockedListInvestigationSnapshots.mockReset();
});

describe("GlobalSearchInput", () => {
  it("opens a cached resource when selected with the mouse", async () => {
    const onOpenResource = vi.fn();
    const apiItem = {
      cluster: "kind-dev",
      kind: "pods",
      namespace: "app-prod",
      name: "api-7f",
      healthBucket: "degraded",
      listStatus: "CrashLoopBackOff",
      signalSeverity: "high",
      signalCount: 2,
      needsAttention: true,
      matchReason: "namespace",
    };
    mockedApiGetWithContext.mockResolvedValue({
      active: "kind-dev",
      query: "api",
      limit: 10,
      offset: 0,
      hasMore: false,
      items: [apiItem],
    });
    mockedListInvestigationSnapshots.mockResolvedValue([]);

    render(
      <GlobalSearchInput
        token="token"
        activeContext="kind-dev"
        namespaces={["app-prod"]}
        contexts={["kind-dev"]}
        onSelectSection={vi.fn()}
        onSelectNamespace={vi.fn()}
        onSelectContext={vi.fn()}
        onOpenResource={onOpenResource}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Search or command"));
    fireEvent.change(screen.getByPlaceholderText("Search or command"), { target: { value: "api" } });

    const resultName = await screen.findByText("api-7f");
    fireEvent.mouseDown(resultName);

    await waitFor(() => expect(onOpenResource).toHaveBeenCalledWith(apiItem));
  });

  it("shows saved investigation snapshots and opens their primary resource", async () => {
    const onOpenResource = vi.fn();
    const snapshot = {
      id: "snap-1",
      context: "kind-dev",
      title: "Investigation: CrashLoopBackOff on pods api-7f",
      triageState: "known" as const,
      signal: { type: "pod_crash_loop_waiting", title: "CrashLoopBackOff", severity: "high" },
      primaryResource: { kind: "pods", namespace: "app-prod", name: "api-7f" },
      markdown: "# Investigation",
      operatorNote: "Known deploy regression.",
      source: "investigate-signal",
    };
    mockedApiGetWithContext.mockResolvedValue({ active: "kind-dev", query: "regression", limit: 10, offset: 0, hasMore: false, items: [] });
    mockedListInvestigationSnapshots.mockResolvedValue([snapshot]);

    render(
      <GlobalSearchInput
        token="token"
        activeContext="kind-dev"
        namespaces={["app-prod"]}
        contexts={["kind-dev"]}
        onSelectSection={vi.fn()}
        onSelectNamespace={vi.fn()}
        onSelectContext={vi.fn()}
        onOpenResource={onOpenResource}
        onOpenSettings={vi.fn()}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText("Search or command"));
    fireEvent.change(screen.getByPlaceholderText("Search or command"), { target: { value: "regression" } });

    const resultName = await screen.findByText("Investigation: CrashLoopBackOff on pods api-7f");
    fireEvent.mouseDown(resultName);

    await waitFor(() => expect(onOpenResource).toHaveBeenCalledWith(expect.objectContaining({
      cluster: "kind-dev",
      kind: "pods",
      namespace: "app-prod",
      name: "api-7f",
    })));
  });
});

describe("SnapshotOption", () => {
  it("renders saved investigation snapshot context", () => {
    render(
      <SnapshotOption
        item={{
          matchReason: "note",
          snapshot: {
            id: "snap-1",
            context: "kind-dev",
            title: "Investigation: CrashLoopBackOff on pods api-7f",
            triageState: "known",
            signal: { type: "pod_crash_loop_waiting", severity: "high" },
            primaryResource: { kind: "pods", namespace: "app-prod", name: "api-7f" },
            markdown: "# Investigation",
            operatorNote: "Known deploy regression.",
            source: "investigate-signal",
          },
        }}
      />,
    );

    expect(screen.getByText("Investigation: CrashLoopBackOff on pods api-7f")).toBeTruthy();
    expect(screen.getByText("snapshot")).toBeTruthy();
    expect(screen.getByText("note match")).toBeTruthy();
    expect(screen.getByText("high")).toBeTruthy();
    expect(screen.getByText("known")).toBeTruthy();
    expect(screen.getByText("pods · app-prod/api-7f")).toBeTruthy();
    expect(screen.getByText("Known deploy regression.")).toBeTruthy();
  });
});

describe("ResourceOption", () => {
  it("renders signal and health context for enriched cached search results", () => {
    render(
      <ResourceOption
        item={{
          cluster: "kind-dev",
          kind: "pods",
          namespace: "app-prod",
          name: "api-7f",
          healthBucket: "degraded",
          listStatus: "CrashLoopBackOff",
          signalSeverity: "high",
          signalCount: 2,
          needsAttention: true,
          matchReason: "namespace",
        }}
      />,
    );

    expect(screen.getByText("api-7f")).toBeTruthy();
    expect(screen.getByText("Pods")).toBeTruthy();
    expect(screen.getByText("namespace match")).toBeTruthy();
    expect(screen.getByText("ns: app-prod")).toBeTruthy();
    expect(screen.getByText("2 signals")).toBeTruthy();
    expect(screen.getByText("degraded")).toBeTruthy();
    expect(screen.getByText("CrashLoopBackOff")).toBeTruthy();
    expect(screen.getByText(/Pods · kind-dev \/ app-prod/)).toBeTruthy();
  });

  it("shows an attention chip when a result needs attention without a signal count", () => {
    render(
      <ResourceOption
        item={{
          cluster: "kind-dev",
          kind: "deployments",
          namespace: "app-prod",
          name: "api",
          needsAttention: true,
          signalSeverity: "medium",
        }}
      />,
    );

    expect(screen.getByText("attention")).toBeTruthy();
    expect(screen.getByText("Deployments")).toBeTruthy();
    expect(screen.getByText("cached match")).toBeTruthy();
  });
});
