// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { dispatchApplySavedResourceView, loadPendingSavedResourceView } from "./savedViews";
import { dispatchApplyFocusedResourceView, loadPendingFocusedResourceView, type FocusedResourceViewIntent } from "./focusedResourceViews";
import type { SavedResourceViewDefinition } from "./settings";
import { loadListTextFilter, loadQuickFilterSelection, saveListTextFilter, saveQuickFilterSelection } from "./state";

const sidebarMode = vi.hoisted(() => ({ real: false, snapshots: [] as Array<{ context: string; namespaces: string[]; limited: boolean; section: string }> }));

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

vi.mock("./components/Sidebar", async (importOriginal) => {
  const { default: Sidebar } = await importOriginal<typeof import("./components/Sidebar")>();
  return {
    default: (props: React.ComponentProps<typeof Sidebar>) => {
      sidebarMode.snapshots.push({ context: props.activeContext, namespaces: props.namespaces, limited: props.nsLimited, section: props.section });
      if (sidebarMode.real) return <Sidebar {...props} />;
      const { activeContext, namespace, section, onSelectContext, onSelectNamespace, onSelectSection } = props;
      return (
        <div data-testid="bootstrap-sidebar" data-limited={props.nsLimited}>
          {activeContext}|{namespace}|{section}
          <button onClick={() => onSelectContext("saved-context")}>Switch context</button>
          <button onClick={() => onSelectNamespace("operator-choice")}>Choose namespace</button>
          <button onClick={props.onOpenNamespaceSelector}>Open namespaces</button>
          <button onClick={() => onSelectSection("deployments")}>Browse deployments</button>
        </div>
      );
    },
  };
});

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

vi.mock("./components/resources/dashboard/DashboardView", () => ({ default: () => <div data-testid="dashboard-screen" /> }));
vi.mock("./components/resources/nodes/NodesTable", () => ({ default: () => <div data-testid="nodes-screen" /> }));

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

async function waitForStartupClose() {
  // Finish the mocked bootstrap promises/React commits before timing the MUI
  // exit transition. Poll DOM removal, not repeated computed accessibility
  // styles while the exiting modal still hides the shell.
  await flushBootstrap();
  await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(screen.queryByRole("dialog")).toBeNull();
}

function contextSelectCalls() {
  return apiMocks.post.mock.calls.filter(([path]) => path === "/api/context/select");
}

function namespaceCalls() {
  return apiMocks.getWithContext.mock.calls.filter(([path]) => String(path).startsWith("/api/namespaces"));
}

beforeEach(() => {
  sidebarMode.real = false;
  sidebarMode.snapshots = [];
  localStorage.clear();
  localStorage.setItem("kview:outreachInvitationDecision:v1", "done");
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

describe("App view navigation", () => {
  function apply(kind: "saved" | "focused", overrides: Partial<FocusedResourceViewIntent> = {}) {
    const intent: FocusedResourceViewIntent = { resource: "deployments", filter: `${kind}-filter`, ...overrides };
    if (kind === "focused") {
      dispatchApplyFocusedResourceView({ ...intent, label: "Exact identity", source: "resource-link" });
    } else {
      dispatchApplySavedResourceView({
        id: "saved-id", name: "Saved resource", context: "", namespace: "", filter: "", ...intent,
        sortModel: [{ field: "name", sort: "desc" }], columnVisibilityModel: { age: false },
        columnWidths: { name: 321 }, createdAt: 1, updatedAt: 2,
      });
    }
  }
  async function start() {
    render(<App />);
    await waitForStartupClose();
    saveListTextFilter("old-filter");
    saveQuickFilterSelection(["old-quick"]);
    sessionStorage.clear();
  }

  it.each(["saved", "focused"] as const)("maps %s resource intent, resets filters and preserves its pending payload", async (kind) => {
    await start();
    const calls = namespaceCalls().length;
    act(() => apply(kind, { context: "backend-context", namespace: "target-namespace" }));
    await flushBootstrap();
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|target-namespace|deployments");
    expect(loadListTextFilter()).toBe(`${kind}-filter`);
    expect(loadQuickFilterSelection()).toEqual([]);
    expect(namespaceCalls()).toHaveLength(calls);
    expect(contextSelectCalls()).toHaveLength(1);
    if (kind === "saved") expect(loadPendingSavedResourceView()).toMatchObject({
      id: "saved-id", filter: "saved-filter", sortModel: [{ field: "name", sort: "desc" }],
      columnVisibilityModel: { age: false }, columnWidths: { name: 321 },
    });
    else expect(loadPendingFocusedResourceView()).toEqual({
      resource: "deployments", filter: "focused-filter", context: "backend-context", namespace: "target-namespace",
      label: "Exact identity", source: "resource-link",
    });
  });

  it.each([
    ["saved", undefined], ["saved", ""], ["focused", undefined], ["focused", ""],
  ] as const)("retains namespace for %s with namespace %s and clears missing text filter", async (kind, namespace) => {
    await start();
    act(() => apply(kind, { namespace, filter: undefined }));
    await flushBootstrap();
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|default|deployments");
    expect(loadListTextFilter()).toBe("");
    expect(loadQuickFilterSelection()).toEqual([]);
    expect(namespaceCalls()).toHaveLength(1);
  });

  it.each(["saved", "focused"] as const)("keeps cluster resource identity and current namespace for %s", async (kind) => {
    await start();
    act(() => apply(kind, { resource: "nodes", namespace: "" }));
    await flushBootstrap();
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|default|nodes");
    expect(screen.getByTestId("nodes-screen")).toBeTruthy();
    expect(namespaceCalls()).toHaveLength(1);
  });

  it.each(["saved", "focused"] as const)("ignores invalid %s sections without resetting filters", async (kind) => {
    await start();
    act(() => apply(kind, { resource: "not-a-section" as FocusedResourceViewIntent["resource"] }));
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|default|pods");
    expect(loadListTextFilter()).toBe("old-filter");
    expect(loadQuickFilterSelection()).toEqual(["old-quick"]);
  });

  it.each([
    ["saved", "explicit", "recent", "configured", "favourite", "explicit"],
    ["focused", "explicit", "recent", "configured", "favourite", "explicit"],
    ["saved", "", "recent", "configured", "favourite", "recent"],
    ["focused", undefined, "recent", "configured", "favourite", "recent"],
    ["saved", "", "", "configured", "favourite", "configured"],
    ["focused", "", "", "configured", "favourite", "configured"],
    ["saved", "", "", "", "favourite", "favourite"],
    ["focused", "", "", "", "favourite", "favourite"],
    ["saved", "", "", "", "", "default"],
    ["focused", undefined, "", "", "", "default"],
  ] as const)("uses %s target namespace precedence (%s/%s/%s/%s)", async (kind, namespace, recent, configured, favourite, expected) => {
    localStorage.setItem("kview.state.v1", JSON.stringify({ v: 1,
      favouriteNamespacesByContext: { "saved-context": [favourite] },
      recentNamespacesByContext: { "saved-context": [recent] },
    }));
    apiMocks.get.mockImplementation(async (path: string) => path === "/api/contexts" ? contextResponse({
      contexts: [{ name: "backend-context" }, { name: "saved-context", namespace: configured }],
    }) : {});
    await start();
    // Hold inventory to observe navigation's preferred namespace, not server fallback.
    apiMocks.getWithContext.mockImplementation(() => new Promise(() => {}));
    act(() => apply(kind, { context: "saved-context", namespace }));
    await flushBootstrap();
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain(`saved-context|${expected}|deployments`);
    expect(contextSelectCalls()).toHaveLength(2);
    expect(contextSelectCalls()[1]).toEqual(["/api/context/select", "bootstrap-test-token", { name: "saved-context" }]);
    expect(namespaceCalls()).toHaveLength(2);
    expect(namespaceCalls()[1][2]).toBe("saved-context");
    expect(namespaceCalls()[1][0]).toContain(`enrichFocus=${expected}`);
    expect(sidebarMode.snapshots.some(({ context, section }) => context === "backend-context" && section === "deployments")).toBe(false);
  });

  it("routes Dashboard saved views without applying resource fields or changing scope", async () => {
    await start();
    const view: SavedResourceViewDefinition = {
      id: "dashboard-id", name: "Dashboard view", viewType: "dashboard", context: "saved-context", namespace: "ignored",
      resource: "pods", filter: "ignored-filter", sortModel: [], columnWidths: {}, columnVisibilityModel: {}, createdAt: 1, updatedAt: 2,
      dashboardSnapshot: { signalFilter: "high", signalFilters: ["warning"], signalsQuery: "signal-query", signalsSort: "severity", signalsRowsPerPage: 25 },
    };
    act(() => dispatchApplySavedResourceView(view));
    await flushBootstrap();
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|default|dashboard");
    expect(screen.getByTestId("dashboard-screen")).toBeTruthy();
    expect(loadListTextFilter()).toBe("old-filter");
    expect(loadQuickFilterSelection()).toEqual(["old-quick"]);
    expect(loadPendingSavedResourceView()).toEqual(view);
    expect(contextSelectCalls()).toHaveLength(1);
    expect(namespaceCalls()).toHaveLength(1);
  });

  it.each(["saved", "focused"] as const)("does not route %s into the old context when selection is pending or denied", async (kind) => {
    await start();
    let reject!: (error: Error) => void;
    apiMocks.post.mockImplementation((path: string) => path === "/api/context/select"
      ? new Promise((_resolve, no) => { reject = no; }) : Promise.resolve({}));
    act(() => apply(kind, { context: "saved-context", namespace: "target-namespace" }));
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|default|pods");
    expect(loadListTextFilter()).toBe("old-filter");
    await act(async () => { reject(new Error("navigation switch denied")); });
    expect(screen.getByText("navigation switch denied")).toBeTruthy();
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|default|pods");
    expect(screen.queryByTestId("deployments-screen")).toBeNull();
    expect(loadQuickFilterSelection()).toEqual(["old-quick"]);
    expect(namespaceCalls()).toHaveLength(1);
    expect(apiMocks.setDefaultContext).not.toHaveBeenCalledWith("saved-context");
  });
});

describe("App outreach readiness", () => {
  it("waits for authenticated context selection, not namespace inventory", async () => {
    localStorage.removeItem("kview:outreachInvitationDecision:v1");
    let select!: () => void;
    apiMocks.post.mockImplementation((path: string) => path === "/api/context/select"
      ? new Promise<void>((resolve) => { select = resolve; }) : Promise.resolve({}));
    apiMocks.getWithContext.mockImplementation(() => new Promise(() => {}));
    render(<App />);
    await flushBootstrap();
    expect(screen.queryByRole("dialog", { name: "Optional updates and statistics" })).toBeNull();
    expect(localStorage.getItem("kview:outreachInvitationDecision:v1")).toBeNull();
    await act(async () => { select(); });
    expect(await screen.findByRole("dialog", { name: "Optional updates and statistics" })).toBeTruthy();
    expect(namespaceCalls().length).toBeGreaterThan(0);
    expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/api/statistics")).toBe(false);
  });

  it.each(["error", "no-context", "no-token"])("never invites during %s startup", async (state) => {
    localStorage.removeItem("kview:outreachInvitationDecision:v1");
    if (state === "no-token") window.history.replaceState({}, "", "/");
    if (state === "error") apiMocks.get.mockRejectedValue(new Error("unauthorized"));
    if (state === "no-context") apiMocks.get.mockResolvedValue(contextResponse({ active: "", contexts: [] }));
    render(<App />);
    await flushBootstrap();
    expect(screen.queryByRole("dialog", { name: "Optional updates and statistics" })).toBeNull();
    expect(localStorage.getItem("kview:outreachInvitationDecision:v1")).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([path]) => path === "/api/statistics")).toBe(false);
  });
});

describe("App bootstrap", () => {
  it("refreshes the real namespace dropdown in test-context without changing the selected namespace", async () => {
    sidebarMode.real = true;
    apiMocks.get.mockImplementation(async (path: string) => path === "/api/contexts"
      ? contextResponse({ active: "test-context", contexts: [{ name: "test-context" }] }) : {});
    apiMocks.getWithContext.mockResolvedValue(namespaceResponse(["default", "deleted-namespace"]));
    render(<App />);
    await waitForStartupClose();
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("test-context|default,deleted-namespace");

    apiMocks.getWithContext.mockResolvedValue(namespaceResponse(["default", "new-team-namespace"]));
    const input = screen.getByRole("combobox", { name: "Namespace" });
    fireEvent.mouseDown(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await waitFor(() => expect(namespaceCalls()).toHaveLength(2));
    expect(namespaceCalls()[1][2]).toBe("test-context");
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("test-context|default,new-team-namespace");
    expect(screen.getByTestId("pods-screen").textContent).toBe("Pods in default");
    fireEvent.change(input, { target: { value: "new-team-namespace" } });
    const option = await screen.findByRole("option", { name: /new-team-namespace/ });
    fireEvent.click(option);
    expect(screen.getByTestId("pods-screen").textContent).toBe("Pods in new-team-namespace");
    expect(contextSelectCalls()).toHaveLength(1);
  });

  it("opens cached real namespace options immediately during one deferred background refresh", async () => {
    sidebarMode.real = true;
    apiMocks.getWithContext.mockResolvedValue(namespaceResponse(["default", "cached-team"]));
    render(<App />);
    await waitForStartupClose();
    const initialCalls = namespaceCalls().length;
    let resolve!: (value: ReturnType<typeof namespaceResponse>) => void;
    apiMocks.getWithContext.mockImplementation(() => new Promise((done) => { resolve = done; }));
    const input = screen.getByRole("combobox", { name: "Namespace" });
    fireEvent.mouseDown(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    // No response or timer advancement: the current inventory is immediately usable.
    expect(screen.getByRole("option", { name: /cached-team/ })).toBeTruthy();
    expect(screen.queryByText(/Loading namespaces and dataplane cache/)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /cached-team/ })).toBeTruthy();
    expect(namespaceCalls().length - initialCalls).toBe(1);
    expect(screen.getByTestId("pods-screen").textContent).toBe("Pods in default");
    await act(async () => { resolve(namespaceResponse(["default", "fresh-team"])); });
    expect(screen.getByRole("option", { name: /fresh-team/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /cached-team/ })).toBeNull();
    expect(namespaceCalls().length - initialCalls).toBe(1);
    expect(screen.queryByText(/Loading namespaces and dataplane cache/)).toBeNull();
  });

  it("keeps options and navigation usable during a refresh and accepts an empty refreshed inventory", async () => {
    render(<App />);
    await waitForStartupClose();
    let resolve!: (value: ReturnType<typeof namespaceResponse>) => void;
    apiMocks.getWithContext.mockImplementation(() => new Promise((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "Open namespaces" }));
    fireEvent.click(screen.getByRole("button", { name: "Open namespaces" }));
    expect(namespaceCalls()).toHaveLength(2);
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|default");
    fireEvent.click(screen.getByRole("button", { name: "Choose namespace" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse deployments" }));
    await act(async () => { resolve(namespaceResponse([])); });
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|");
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|operator-choice|deployments");
    expect(namespaceCalls()).toHaveLength(2);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("retains usable inventory on refresh failure and retries without resetting a missing selected namespace", async () => {
    render(<App />);
    await waitForStartupClose();
    fireEvent.click(screen.getByRole("button", { name: "Choose namespace" }));
    apiMocks.getWithContext.mockRejectedValue(new Error("refresh failed"));
    fireEvent.click(screen.getByRole("button", { name: "Open namespaces" }));
    expect(await screen.findByText("refresh failed")).toBeTruthy();
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|default");
    expect(screen.getByTestId("bootstrap-sidebar").getAttribute("data-limited")).toBe("false");
    apiMocks.getWithContext.mockResolvedValue(namespaceResponse(["new-namespace"]));
    fireEvent.click(screen.getByRole("button", { name: "Retry namespaces" }));
    await waitFor(() => expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|new-namespace"));
    expect(screen.getByTestId("pods-screen").textContent).toBe("Pods in operator-choice");
    expect(screen.queryByText("refresh failed")).toBeNull();
  });

  it.each([false, true])("ignores a stale dropdown refresh %s completion after context switch", async (rejectOld) => {
    render(<App />);
    await waitForStartupClose();
    let resolve!: (value: ReturnType<typeof namespaceResponse>) => void;
    let reject!: (error: Error) => void;
    apiMocks.getWithContext.mockImplementation((_path: string, _token: string, context: string) => context === "saved-context"
      ? Promise.resolve(namespaceResponse(["new-context-namespace"]))
      : new Promise((done, fail) => { resolve = done; reject = fail; }));
    fireEvent.click(screen.getByRole("button", { name: "Open namespaces" }));
    const oldSignal = namespaceCalls()[1][3].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Switch context" }));
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByTestId("bootstrap-header").textContent).toBe("saved-context|new-context-namespace"));
    await act(async () => {
      if (rejectOld) reject(new Error("old-refresh failure"));
      else resolve(namespaceResponse(["old-refresh-namespace"]));
    });
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("saved-context|new-context-namespace");
    expect(screen.queryByText("old-refresh failure")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each(["inventory", "restricted", "error"])("clears previous %s on bootstrap retry into a different context", async (initial) => {
    let rejectNew!: (error: Error) => void;
    apiMocks.getWithContext.mockImplementation((_path: string, _token: string, context: string) => {
      if (context === "replacement-context") return new Promise((_resolve, reject) => { rejectNew = reject; });
      if (initial === "error") return Promise.reject(new Error("old namespace error"));
      return Promise.resolve({ ...namespaceResponse(["old-namespace"]), limited: initial === "restricted" });
    });
    render(<App />);
    await waitForStartupClose();
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    apiMocks.post.mockImplementation(async (path: string, _token: string, body: { name: string }) => {
      if (path === "/api/context/select" && body.name === "saved-context") throw new Error("switch denied");
      return {};
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch context" }));
    expect(await screen.findByText("switch denied")).toBeTruthy();
    apiMocks.get.mockImplementation(async (path: string) => path === "/api/contexts"
      ? contextResponse({ active: "replacement-context", contexts: [{ name: "replacement-context" }] }) : {});
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitForStartupClose();
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("replacement-context|");
    expect(screen.queryByText("old namespace error")).toBeNull();
    expect(screen.getByTestId("bootstrap-sidebar").getAttribute("data-limited")).toBe("false");
    await act(async () => { rejectNew(new Error("replacement namespace error")); });
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("replacement-context|");
    expect(screen.getByText("replacement namespace error")).toBeTruthy();
    const replacementRenders = sidebarMode.snapshots.filter(({ context }) => context === "replacement-context");
    expect(replacementRenders.length).toBeGreaterThan(0);
    for (const snapshot of replacementRenders) {
      expect(snapshot.namespaces).toEqual([]);
      expect(snapshot.limited).toBe(false);
    }
    expect(screen.queryByText("Namespace listing is restricted. Use a known namespace.")).toBeNull();
  });

  it.each(["pending", "error"])("accepts a known namespace via the real Sidebar while inventory is %s", async (state) => {
    sidebarMode.real = true;
    let resolve!: (value: ReturnType<typeof namespaceResponse>) => void;
    apiMocks.getWithContext.mockImplementation(() => state === "error"
      ? Promise.reject(new Error("namespace inventory unavailable"))
      : new Promise((done) => { resolve = done; }));
    render(<App />);
    await waitForStartupClose();
    if (state === "error") expect(await screen.findByText("namespace inventory unavailable")).toBeTruthy();
    const input = screen.getByRole("combobox", { name: "Namespace" });
    fireEvent.change(input, { target: { value: "known-team" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    fireEvent.click(screen.getByTestId("nav-deployments"));
    expect((await screen.findByTestId("deployments-screen")).textContent).toContain("known-team");
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|");
    expect(screen.queryByText("Namespace listing is restricted. Use a known namespace.")).toBeNull();
    if (state === "pending") {
      await act(async () => { resolve(namespaceResponse(["server-choice"])); });
      expect(screen.getByTestId("deployments-screen").textContent).toContain("known-team");
      expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|server-choice");
    }
  });

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
    await waitFor(() => expect(screen.getByTestId("bootstrap-header").textContent).toContain("saved-context|other,saved-namespace"));
    expect(apiMocks.post).toHaveBeenCalledWith(
      "/api/context/select",
      "bootstrap-test-token",
      { name: "saved-context" },
    );
    expect(apiMocks.getWithContext).toHaveBeenCalledWith(
      "/api/namespaces?enrichFocus=saved-namespace",
      "bootstrap-test-token",
      "saved-context",
      { signal: expect.any(AbortSignal) },
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

  it("keeps the shell usable while namespace warmup retries empty snapshots and selects the first successful namespace", async () => {
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
    expect(screen.getByText(/Loading namespaces and dataplane cache in the background/)).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(namespaceCalls()).toHaveLength(2);
    expect(screen.getByText(/Loading namespaces and dataplane cache in the background/)).toBeTruthy();

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

  it("allows navigation before a slow namespace/hydration response and preserves the operator's choices", async () => {
    let resolve!: (value: ReturnType<typeof namespaceResponse>) => void;
    apiMocks.getWithContext.mockImplementation((path: string) => path.startsWith("/api/namespaces")
      ? new Promise((done) => { resolve = done; }) : Promise.resolve({}));
    render(<App />);
    await waitFor(() => expect(namespaceCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText(/Loading namespaces and dataplane cache in the background/)).toBeTruthy();
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|");
    fireEvent.click(screen.getByRole("button", { name: "Choose namespace" }));
    fireEvent.click(screen.getByRole("button", { name: "Browse deployments" }));
    expect((await screen.findByTestId("deployments-screen")).textContent).toContain("operator-choice");
    await act(async () => { resolve(namespaceResponse(["server-choice"])); });
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|operator-choice|deployments");
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|server-choice");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps namespace errors nonmodal and retries only the namespace request", async () => {
    apiMocks.getWithContext.mockImplementation(async (path: string) => {
      if (!path.startsWith("/api/namespaces")) return {};
      throw new Error("namespace hydration unavailable");
    });
    render(<App />);
    expect(await screen.findByText("namespace hydration unavailable")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    apiMocks.getWithContext.mockResolvedValue(namespaceResponse(["recovered"]));
    fireEvent.click(screen.getByRole("button", { name: "Retry namespaces" }));
    await waitFor(() => expect(screen.getByTestId("bootstrap-header").textContent).toContain("recovered"));
    expect(screen.queryByText("namespace hydration unavailable")).toBeNull();
    expect(contextSelectCalls()).toHaveLength(1);
  });

  it.each([false, true])("ignores a stale context namespace %s completion after switching", async (rejectOld) => {
    let resolve!: (value: ReturnType<typeof namespaceResponse>) => void;
    let reject!: (error: Error) => void;
    apiMocks.getWithContext.mockImplementation((path: string, _token: string, context: string) => {
      if (!path.startsWith("/api/namespaces")) return Promise.resolve({});
      if (context === "saved-context") return Promise.resolve(namespaceResponse(["new-namespace"]));
      return new Promise((done, fail) => { resolve = done; reject = fail; });
    });
    render(<App />);
    await waitFor(() => expect(namespaceCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const oldSignal = namespaceCalls()[0][3].signal as AbortSignal;
    fireEvent.click(screen.getByRole("button", { name: "Switch context" }));
    expect(oldSignal.aborted).toBe(true);
    await waitFor(() => expect(screen.getByTestId("bootstrap-header").textContent).toBe("saved-context|new-namespace"));
    await act(async () => {
      if (rejectOld) reject(new Error("old-context failure"));
      else resolve(namespaceResponse(["old-namespace"]));
    });
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("saved-context|new-namespace|pods");
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("saved-context|new-namespace");
    expect(screen.queryByText("old-context failure")).toBeNull();
    expect(contextSelectCalls()).toHaveLength(2);
  });

  it("does not issue more warmup requests after unmount", async () => {
    vi.useFakeTimers();
    apiMocks.getWithContext.mockResolvedValue(namespaceResponse([]));
    const view = render(<App />);
    await flushBootstrap();
    expect(namespaceCalls()).toHaveLength(1);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(namespaceCalls()).toHaveLength(1);
  });

  it("does not release the startup modal while authenticated context selection is pending", async () => {
    let resolve!: (value: object) => void;
    apiMocks.post.mockImplementation((path: string) => path === "/api/context/select"
      ? new Promise((done) => { resolve = done; }) : Promise.resolve({}));
    render(<App />);
    await waitFor(() => expect(contextSelectCalls()).toHaveLength(1));
    expect(screen.getByRole("dialog", { name: "Starting kview" })).toBeTruthy();
    expect(namespaceCalls()).toHaveLength(0);
    await act(async () => { resolve({}); });
    await waitFor(() => expect(namespaceCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it.each([401, 403])("preserves limited namespace behavior on HTTP %s without fabricating inventory", async (status) => {
    apiMocks.getWithContext.mockImplementation(async (path: string) => {
      if (path.startsWith("/api/namespaces")) throw { status, message: "namespace access restricted" };
      return {};
    });
    render(<App />);
    expect(await screen.findByText("Namespace listing is restricted. Use a known namespace.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(namespaceCalls()).toHaveLength(1);
    expect(screen.getByTestId("bootstrap-header").textContent).toBe("backend-context|");
    expect(screen.getByTestId("bootstrap-sidebar").textContent).toContain("backend-context|default|pods");
  });

  it("keeps denied context selection behind the startup guard and never loads namespaces", async () => {
    apiMocks.post.mockImplementation(async (path: string) => {
      if (path === "/api/context/select") throw new Error("context access denied");
      return {};
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<App />);
    expect(await screen.findByText("context access denied")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(namespaceCalls()).toHaveLength(0);
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
