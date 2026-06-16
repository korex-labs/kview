// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DashboardView from "./DashboardView";
import { ActiveContextProvider } from "../../../activeContext";
import { notifyStatus } from "../../../connectionState";
import { UserSettingsProvider } from "../../../settingsContext";
import type { ApiDashboardClusterResponse } from "../../../types/api";

const apiGet = vi.fn();

vi.mock("../../../api", () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
  apiGetWithContext: (...args: unknown[]) => apiGet(...args),
  apiPost: (...args: unknown[]) => apiGet(...args),
}));

vi.mock("./DashboardSignalsPanel", () => ({
  default: (props: {
    signalFilter: string;
    signalFilters: string[];
    signalsQuery: string;
    signalsSort: string;
    signalsRowsPerPage: number;
  }) => (
    <div>
      Signals panel
      <span data-testid="dashboard-signal-state">
        {JSON.stringify({
          signalFilter: props.signalFilter,
          signalFilters: props.signalFilters,
          signalsQuery: props.signalsQuery,
          signalsSort: props.signalsSort,
          signalsRowsPerPage: props.signalsRowsPerPage,
        })}
      </span>
    </div>
  ),
}));

function dashboardResponse(): ApiDashboardClusterResponse {
  return {
    item: {
      plane: {
        profile: "balanced",
        discoveryMode: "auto",
        activationMode: "auto",
        profilesImplemented: [],
        discoveryImplemented: [],
        scope: { namespaces: "all", resourceKinds: "core" },
      },
      visibility: {
        namespaces: {
          total: 1,
          unhealthy: 0,
          freshness: "unknown",
          coverage: "unknown",
          degradation: "none",
          completeness: "unknown",
          state: "empty",
          observerState: "starting",
        },
        nodes: {
          total: 0,
          freshness: "unknown",
          coverage: "unknown",
          degradation: "none",
          completeness: "unknown",
          state: "empty",
          observerState: "not_loaded",
        },
      },
      coverage: {
        visibleNamespaces: 1,
        listOnlyNamespaces: 1,
        detailEnrichedNamespaces: 0,
        relatedEnrichedNamespaces: 0,
        awaitingRelatedRowProjection: 0,
        rowProjectionCachedNamespaces: 0,
        resourceTotalsCompleteness: "unknown",
        namespacesInResourceTotals: 0,
      },
      resources: {
        pods: 0,
        deployments: 0,
        daemonSets: 0,
        statefulSets: 0,
        replicaSets: 0,
        jobs: 0,
        cronJobs: 0,
        horizontalPodAutoscalers: 0,
        services: 0,
        ingresses: 0,
        persistentVolumeClaims: 0,
        configMaps: 0,
        secrets: 0,
        serviceAccounts: 0,
        roles: 0,
        roleBindings: 0,
        helmReleases: 0,
        customResources: 0,
        resourceQuotas: 0,
        limitRanges: 0,
        totalNamespaces: 1,
      },
      signals: {
        total: 0,
        high: 0,
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
        serviceWarnings: 0,
        ingressWarnings: 0,
        pvcWarnings: 0,
        roleWarnings: 0,
        roleBindingWarnings: 0,
        hpaWarnings: 0,
        containerNearLimit: 0,
        nodeResourcePressure: 0,
        itemsTotal: 0,
        itemsOffset: 0,
        itemsLimit: 10,
      },
      derived: {
        nodes: {
          meta: {
            source: "cache",
            coverage: "unknown",
            completeness: "unknown",
            namespacesScope: 1,
          },
          total: 0,
          pods: 0,
          elevatedRestartPods: 0,
          problematicPods: 0,
        },
        helmCharts: {
          meta: {
            source: "cache",
            coverage: "unknown",
            completeness: "unknown",
            namespacesScope: 1,
          },
          total: 0,
        },
      },
      dataplane: {
        uptimeSec: 0,
        requests: { total: 0, freshHits: 0, misses: 0, fetches: 0, errors: 0, hitRatio: 0, fetchRatio: 0 },
        traffic: {
          requestsPerMin: 0,
          liveBytesPerMin: 0,
          avgBytesPerFetch: 0,
          hydratedBytes: 0,
          liveBytes: 0,
        },
        cache: { currentBytes: 0, snapshotsStored: 0, avgBytesPerSnapshot: 0 },
        execution: { runs: 0, avgRunMs: 0, maxRunMs: 0, preemptions: 0 },
        sources: [],
      },
    },
  };
}

function readyDashboardResponse(): ApiDashboardClusterResponse {
  const res = dashboardResponse();
  if (res.item) {
    res.item.visibility.namespaces.state = "ready";
    res.item.visibility.namespaces.observerState = "ready";
    res.item.coverage.resourceTotalsCompleteness = "complete";
    res.item.coverage.namespacesInResourceTotals = 1;
    res.item.resources.pods = 1;
  }
  return res;
}

function coldContextSwitchDashboardResponse(): ApiDashboardClusterResponse {
  const res = dashboardResponse();
  if (res.item) {
    res.item.visibility.namespaces.total = 0;
    res.item.visibility.namespaces.observerState = "ready";
    res.item.coverage.visibleNamespaces = 0;
    res.item.coverage.listOnlyNamespaces = 0;
    res.item.resources.totalNamespaces = 0;
  }
  return res;
}

function renderDashboard() {
  render(
    <ActiveContextProvider value="">
      <UserSettingsProvider>
        <DashboardView token="test-token" />
      </UserSettingsProvider>
    </ActiveContextProvider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  apiGet.mockReset();
  notifyStatus({
    ok: true,
    activeContext: "",
    backend: { ok: true },
    cluster: { ok: true, context: "" },
    checkedAt: new Date(0).toISOString(),
  });
});

describe("DashboardView warmup loading", () => {
  it("applies the active signal view before the first dashboard render", async () => {
    localStorage.setItem("kview:dashboardSignalViewProfiles:v1", JSON.stringify({
      activeProfileId: "prod",
      definitions: [
        {
          id: "prod",
          name: "Prod",
          snapshot: {
            signalFilter: "severity:high",
            signalFilters: ["severity:high"],
            signalsQuery: "api",
            signalsSort: "last_seen_desc",
            signalsRowsPerPage: 25,
          },
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    }));
    apiGet.mockResolvedValueOnce(readyDashboardResponse());

    renderDashboard();

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    expect(String(apiGet.mock.calls[0][0])).toContain("signalsFilter=severity%3Ahigh");
    expect(String(apiGet.mock.calls[0][0])).toContain("signalsQ=api");
    expect(String(apiGet.mock.calls[0][0])).toContain("signalsSort=last_seen_desc");
    expect(String(apiGet.mock.calls[0][0])).toContain("signalsLimit=25");
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    expect(screen.queryByText("Modified")).toBeNull();
    expect(JSON.parse(screen.getByTestId("dashboard-signal-state").textContent || "{}")).toEqual({
      signalFilter: "severity:high",
      signalFilters: ["severity:high"],
      signalsQuery: "api",
      signalsSort: "last_seen_desc",
      signalsRowsPerPage: 25,
    });
  });

  it("clears startup loading after deferred warmup retries commit data", async () => {
    apiGet
      .mockResolvedValueOnce(dashboardResponse())
      .mockResolvedValueOnce(dashboardResponse())
      .mockResolvedValueOnce(readyDashboardResponse());

    renderDashboard();

    expect(screen.getByText("Loading...")).toBeTruthy();
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2), { timeout: 4_000 });

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(3), { timeout: 4_000 });

    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    expect(screen.getByText("Signals panel")).toBeTruthy();
  }, 10_000);

  it("keeps loading for cold all-zero context switch responses", async () => {
    apiGet
      .mockResolvedValueOnce(coldContextSwitchDashboardResponse())
      .mockResolvedValueOnce(readyDashboardResponse());

    renderDashboard();

    expect(screen.getByText("Loading...")).toBeTruthy();
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Signals panel")).toBeNull();

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2), { timeout: 4_000 });
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    expect(screen.getByText("Signals panel")).toBeTruthy();
  }, 10_000);
});
