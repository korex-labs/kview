import { describe, expect, it } from "vitest";
import type { DashboardClusterItem, DataplaneExplanationItem, DataplaneListMeta, ResourceMapResponse } from "../../types/api";
import {
  buildDashboardExplanationSurface,
  buildDataplaneExplanationModel,
  buildDataplaneListExplanationSurface,
  buildResourceMapExplanationSurface,
} from "./dataplaneExplanationModel";

const runtime: DataplaneExplanationItem = {
  loaded: true,
  profile: "balanced",
  observers: [
    { kind: "nodes", enabled: true, state: "active" },
    { kind: "namespaces", enabled: true, state: "active" },
  ],
  scheduler: {
    state: "healthy",
    backgroundAdmission: "open",
    consecutiveFailures: 0,
    recentFailures: 0,
    recentSuccesses: 4,
  },
  pressure: { running: 1, queued: 0, maxSlots: 4, lowPriorityQueued: 0, longestQueueWaitMs: 0 },
  namespaceSweep: {
    enabled: true,
    totalNamespaces: 12,
    cachedEnrichmentNamespaces: 12,
    noCachedEnrichmentNamespaces: 0,
    cachedHotNamespaces: 12,
    cachedWarmNamespaces: 0,
    cachedColdNamespaces: 0,
    cachedStaleNamespaces: 0,
    cachedUnknownNamespaces: 0,
    enrichedNamespaces: 12,
    staleNamespaces: 0,
    neverScannedNamespaces: 0,
    systemNamespacesSkipped: 2,
  },
};

function snapshot(meta: DataplaneListMeta) {
  return buildDataplaneExplanationModel(buildDataplaneListExplanationSurface(meta), runtime)
    .sections.find((section) => section.key === "surface:snapshot:0");
}

describe("buildDataplaneExplanationModel", () => {
  it("explains a hot, full, complete surface", () => {
    const section = snapshot({ state: "ok", freshness: "hot", coverage: "full", degradation: "none", completeness: "complete" });
    expect(section?.status).toBe("Ready");
    expect(section?.summary).toContain("Hot snapshot");
    expect(section?.summary).toContain("Full scope");
    expect(section?.summary).toContain("Complete detail");
  });

  it("keeps stale and complete as independent facts", () => {
    const section = snapshot({ state: "ok", freshness: "stale", coverage: "full", degradation: "none", completeness: "complete" });
    expect(section?.status).toBe("Stale");
    expect(section?.summary).toContain("Stale snapshot");
    expect(section?.summary).toContain("Complete detail");
    expect(section?.summary).not.toContain("Unknown detail");
  });

  it("describes partial evidence truthfully", () => {
    const section = snapshot({ freshness: "warm", coverage: "partial", degradation: "none", completeness: "partial" });
    expect(section?.status).toBe("Partial");
    expect(section?.summary).toContain("Partial scope");
    expect(section?.summary).toContain("Partial detail");
  });

  it.each([
    ["denied", "Access limited"],
    ["degraded", "Degraded"],
    ["partial_proxy", "Partial"],
  ])("maps coarse state %s before otherwise healthy quality facts", (state, expectedStatus) => {
    const section = snapshot({ state, freshness: "hot", coverage: "full", degradation: "none", completeness: "complete" });
    expect(section?.status).toBe(expectedStatus);
    expect(section?.status).not.toBe("Ready");
  });

  it.each(["minor", "severe"])("does not call %s degradation ready", (degradation) => {
    const section = snapshot({ state: "ok", freshness: "hot", coverage: "full", degradation, completeness: "complete" });
    expect(section?.status).toBe("Degraded");
    expect(section?.summary).toContain(`${degradation[0].toUpperCase()}${degradation.slice(1)} degradation`);
  });

  it("does not infer health from unknown surface metadata", () => {
    const section = snapshot({ state: "unknown", freshness: "unknown", coverage: "unknown", degradation: "unknown", completeness: "unknown" });
    expect(section?.status).toBe("Unknown");
    expect(section?.summary).toBe("Snapshot quality is unknown.");
  });

  it("marks every runtime section not loaded when runtime is absent", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot", completeness: "complete" }),
      undefined,
    );
    const runtimeSections = model.sections.filter((section) => !section.key.startsWith("surface:"));
    expect(runtimeSections.map((section) => section.status)).toEqual(["Not loaded", "Not loaded", "Not loaded", "Not loaded"]);
    expect(runtimeSections.some((section) => section.status === "Healthy")).toBe(false);
  });

  it("marks every runtime section not loaded when runtime reports loaded false", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot", completeness: "complete" }),
      { loaded: false, profile: "", observers: [] },
    );
    const runtimeSections = model.sections.filter((section) => !section.key.startsWith("surface:"));
    expect(runtimeSections.map((section) => section.status)).toEqual(["Not loaded", "Not loaded", "Not loaded", "Not loaded"]);
    expect(runtimeSections.some((section) => section.status === "Healthy")).toBe(false);
  });

  it("marks runtime sections as loading without contradicting the pending request", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot", completeness: "complete" }),
      undefined,
      { loading: true },
    );
    const runtimeSections = model.sections.filter((section) => !section.key.startsWith("surface:"));
    expect(runtimeSections.map((section) => section.status)).toEqual(["Loading", "Loading", "Loading", "Loading"]);
    expect(model.sections.some((section) => section.status === "Not loaded")).toBe(false);
  });

  it("preserves standalone pressure when scheduler health is absent", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot" }),
      {
        loaded: true,
        profile: "balanced",
        observers: [],
        pressure: { running: 2, queued: 3, maxSlots: 4, lowPriorityQueued: 1, longestQueueWaitMs: 250 },
      },
    );
    const scheduler = model.sections.find((section) => section.key === "runtime:scheduler");
    expect(scheduler?.status).not.toBe("Not loaded");
    expect(scheduler?.summary).toContain("pressure");
    expect(scheduler?.details).toEqual([
      { label: "Running", value: "2/4" },
      { label: "Queued", value: "3" },
      { label: "Low priority queued", value: "1" },
      { label: "Longest queue wait", value: "250 ms" },
    ]);
  });

  it("renders independently present scheduler and namespace sweep blocks", () => {
    const schedulerOnly = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot" }),
      {
        loaded: true,
        profile: "balanced",
        observers: [],
        scheduler: {
          state: "degraded",
          backgroundAdmission: "paused",
          consecutiveFailures: 2,
          recentFailures: 3,
          recentSuccesses: 1,
        },
      },
    );
    expect(schedulerOnly.sections.find((section) => section.key === "runtime:scheduler")?.status).toBe("Degraded");
    expect(schedulerOnly.sections.find((section) => section.key === "runtime:sweep")?.status).toBe("Not loaded");

    const sweepOnly = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot" }),
      {
        loaded: true,
        profile: "balanced",
        observers: [],
        namespaceSweep: {
          enabled: true,
          totalNamespaces: 4,
          cachedEnrichmentNamespaces: 3,
          noCachedEnrichmentNamespaces: 1,
          cachedHotNamespaces: 1,
          cachedWarmNamespaces: 1,
          cachedColdNamespaces: 0,
          cachedStaleNamespaces: 1,
          cachedUnknownNamespaces: 0,
          enrichedNamespaces: 2,
          staleNamespaces: 1,
          neverScannedNamespaces: 1,
          systemNamespacesSkipped: 0,
        },
      },
    );
    expect(sweepOnly.sections.find((section) => section.key === "runtime:scheduler")?.status).toBe("Not loaded");
    expect(sweepOnly.sections.find((section) => section.key === "runtime:sweep")?.status).toBe("Unknown");
  });

  it("describes only the namespace sweep as disabled and preserves its reason", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ state: "ok" }),
      {
        loaded: true,
        profile: "manual",
        observers: [],
        namespaceSweep: {
          enabled: false,
          totalNamespaces: 3,
          cachedEnrichmentNamespaces: 1,
          noCachedEnrichmentNamespaces: 2,
          cachedHotNamespaces: 0,
          cachedWarmNamespaces: 0,
          cachedColdNamespaces: 0,
          cachedStaleNamespaces: 1,
          cachedUnknownNamespaces: 0,
          enrichedNamespaces: 1,
          staleNamespaces: 1,
          neverScannedNamespaces: 1,
          systemNamespacesSkipped: 0,
          pausedReason: "disabled for the manual profile",
        },
      },
    );
    const sweep = model.sections.find((section) => section.key === "runtime:sweep");
    expect(sweep?.summary).toContain("Cached namespace summaries are available for 1 of 3 namespaces (1 stale or unknown).");
    expect(sweep?.summary).toContain("Namespace sweep is disabled");
    expect(sweep?.summary).toContain("disabled for the manual profile");
    expect(sweep?.summary).not.toContain("Namespace enrichment is disabled");
  });

  it.each([
    ["scheduler busy", "Paused"],
    ["hourly sweep budget exhausted", "Paused"],
    ["waiting for namespace snapshot", "Waiting"],
    ["rate limit or connectivity pressure", "Paused"],
    ["background admission paused", "Paused"],
    ["waiting for in-flight idle work", "Waiting"],
    ["eligible when idle", "Available"],
    ["coverage fresh", "Fresh"],
  ])("maps enabled idle sweep reason %s to %s", (pausedReason, expectedStatus) => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot" }),
      {
        loaded: true,
        profile: "balanced",
        observers: [],
        namespaceSweep: {
          enabled: true,
          totalNamespaces: 4,
          cachedEnrichmentNamespaces: 3,
          noCachedEnrichmentNamespaces: 1,
          cachedHotNamespaces: 1,
          cachedWarmNamespaces: 1,
          cachedColdNamespaces: 0,
          cachedStaleNamespaces: 1,
          cachedUnknownNamespaces: 0,
          enrichedNamespaces: 2,
          staleNamespaces: 1,
          neverScannedNamespaces: 1,
          systemNamespacesSkipped: 0,
          pausedReason,
        },
      },
    );
    expect(model.sections.find((section) => section.key === "runtime:sweep")?.status).toBe(expectedStatus);
  });

  it("reserves Running for an in-flight sweep regardless of its pause reason", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot" }),
      {
        loaded: true,
        profile: "balanced",
        observers: [],
        namespaceSweep: {
          enabled: true,
          inFlight: true,
          totalNamespaces: 4,
          cachedEnrichmentNamespaces: 3,
          noCachedEnrichmentNamespaces: 1,
          cachedHotNamespaces: 1,
          cachedWarmNamespaces: 1,
          cachedColdNamespaces: 0,
          cachedStaleNamespaces: 1,
          cachedUnknownNamespaces: 0,
          enrichedNamespaces: 2,
          staleNamespaces: 1,
          neverScannedNamespaces: 1,
          systemNamespacesSkipped: 0,
          pausedReason: "enrichment already running",
        },
      },
    );
    expect(model.sections.find((section) => section.key === "runtime:sweep")?.status).toBe("Running");
  });

  it("distinguishes cached summaries from current-runtime sweep history", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot" }),
      {
        loaded: true,
        profile: "balanced",
        observers: [],
        namespaceSweep: {
          enabled: true,
          inFlight: true,
          totalNamespaces: 555,
          cachedEnrichmentNamespaces: 552,
          noCachedEnrichmentNamespaces: 3,
          cachedHotNamespaces: 500,
          cachedWarmNamespaces: 30,
          cachedColdNamespaces: 15,
          cachedStaleNamespaces: 5,
          cachedUnknownNamespaces: 2,
          enrichedNamespaces: 3,
          staleNamespaces: 1,
          neverScannedNamespaces: 552,
          systemNamespacesSkipped: 0,
          relatedDone: 2,
          enrichTargets: 8,
          pausedReason: "enrichment already running",
        },
      },
    );
    const sweep = model.sections.find((section) => section.key === "runtime:sweep");

    expect(sweep?.status).toBe("Running");
    expect(sweep?.summary).toBe(
      "Cached namespace summaries are available for 552 of 555 namespaces (7 stale or unknown). Current run: 2/8 targets completed.",
    );
    expect(sweep?.summary).not.toContain("3 of 555 namespaces enriched");
    expect(sweep?.summary).not.toContain("enrichment already running");
    expect(sweep?.details).toEqual([
      { label: "Cached summaries", value: "552" },
      { label: "No cached summary", value: "3" },
      { label: "Hot", value: "500" },
      { label: "Warm", value: "30" },
      { label: "Cold", value: "15" },
      { label: "Stale", value: "5" },
      { label: "Unknown", value: "2" },
      { label: "Swept this runtime", value: "3" },
      { label: "Due for re-sweep", value: "1" },
      { label: "No runtime sweep record", value: "552" },
      { label: "System excluded", value: "0" },
    ]);
  });

  it("treats enabled observers with omitted state as unknown, never healthy", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot" }),
      { loaded: true, profile: "balanced", observers: [{ kind: "nodes", enabled: true }] },
    );
    const observers = model.sections.find((section) => section.key === "runtime:observers");
    expect(observers?.status).toBe("Unknown");
    expect(observers?.details).toEqual([{ label: "Nodes", value: "Unknown" }]);
    expect(observers?.status).not.toBe("Healthy");
  });

  it("uses stable section and observer ordering", () => {
    const model = buildDataplaneExplanationModel(
      buildDataplaneListExplanationSurface({ freshness: "hot", coverage: "full", completeness: "complete" }),
      runtime,
    );
    expect(model.sections.map((section) => section.key)).toEqual([
      "runtime:profile",
      "surface:snapshot:0",
      "runtime:observers",
      "runtime:scheduler",
      "runtime:sweep",
    ]);
    expect(model.sections.find((section) => section.key === "runtime:observers")?.details).toEqual([
      { label: "Namespaces", value: "Active" },
      { label: "Nodes", value: "Active" },
    ]);
  });
});

describe("surface-specific explanation adapters", () => {
  it("keeps Dashboard visibility and cached row coverage in their own vocabulary", () => {
    const dashboard = {
      visibility: {
        namespaces: { total: 555, unhealthy: 7, freshness: "stale", coverage: "full", degradation: "minor", completeness: "complete", state: "degraded", observerState: "active" },
        nodes: { total: 12, freshness: "warm", coverage: "full", degradation: "none", completeness: "complete", state: "ok", observerState: "active" },
        namespacesObservedAt: "2026-09-01T12:00:00Z",
        nodesObservedAt: "2026-09-01T12:01:00Z",
        trustNote: "Namespace evidence is stale.",
      },
      coverage: {
        visibleNamespaces: 555,
        listOnlyNamespaces: 3,
        detailEnrichedNamespaces: 3,
        relatedEnrichedNamespaces: 552,
        awaitingRelatedRowProjection: 3,
        enrichmentTargets: 8,
        hasActiveEnrichmentSession: true,
        rowProjectionCachedNamespaces: 552,
        resourceTotalsCompleteness: "partial",
        namespacesInResourceTotals: 552,
        resourceTotalsNote: "Three namespace totals are unavailable.",
      },
    } as Pick<DashboardClusterItem, "visibility" | "coverage">;

    const sections = buildDashboardExplanationSurface(dashboard).sections;
    expect(sections.map((section) => section.label)).toEqual(["Dashboard visibility", "Dashboard coverage"]);
    expect(sections[0].status).toBe("Degraded");
    expect(sections[0].summary).toContain("Namespaces: Degraded, Stale, Complete");
    expect(sections[1].status).toBe("Partial");
    expect(sections[1].summary).toContain("Cached row projections are available for 552 of 555 visible namespaces");
    expect(sections[1].summary).toContain("Resource totals include 552 of 555 visible namespaces");
    expect(sections[1].summary).not.toContain("namespaces enriched");
    expect(sections[1].details).toContainEqual({ label: "Cached related projections", value: "552" });

    const unknownNamespace = buildDashboardExplanationSurface({
      ...dashboard,
      visibility: {
        ...dashboard.visibility,
        namespaces: {
          ...dashboard.visibility.namespaces,
          state: "unknown",
          freshness: "unknown",
          coverage: "unknown",
          degradation: "none",
          completeness: "unknown",
        },
      },
    }).sections[0];
    expect(unknownNamespace.status).toBe("Unknown");
  });

  it("preserves Resource Map family, truncation, and cache evidence separately", () => {
    const map = {
      active: "ctx",
      targetId: "target",
      target: {
        id: "target",
        requested: { group: "apps", version: "v1", resource: "deployments", kind: "Deployment", scope: "namespaced", namespace: "prod", name: "api" },
        identity: { group: "apps", version: "v1", resource: "deployments", kind: "Deployment", scope: "namespaced", namespace: "prod", name: "api" },
        resolved: true,
        availability: "present",
        navigable: true,
      },
      nodes: [], edges: [],
      coverage: {
        coverage: "partial",
        completeness: "partial",
        reasons: ["missing target namespace snapshot: pods/b"],
        families: {
          owner: { coverage: "full", completeness: "complete" },
          selector: { coverage: "partial", completeness: "partial", reasons: ["scan limit"] },
        },
      },
      truncated: true,
      truncationReasons: ["node limit"],
      limits: { depth: 2, maxNodes: 100, maxEdges: 200, maxScanRecords: 50000 },
      cache: { freshness: "stale", snapshotsPresent: 2, snapshotsMissing: 1, scannedRecords: 300, totalNodes: 120, returnedNodes: 100, totalEdges: 240, returnedEdges: 200 },
    } satisfies ResourceMapResponse;

    const sections = buildResourceMapExplanationSurface(map).sections;
    expect(sections.map((section) => section.label)).toEqual(["Relationship projection", "Map cache"]);
    expect(sections[0].status).toBe("Truncated");
    expect(sections[0].summary).toContain("Partial coverage");
    expect(sections[0].details).toContainEqual({ label: "Coverage reasons", value: "missing target namespace snapshot: pods/b" });
    expect(sections[0].details).toContainEqual({ label: "Selector family", value: "Partial coverage / Partial completeness · scan limit" });
    expect(sections[0].details).toContainEqual({ label: "Truncation", value: "node limit" });
    expect(sections[1].status).toBe("Stale");
    expect(sections[1].summary).toContain("2 cached snapshots present and 1 snapshot missing");
    expect(sections[1].details).toContainEqual({ label: "Nodes", value: "100 returned / 120 projected" });
  });
});
