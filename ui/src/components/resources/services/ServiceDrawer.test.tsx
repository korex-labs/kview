// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActiveContextProvider } from "../../../activeContext";
import ServiceDrawer from "./ServiceDrawer";
import { UserSettingsProvider } from "../../../settingsContext";

const mocks = vi.hoisted(() => ({
  detail: vi.fn(), ingress: vi.fn(), connection: { health: "healthy", retryNonce: 0 },
}));
vi.mock("../../../connectionState", () => ({ useConnectionState: () => mocks.connection }));
vi.mock("../../../utils/resourceDrawerFetch", () => ({ fetchNamespacedResourceDetailWithWarnings: mocks.detail }));
vi.mock("../../../api", async (original) => ({ ...await original<typeof import("../../../api")>(), apiGetWithContext: mocks.ingress }));
vi.mock("../../../utils/useResourceSignals", () => ({ default: () => ({ signals: [] }) }));
vi.mock("../../layout/RightDrawer", () => ({ useRightDrawerLayout: () => null, default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../pods/PodDrawer", () => ({ default: () => null }));
vi.mock("../ingresses/IngressDrawer", () => ({ default: () => null }));
vi.mock("../namespaces/NamespaceDrawer", () => ({ default: () => null }));
vi.mock("./ServiceActions", () => ({ default: () => null }));
vi.mock("../../shared/ResourceMapPanel", () => ({ default: () => <div>Map panel</div> }));
vi.mock("../../shared/AttentionSummary", () => ({ default: () => null }));
vi.mock("../../shared/ResourceYamlPanel", () => ({ default: ({ onApplied }: { onApplied: () => void }) => <button onClick={onApplied}>Test refresh</button> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function detail(name: string) {
  return { item: { summary: { name, namespace: "fixture-ns", type: "ClusterIP" }, ports: [{ name: `${name}-port`, port: 80 }], endpoints: { ready: 0, notReady: 0 }, traffic: {}, yaml: name }, warningEvents: [], detailSignals: [] };
}
const defaults = { open: true, token: "token", namespace: "fixture-ns", serviceName: "service-a", onClose: () => {} };
function view(overrides: Partial<typeof defaults> = {}, context = "fixture-context") {
  return <ActiveContextProvider value={context}><UserSettingsProvider><ServiceDrawer {...defaults} {...overrides} /></UserSettingsProvider></ActiveContextProvider>;
}
function tab(name: string) { fireEvent.click(screen.getByRole("tab", { name })); }
async function flush() { await act(async () => {}); }

beforeEach(() => {
  mocks.detail.mockReset().mockImplementation(({ name }: { name: string }) => Promise.resolve(detail(name)));
  mocks.ingress.mockReset().mockResolvedValue({ items: [] });
  mocks.connection.health = "healthy";
  mocks.connection.retryNonce = 0;
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("ServiceDrawer request lifecycle", () => {
  it("themes actual generic scroll owners, not clipped shells or auxiliary/code panels", async () => {
    render(view());
    await flush();
    const shell = screen.getByTestId("drawer-services");
    const tabs = shell.querySelector("[data-resource-drawer-tabs]")!;
    for (const label of ["Overview", "Pods", "Metadata"]) {
      await act(async () => tab(label));
      const owners = shell.querySelectorAll(".kview-native-scrollbar");
      expect(owners).toHaveLength(1);
      const owner = owners[0];
      expect(getComputedStyle(owner).overflowY).toBe("auto");
      expect(owner.parentElement).toBe(tabs.nextElementSibling);
      expect(getComputedStyle(owner.parentElement!).overflow).toBe("hidden");
      expect(shell.classList.contains("kview-native-scrollbar")).toBe(false);
    }
    for (const label of ["YAML", "Notes", "Resource Map"]) {
      await act(async () => tab(label));
      expect(shell.querySelector(".kview-native-scrollbar")).toBeNull();
    }
    expect(screen.getByText("Map panel")).toBeTruthy();
    await act(async () => tab("Overview"));
    expect(shell.querySelector(".kview-native-scrollbar")).toBeTruthy();
  });

  it("keeps B details when A completes last and preserves native/auxiliary tabs", async () => {
    const a = deferred<ReturnType<typeof detail>>();
    const b = deferred<ReturnType<typeof detail>>();
    mocks.detail.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { rerender } = render(view());
    const aSignal = mocks.detail.mock.calls[0][0].signal as AbortSignal;
    rerender(view({ serviceName: "service-b" }));
    expect(aSignal.aborted).toBe(true);
    await act(async () => b.resolve(detail("service-b")));
    await act(async () => a.resolve(detail("service-a")));
    expect(screen.queryByText("service-a-port")).toBeNull();
    expect(screen.getByText("service-b-port")).toBeTruthy();
    for (const label of ["Overview", "Pods", "Events", "Metadata", "YAML", "Notes", "Resource Map"]) {
      expect(screen.getByRole("tab", { name: label })).toBeTruthy();
    }
    expect(mocks.ingress).not.toHaveBeenCalled();
  });

  it("does not let old rejection/finally clear B loading; closes, reopens and retries", async () => {
    const a = deferred<ReturnType<typeof detail>>();
    const b = deferred<ReturnType<typeof detail>>();
    mocks.detail.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { rerender } = render(view());
    rerender(view({ serviceName: "service-b" }));
    await act(async () => a.reject(new Error("obsolete-detail")));
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByText(/obsolete-detail/)).toBeNull();
    rerender(view({ open: false, serviceName: "service-b" }));
    expect(mocks.detail.mock.calls[1][0].signal.aborted).toBe(true);
    await act(async () => b.reject(new Error("closed-detail")));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.queryByText(/closed-detail/)).toBeNull();
    mocks.detail.mockRejectedValueOnce(new Error("current-detail-failure"));
    rerender(view({ serviceName: "service-b" }));
    await flush();
    expect(screen.getByText(/current-detail-failure/)).toBeTruthy();
    mocks.connection.retryNonce++;
    rerender(view({ serviceName: "service-b" }));
    await flush();
    expect(screen.getByText("service-b-port")).toBeTruthy();
    expect(mocks.detail).toHaveBeenCalledTimes(4);
  });

  it.each(["success", "failure"])("ignores late ingress %s without ending the new inventory load", async (completion) => {
    const a = deferred<{ items: { name: string; namespace: string }[] }>();
    const b = deferred<{ items: { name: string; namespace: string }[] }>();
    mocks.ingress.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { rerender } = render(view());
    await flush(); tab("Pods");
    const signal = mocks.ingress.mock.calls[0][3].signal as AbortSignal;
    tab("Overview"); tab("Pods");
    expect(mocks.ingress).toHaveBeenCalledTimes(1);
    rerender(view({ serviceName: "service-b" }));
    await flush();
    expect(signal.aborted).toBe(true);
    expect(mocks.ingress).toHaveBeenCalledTimes(1);
    tab("Pods");
    await act(async () => completion === "success" ? a.resolve({ items: [{ name: "obsolete-ingress", namespace: "fixture-ns" }] }) : a.reject(new Error("obsolete-ingress")));
    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.queryByText("obsolete-ingress")).toBeNull();
    await act(async () => b.resolve({ items: [{ name: "current-ingress", namespace: "fixture-ns" }] }));
    expect(screen.getByText("current-ingress")).toBeTruthy();
    tab("Overview"); tab("Pods");
    expect(mocks.ingress).toHaveBeenCalledTimes(2);
    expect(mocks.detail).toHaveBeenCalledTimes(2);
  });

  it("keeps B ingress after inverse completion, invalidates on close and retries a current failure", async () => {
    const a = deferred<{ items: { name: string; namespace: string }[] }>();
    const b = deferred<{ items: { name: string; namespace: string }[] }>();
    const closing = deferred<{ items: [] }>();
    mocks.ingress.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise).mockReturnValueOnce(closing.promise);
    const { rerender } = render(view());
    await flush(); tab("Pods");
    rerender(view({ serviceName: "service-b" }));
    await flush(); tab("Pods");
    await act(async () => b.resolve({ items: [{ name: "b-ingress", namespace: "fixture-ns" }] }));
    await act(async () => a.resolve({ items: [{ name: "a-ingress", namespace: "fixture-ns" }] }));
    expect(screen.getByText("b-ingress")).toBeTruthy();
    expect(screen.queryByText("a-ingress")).toBeNull();
    rerender(view({ serviceName: "service-c" }));
    await flush(); tab("Pods");
    rerender(view({ open: false, serviceName: "service-c" }));
    expect(mocks.ingress.mock.calls[2][3].signal.aborted).toBe(true);
    await act(async () => closing.reject(new Error("closed-ingress")));
    expect(screen.queryByText("closed-ingress")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    mocks.ingress.mockRejectedValueOnce(new Error("current-ingress-failure"));
    rerender(view({ serviceName: "service-c" }));
    await flush();
    expect(mocks.ingress).toHaveBeenCalledTimes(3);
    tab("Pods"); await flush();
    expect(screen.getByText("current-ingress-failure")).toBeTruthy();
    mocks.connection.retryNonce++;
    rerender(view({ serviceName: "service-c" }));
    await flush(); tab("Pods"); await flush();
    expect(screen.queryByText("current-ingress-failure")).toBeNull();
    expect(screen.getByText("No ingresses reference this Service.")).toBeTruthy();
    expect(mocks.ingress).toHaveBeenCalledTimes(5);
  });

  it.each(["context", "token", "namespace", "offline", "refresh", "retry"])("invalidates both requests for %s without eager inventory reads", async (change) => {
    const pending = deferred<{ items: [] }>();
    mocks.ingress.mockReturnValueOnce(pending.promise);
    const { rerender, unmount } = render(view());
    await flush(); tab("Pods");
    const signal = mocks.ingress.mock.calls[0][3].signal as AbortSignal;
    if (change === "offline") mocks.connection.health = "unhealthy";
    if (change === "retry") mocks.connection.retryNonce++;
    if (change === "refresh") { tab("YAML"); fireEvent.click(screen.getByText("Test refresh")); }
    else rerender(view(change === "token" ? { token: "token-b" } : change === "namespace" ? { namespace: "fixture-b" } : {}, change === "context" ? "context-b" : "fixture-context"));
    await flush();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.reject(new Error("old-scope-ingress")));
    expect(screen.queryByText("old-scope-ingress")).toBeNull();
    expect(mocks.ingress).toHaveBeenCalledTimes(1);
    if (change === "offline") {
      expect(mocks.detail).toHaveBeenCalledTimes(1);
      mocks.connection.health = "healthy";
      rerender(view()); await flush();
    }
    expect(mocks.detail).toHaveBeenCalledTimes(2);
    tab("Pods"); await flush();
    expect(mocks.ingress).toHaveBeenCalledTimes(2);
    if (change === "context") {
      expect(mocks.detail.mock.calls[1][0].contextName).toBe("context-b");
      expect(mocks.ingress.mock.calls[1][2]).toBe("context-b");
    }
    const latest = mocks.ingress.mock.calls[1][3].signal as AbortSignal;
    unmount();
    expect(latest.aborted).toBe(true);
  });
});
