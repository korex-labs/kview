// @vitest-environment jsdom

import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ActiveContextProvider } from "../../activeContext";
import { INVESTIGATION_SNAPSHOTS_CHANGED_EVENT } from "../../investigationSnapshots";
import { RESOURCE_MEMORY_STORAGE_KEY } from "../../resourceMemory";
import { ResourceMemoryPanel } from "./ResourceMemory";

afterEach(() => {
  cleanup();
  localStorage.removeItem(RESOURCE_MEMORY_STORAGE_KEY);
  vi.unstubAllGlobals();
});

describe("ResourceMemoryPanel", () => {
  it("saves local resource memory for the active context", () => {
    render(
      <ActiveContextProvider value="kind-dev">
        <ResourceMemoryPanel resource="pods" namespace="app-prod" name="api-7f" />
      </ActiveContextProvider>,
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Operator note/ }), { target: { value: "Crash looping after deploy" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Reference link/ }), { target: { value: "https://runbooks.example/api" } });
    fireEvent.click(screen.getByText("Save notes"));

    const raw = localStorage.getItem(RESOURCE_MEMORY_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(raw).toContain("kind-dev");
    expect(raw).toContain("Crash looping after deploy");
    expect(screen.getByText("Operator notes")).toBeTruthy();
    expect(screen.getAllByText("Watch item").length).toBeGreaterThan(0);
  });

  it("refreshes saved investigations after a snapshot is created", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ active: "kind-dev", items: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        active: "kind-dev",
        items: [{
          id: "snap-1",
          context: "kind-dev",
          title: "Investigation: CrashLoopBackOff on Pod api-7f",
          triageState: "investigating",
          signal: {
            type: "pod_crash_loop_waiting",
            title: "CrashLoopBackOff on Pod api-7f",
            severity: "high",
            category: "workloads",
            observedAt: 900,
          },
          primaryResource: { kind: "Pod", namespace: "app-prod", name: "api-7f" },
          relatedResources: [{ kind: "Deployment", namespace: "app-prod", name: "api" }],
          relatedSignalTypes: ["pod_restart_elevated"],
          markdown: "# Investigation\n\nFull saved evidence bundle.",
          operatorNote: "The pod is repeatedly failing during startup.",
          runbookUrls: ["https://runbooks.example/api"],
          source: "investigate-signal",
          createdAt: 1000,
        }],
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ActiveContextProvider value="kind-dev">
        <ResourceMemoryPanel resource="pods" namespace="app-prod" name="api-7f" token="token" />
      </ActiveContextProvider>,
    );

    expect(await screen.findByText("No saved investigation snapshots for this resource yet.")).toBeTruthy();

    window.dispatchEvent(new Event(INVESTIGATION_SNAPSHOTS_CHANGED_EVENT));

    expect(await screen.findByText("Investigation: CrashLoopBackOff on Pod api-7f")).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "Open snapshot" }));

    const dialog = await screen.findByRole("dialog", { name: /Signal investigation/ });
    expect(within(dialog).getByText("Saved snapshot")).toBeTruthy();
    expect(within(dialog).getAllByText("The pod is repeatedly failing during startup.").length).toBeGreaterThan(0);
    expect(within(dialog).getByText("app-prod/api-7f")).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: /Save snapshot/ })).toBeNull();

    fireEvent.click(within(dialog).getByRole("tab", { name: "Export" }));
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getByText("Full saved evidence bundle.")).toBeTruthy();
  });
});
