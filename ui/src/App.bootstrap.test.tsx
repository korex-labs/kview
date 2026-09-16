// @vitest-environment jsdom

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";

const sidebarMode = vi.hoisted(() => ({ real: false, snapshots: [] as Array<{ context: string; namespaces: string[]; limited: boolean }> }));

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
      sidebarMode.snapshots.push({ context: props.activeContext, namespaces: props.namespaces, limited: props.nsLimited });
      if (sidebarMode.real) return <Sidebar {...props} />;
      const { activeContext, namespace, section, onSelectContext, onSelectNamespace, onSelectSection } = props;
      return (
        <div data-testid="bootstrap-sidebar" data-limited={props.nsLimited}>
          {activeContext}|{namespace}|{section}
          <button onClick={() => onSelectContext("saved-context")}>Switch context</button>
          <button onClick={() => onSelectNamespace("operator-choice")}>Choose namespace</button>
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
