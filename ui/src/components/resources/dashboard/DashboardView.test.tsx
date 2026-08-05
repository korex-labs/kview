// @vitest-environment jsdom

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        workloadWarnings: 0,
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

function dashboardElement(context = "") {
  return (
    <ActiveContextProvider value={context}>
      <UserSettingsProvider>
        <DashboardView token="test-token" />
      </UserSettingsProvider>
    </ActiveContextProvider>
  );
}

function renderDashboard(context = "") {
  return render(dashboardElement(context));
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
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
  }, 20_000);

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
  }, 20_000);

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
  }, 20_000);
});

describe("DashboardView sections", () => {
  it("loads only the active dashboard endpoint and reuses each tab cache", async () => {
    apiGet.mockResolvedValue(readyDashboardResponse());

    renderDashboard();

    const signalsPanel = document.getElementById("dashboard-panel-signals") as HTMLElement;
    const dataplanePanel = document.getElementById("dashboard-panel-dataplane") as HTMLElement;
    expect(signalsPanel).toBeTruthy();
    expect(dataplanePanel).toBeTruthy();
    expect(signalsPanel.hidden).toBe(false);
    expect(dataplanePanel.hidden).toBe(true);

    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    expect(String(apiGet.mock.calls[0][0])).toContain("/api/dashboard/signals?");
    expect(screen.getByRole("tab", { name: "Signals" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Signals panel")).toBeTruthy();
    expect(dataplanePanel.textContent).not.toContain("Known Resources");
    expect(screen.getByLabelText("Saved view")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Dataplane" }));

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    expect(String(apiGet.mock.calls[1][0])).toBe("/api/dashboard/dataplane");
    expect(screen.getByRole("tab", { name: "Dataplane" }).getAttribute("aria-selected")).toBe("true");
    expect(signalsPanel.hidden).toBe(true);
    expect(dataplanePanel.hidden).toBe(false);
    expect(screen.queryByLabelText("Saved view")).toBeNull();
    expect(screen.getByText("Known Resources")).toBeTruthy();
    expect(screen.getByText("Dataplane Stats")).toBeTruthy();
    expect(localStorage.getItem("kview:dashboardTab:v1")).toBe("dataplane");

    fireEvent.click(screen.getByRole("tab", { name: "Signals" }));

    expect(signalsPanel.hidden).toBe(false);
    expect(dataplanePanel.hidden).toBe(true);
    expect(screen.getByText("Signals panel")).toBeTruthy();
    expect(apiGet).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("does not render inactive-tab data after the context changes", async () => {
    apiGet.mockImplementation((...args: unknown[]) =>
      args.includes("new-context") ? new Promise(() => undefined) : Promise.resolve(readyDashboardResponse()),
    );

    const view = renderDashboard("old-context");
    await waitFor(() => expect(screen.getByText("Signals panel")).toBeTruthy());
    fireEvent.click(screen.getByRole("tab", { name: "Dataplane" }));
    await waitFor(() => expect(screen.getByText("Dataplane Stats")).toBeTruthy());

    view.rerender(dashboardElement("new-context"));
    await waitFor(() => expect(apiGet.mock.calls.some((call) =>
      call[0] === "/api/dashboard/dataplane" && call[2] === "new-context",
    )).toBe(true));
    fireEvent.click(screen.getByRole("tab", { name: "Signals" }));

    expect(screen.queryByText("Signals panel")).toBeNull();
    await waitFor(() => expect(apiGet.mock.calls.some((call) =>
      String(call[0]).startsWith("/api/dashboard/signals?") && call[2] === "new-context",
    )).toBe(true));
  }, 20_000);

  it("joins the original tab request during rapid tab switching", async () => {
    let resolveSignals!: (value: ApiDashboardClusterResponse) => void;
    const signalsPromise = new Promise<ApiDashboardClusterResponse>((resolve) => {
      resolveSignals = resolve;
    });
    apiGet
      .mockImplementationOnce(() => signalsPromise)
      .mockImplementationOnce(() => new Promise(() => undefined));

    renderDashboard();
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("tab", { name: "Dataplane" }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("tab", { name: "Signals" }));

    expect(apiGet).toHaveBeenCalledTimes(2);
    resolveSignals(readyDashboardResponse());
    await waitFor(() => expect(screen.getByText("Signals panel")).toBeTruthy());
    expect(apiGet).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("shows a tab-local error and retries an uncached load", async () => {
    apiGet
      .mockRejectedValueOnce(new Error("unavailable"))
      .mockResolvedValueOnce(readyDashboardResponse());

    renderDashboard();

    expect((await screen.findByRole("alert")).textContent).toContain("Failed to load dashboard signals.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Signals panel")).toBeTruthy());
    expect(apiGet).toHaveBeenCalledTimes(2);
  }, 20_000);

  it("restores the last selected dashboard section", async () => {
    localStorage.setItem("kview:dashboardTab:v1", "dataplane");
    apiGet.mockResolvedValue(readyDashboardResponse());

    renderDashboard();

    await waitFor(() => expect(screen.queryByText("Loading...")).toBeNull());
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(String(apiGet.mock.calls[0][0])).toBe("/api/dashboard/dataplane");
    expect(screen.getByRole("tab", { name: "Dataplane" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Dataplane Stats")).toBeTruthy();
    expect((document.getElementById("dashboard-panel-signals") as HTMLElement).hidden).toBe(true);
    expect((document.getElementById("dashboard-panel-dataplane") as HTMLElement).hidden).toBe(false);
  }, 20_000);

  it("opens Signals when applying a pending dashboard saved view", async () => {
    localStorage.setItem("kview:dashboardTab:v1", "dataplane");
    sessionStorage.setItem("kview:savedResourceView:pending", JSON.stringify({
      id: "pending-signals",
      name: "Pending signals",
      viewType: "dashboard",
      context: "",
      resource: "pods",
      namespace: "",
      filter: "",
      sortModel: [],
      columnVisibilityModel: {},
      columnWidths: {},
      dashboardSnapshot: {
        signalFilter: "severity:high",
        signalFilters: ["severity:high"],
        signalsQuery: "api",
        signalsSort: "last_seen_desc",
        signalsRowsPerPage: 25,
      },
    }));
    apiGet.mockResolvedValue(readyDashboardResponse());

    renderDashboard();

    await waitFor(() => expect(screen.getByRole("tab", { name: "Signals" }).getAttribute("aria-selected")).toBe("true"));
    expect(screen.getByText("Signals panel")).toBeTruthy();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(String(apiGet.mock.calls[0][0])).toContain("/api/dashboard/signals?");
    expect(localStorage.getItem("kview:dashboardTab:v1")).toBe("signals");
    expect(sessionStorage.getItem("kview:savedResourceView:pending")).toBeNull();
  }, 20_000);
});
