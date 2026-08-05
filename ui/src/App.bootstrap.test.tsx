// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  getWithContext: vi.fn(),
  post: vi.fn(),
  setDefaultContext: vi.fn(),
}));

vi.mock("./api", () => ({
  apiGet: apiMocks.get,
  apiGetWithContext: apiMocks.getWithContext,
  apiPost: apiMocks.post,
  setApiDefaultContext: apiMocks.setDefaultContext,
  toApiError: (error: unknown) => error && typeof error === "object"
    ? error
    : { message: String(error) },
}));

vi.mock("./components/Sidebar", () => ({
  default: ({ activeContext, namespace, section }: { activeContext: string; namespace: string; section: string }) => (
    <div data-testid="bootstrap-sidebar">
      {activeContext}|{namespace}|{section}
    </div>
  ),
}));

vi.mock("./components/search/GlobalSearchInput", () => ({
  default: ({ activeContext, namespaces }: { activeContext: string; namespaces: string[] }) => (
    <div data-testid="bootstrap-header">
      {activeContext}|{namespaces.join(",")}
    </div>
  ),
}));

vi.mock("./components/search/DataplaneSearchDrawer", () => ({ default: () => null }));
vi.mock("./components/shared/ConnectionBanner", () => ({ default: () => null }));
vi.mock("./components/activity/ActivityPanel", () => ({ default: () => null }));
vi.mock("./components/resources/pods/PodsTable", () => ({
  default: ({ namespace }: { namespace: string }) => <div data-testid="pods-screen">Pods in {namespace}</div>,
}));
vi.mock("./components/resources/deployments/DeploymentsTable", () => ({
  default: ({ namespace }: { namespace: string }) => (
    <div data-testid="deployments-screen">Deployments in {namespace}</div>
  ),
}));

const contextResponse = (overrides: Record<string, unknown> = {}) => ({
  active: "backend-context",
  contexts: [
    { name: "backend-context" },
    { name: "saved-context" },
  ],
  kubeconfig: {
    files: ["/configs/team.yaml"],
    explicitlySet: true,
    defaultPath: "/home/operator/.kube/config",
  },
  ...overrides,
});

const namespaceResponse = (names: string[]) => ({
  limited: false,
  items: names.map((name) => ({ name, phase: "Active", ageSec: 1, hasUnhealthyConditions: false })),
});

async function flushBootstrap() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function contextSelectCalls() {
  return apiMocks.post.mock.calls.filter(([path]) => path === "/api/context/select");
}

function namespaceCalls() {
  return apiMocks.getWithContext.mock.calls.filter(([path]) => String(path).startsWith("/api/namespaces"));
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/?token=bootstrap-test-token");
  apiMocks.get.mockReset();
  apiMocks.getWithContext.mockReset();
  apiMocks.post.mockReset().mockResolvedValue({});
  apiMocks.setDefaultContext.mockReset();

  apiMocks.get.mockImplementation(async (path: string) => {
    if (path === "/api/contexts") return contextResponse();
    return {};
  });
  apiMocks.getWithContext.mockResolvedValue(namespaceResponse(["default"]));

  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    activeContext: "",
    backend: { ok: true, version: "test" },
    cluster: { ok: true, context: "" },
    checkedAt: "2026-07-30T00:00:00Z",
  }), { status: 200 })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("App bootstrap", () => {
  it("shows no-context kubeconfig diagnostics without selecting a context or requesting namespaces", async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === "/api/contexts") {
        return contextResponse({ active: "", contexts: [] });
      }
      return {};
    });

    render(<App />);

    expect(await screen.findByRole("dialog", { name: "No kube context available" })).toBeTruthy();
    expect(screen.getByText(/No Kubernetes contexts were loaded/)).toBeTruthy();
    expect(screen.getByText("Explicit config path")).toBeTruthy();
    expect(screen.getByText("/home/operator/.kube/config")).toBeTruthy();
    expect(screen.getByText("/configs/team.yaml")).toBeTruthy();
    expect(contextSelectCalls()).toHaveLength(0);
    expect(namespaceCalls()).toHaveLength(0);
  });

  it("restores persisted context, namespace, and section ahead of the backend active context", async () => {
    localStorage.setItem("kview.state.v1", JSON.stringify({
      v: 1,
      activeContext: "saved-context",
      activeNamespace: "saved-namespace",
      activeSection: "deployments",
      favouriteNamespacesByContext: {},
    }));
    apiMocks.getWithContext.mockResolvedValue(namespaceResponse(["other", "saved-namespace"]));

    render(<App />);

    expect((await screen.findByTestId("deployments-screen", {}, { timeout: 5000 })).textContent).toContain("Deployments in saved-namespace");
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("saved-context|saved-namespace|deployments");
    expect(screen.getByTestId("bootstrap-header").textContent).toContain("saved-context|other,saved-namespace");
    expect(apiMocks.post).toHaveBeenCalledWith(
      "/api/context/select",
      "bootstrap-test-token",
      { name: "saved-context" },
    );
    expect(apiMocks.getWithContext).toHaveBeenCalledWith(
      "/api/namespaces?enrichFocus=saved-namespace",
      "bootstrap-test-token",
      "saved-context",
    );

    await waitFor(() => {
      const persisted = JSON.parse(localStorage.getItem("kview.state.v1") || "null");
      expect(persisted).toMatchObject({
        v: 1,
        activeContext: "saved-context",
        activeNamespace: "saved-namespace",
        activeSection: "deployments",
        favouriteNamespacesByContext: {},
        recentNamespacesByContext: { "saved-context": ["saved-namespace"] },
        recentSections: [],
        sidebarCollapsedGroups: {},
      });
    });
  });

  it("keeps startup open while namespace warmup retries empty snapshots and selects the first successful namespace", async () => {
    vi.useFakeTimers();
    const namespaceResponses = [
      namespaceResponse([]),
      namespaceResponse([]),
      namespaceResponse(["warmed-namespace"]),
    ];
    apiMocks.getWithContext.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/namespaces")) return namespaceResponses.shift() || namespaceResponse([]);
      return {};
    });

    render(<App />);
    await flushBootstrap();

    expect(namespaceCalls()).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Starting kview" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(namespaceCalls()).toHaveLength(2);
    expect(screen.getByRole("dialog", { name: "Starting kview" })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(namespaceCalls()).toHaveLength(3);
    await flushBootstrap();
    expect(screen.getByTestId("pods-screen").textContent).toContain("Pods in warmed-namespace");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByRole("dialog", { name: "Starting kview" })).toBeNull();
  });

  it("retries a contexts bootstrap error and clears the old error on a successful no-context response", async () => {
    const startupError = new Error("contexts endpoint unavailable");
    let contextsCalls = 0;
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path !== "/api/contexts") return {};
      contextsCalls += 1;
      if (contextsCalls === 1) throw startupError;
      return contextResponse({ active: "", contexts: [] });
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<App />);

    expect(await screen.findByText("contexts endpoint unavailable")).toBeTruthy();
    expect(screen.getByText(/Startup did not complete/)).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });

    fireEvent.click(retry);

    expect(await screen.findByRole("dialog", { name: "No kube context available" })).toBeTruthy();
    expect(contextsCalls).toBe(2);
    expect(screen.queryByText("contexts endpoint unavailable")).toBeNull();
    expect(screen.getByText(/No Kubernetes contexts were loaded/)).toBeTruthy();
  });
});
