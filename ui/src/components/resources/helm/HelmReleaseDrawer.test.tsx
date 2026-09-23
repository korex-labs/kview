// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HelmReleaseDrawer from "./HelmReleaseDrawer";
import { UserSettingsProvider } from "../../../settingsContext";

const environment = vi.hoisted(() => ({ context: "ctx", health: "healthy" }));
const apiGetMock = vi.hoisted(() => vi.fn());
const apiPostWithContextMock = vi.hoisted(() => vi.fn());

vi.mock("../../../api", () => ({
  apiGet: apiGetMock,
  apiGetWithContext: apiGetMock,
  apiPostWithContext: apiPostWithContextMock,
}));
vi.mock("../../../activeContext", () => ({ useActiveContext: () => environment.context }));
vi.mock("../../../connectionState", () => ({ useConnectionState: () => ({ retryNonce: 0, health: environment.health }) }));
vi.mock("../../../utils/useResourceSignals", () => ({
  default: () => ({ signals: [], suppressedSignals: [], suppressedSignalCount: 0, loading: false, error: "", retry: vi.fn() }),
}));
vi.mock("../../layout/RightDrawer", () => ({
  useRightDrawerLayout: () => null,
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <UserSettingsProvider><div>{children}</div></UserSettingsProvider> : null,
}));
vi.mock("./HelmReleaseResourceMap", () => ({ default: () => <div data-testid="helm-resource-map" /> }));
vi.mock("./HelmActions", () => ({ HelmReleaseActions: () => null, HelmRollbackActionButton: () => null }));
vi.mock("../../shared/AttentionSummary", () => ({ default: () => null }));

vi.mock("../deployments/DeploymentDrawer", () => ({ default: () => null }));
vi.mock("../statefulsets/StatefulSetDrawer", () => ({ default: () => null }));
vi.mock("../daemonsets/DaemonSetDrawer", () => ({ default: () => null }));
vi.mock("../services/ServiceDrawer", () => ({ default: () => null }));
vi.mock("../ingresses/IngressDrawer", () => ({ default: () => null }));
vi.mock("../configmaps/ConfigMapDrawer", () => ({ default: () => null }));
vi.mock("../secrets/SecretDrawer", () => ({ default: (props: { open: boolean; secretName: string }) => props.open ? <div>Secret destination: {props.secretName}</div> : null }));
vi.mock("../jobs/JobDrawer", () => ({ default: () => null }));
vi.mock("../cronjobs/CronJobDrawer", () => ({ default: () => null }));
vi.mock("../horizontalpodautoscalers/HorizontalPodAutoscalerDrawer", () => ({ default: () => null }));
vi.mock("../persistentvolumeclaims/PersistentVolumeClaimDrawer", () => ({ default: () => null }));
vi.mock("../persistentvolumes/PersistentVolumeDrawer", () => ({ default: () => null }));
vi.mock("../serviceaccounts/ServiceAccountDrawer", () => ({ default: () => null }));
vi.mock("../roles/RoleDrawer", () => ({ default: () => null }));
vi.mock("../rolebindings/RoleBindingDrawer", () => ({ default: () => null }));
vi.mock("../clusterroles/ClusterRoleDrawer", () => ({ default: () => null }));
vi.mock("../clusterrolebindings/ClusterRoleBindingDrawer", () => ({ default: () => null }));
vi.mock("../customresourcedefinitions/CustomResourceDefinitionDrawer", () => ({ default: () => null }));
vi.mock("../customresources/CustomResourceDrawer", () => ({ default: () => null }));
vi.mock("../pods/PodDrawer", () => ({ default: () => null }));
vi.mock("../nodes/NodeDrawer", () => ({ default: () => null }));
vi.mock("../namespaces/NamespaceDrawer", () => ({ default: () => null }));

const manifest = `apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: apps
`;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  environment.context = "ctx"; environment.health = "healthy";
});

describe("HelmReleaseDrawer presence lifecycle", () => {
  it.each(["token", "context", "namespace", "name", "close", "offline"])("guards late details on %s", async (dimension) => {
    let resolve!: (value: unknown) => void;
    apiGetMock.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
    apiGetMock.mockResolvedValue({ active: "ctx", item: { summary: { description: "New details" }, history: [] } });
    const props = { open: true, token: "token", namespace: "apps", releaseName: "release", onClose: vi.fn() };
    const mounted = render(<HelmReleaseDrawer {...props} />);
    expect(apiGetMock.mock.calls[0][2].headers).toEqual({ "X-Kview-Context": "ctx" });
    const signal = apiGetMock.mock.calls[0][2].signal as AbortSignal;
    if (dimension === "context") environment.context = "other";
    if (dimension === "offline") environment.health = "unhealthy";
    mounted.rerender(<HelmReleaseDrawer {...props} token={dimension === "token" ? "other" : props.token} namespace={dimension === "namespace" ? "other" : props.namespace} releaseName={dimension === "name" ? "other" : props.releaseName} open={dimension !== "close"} />);
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ active: "ctx", item: { summary: { description: "STALE details" }, history: [] } }));
    expect(screen.queryByText("STALE details")).toBeNull();
  });

  it("integrates Release Notes, internal Notes and lazy scroll-contained Recovery in one tablist", async () => {
    apiGetMock.mockResolvedValue({ active: "ctx", item: { summary: { description: "Release details" }, notes: "Chart instructions", history: [] } });
    render(<HelmReleaseDrawer open token="token" namespace="apps" releaseName="release" onClose={vi.fn()} />);
    await screen.findByText("Release details");
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    const tabs = within(screen.getByRole("tablist"));
    const recoveryTab = tabs.getByRole("tab", { name: "Recovery" });
    const notesTab = tabs.getByRole("tab", { name: "Notes" });
    const releaseNotesTab = tabs.getByRole("tab", { name: "Release Notes" });
    expect(recoveryTab.getAttribute("data-keyboard-action-id")).toBe("drawer.tab.recovery");
    expect(notesTab.getAttribute("data-keyboard-action-id")).toBe("drawer.tab.notes");
    expect(releaseNotesTab.getAttribute("data-keyboard-action-id")).toBe("drawer.tab.releaseNotes");
    const labels = tabs.getAllByRole("tab").map((tab) => tab.textContent);
    expect(labels.indexOf("Recovery")).toBe(labels.indexOf("History") + 1);
    expect(screen.queryByRole("button", { name: "Preview recovery" })).toBeNull();
    fireEvent.click(releaseNotesTab);
    expect(screen.getByText("Chart instructions")).toBeTruthy();
    fireEvent.click(notesTab);
    expect(screen.queryByText("Chart instructions")).toBeNull();
    fireEvent.click(recoveryTab);
    expect(apiGetMock.mock.calls.filter(([path]) => path.endsWith("/recovery"))).toHaveLength(0);
    const panel = screen.getByRole("tabpanel", { name: "Recovery" });
    expect(getComputedStyle(panel).overflow).toBe("auto");
    expect(getComputedStyle(panel).minHeight).toBe("0px");
    expect(getComputedStyle(panel.parentElement!).overflow).toBe("hidden");
    expect(getComputedStyle(panel.parentElement!).minHeight).toBe("0px");
    expect(within(panel).getByRole("button", { name: "Preview recovery" })).toBeTruthy();
    expect(panel.querySelector("details")).toBeNull();
  });

  it.each(["success", "failure"])("preserves recovery through pending detail refresh and %s after deletion", async (outcome) => {
    const item = { namespace: "apps", release: "release", latest: { revision: 3, status: "pending-rollback", description: "Pending", secretName: "stored-secret", uid: "uid", resourceVersion: "rv" }, previous: { revision: 2, status: "deployed", secretName: "prior" }, eligible: true, confirmation: "delete apps/release revision 3" };
    let resolveDetails!: (value: unknown) => void;
    let rejectDetails!: (reason: Error) => void;
    const pendingDetails = new Promise((resolve, reject) => { resolveDetails = resolve; rejectDetails = reject; });
    let detailReads = 0;
    apiGetMock.mockImplementation((path: string) => {
      if (path.endsWith("/recovery")) return Promise.resolve({ active: "ctx", item });
      if (++detailReads > 1) return pendingDetails;
      return Promise.resolve({ active: "ctx", item: { summary: { description: "Release details" }, history: [], notes: "Chart instructions", values: "before: true" } });
    });
    apiPostWithContextMock.mockImplementation((path: string) => Promise.resolve(path === "/api/capabilities" ? { capabilities: { delete: true } } : { active: "ctx", item: { status: "ok", message: "Deleted history" } }));
    const refresh = vi.fn();
    render(<HelmReleaseDrawer open token="token" namespace="apps" releaseName="release" onClose={vi.fn()} onRefresh={refresh} />);
    await screen.findByText("Release details");
    const recoveryTab = screen.getByRole("tab", { name: "Recovery" });
    fireEvent.click(recoveryTab);
    const panel = screen.getByRole("tabpanel", { name: "Recovery" });
    fireEvent.click(within(panel).getByRole("button", { name: "Preview recovery" }));
    fireEvent.click(await within(panel).findByRole("button", { name: "stored-secret" }));
    expect(screen.getByText("Secret destination: stored-secret")).toBeTruthy();
    const review = within(panel).getByRole("button", { name: "Review history Secret deletion" });
    await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(review);
    const modal = await screen.findByRole("dialog");
    const input = await within(modal).findByRole("textbox");
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: item.confirmation } });
    fireEvent.click(within(modal).getByRole("checkbox"));
    fireEvent.click(within(modal).getByRole("button", { name: "Delete history Secret" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    await screen.findByText("Deleted history");
    await waitFor(() => expect(modal.isConnected).toBe(false));
    expect(screen.getByRole("tabpanel", { name: "Recovery" })).toBe(panel);
    expect(recoveryTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Refreshing release details…")).toBeTruthy();
    await act(async () => {
      if (outcome === "failure") rejectDetails(new Error("Detail refresh failed"));
      else resolveDetails({ active: "ctx", item: { summary: { description: "Refreshed details" }, history: [], notes: "Updated chart instructions" } });
    });
    if (outcome === "failure") expect(screen.getByText(/Detail refresh failed/)).toBeTruthy();
    else expect(screen.queryByRole("tab", { name: "Values" })).toBeNull();
    expect(screen.getByText("Deleted history")).toBeTruthy();
    expect(screen.getByRole("tabpanel", { name: "Recovery" })).toBe(panel);
    expect(recoveryTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(apiGetMock.mock.calls.filter(([path]) => !path.endsWith("/recovery"))).toHaveLength(2);
    expect(apiGetMock.mock.calls.filter(([path]) => path.endsWith("/recovery"))).toHaveLength(3);
  });
  it("requests cache presence only after Resource Map opens", async () => {
    apiGetMock.mockResolvedValue({
      active: "ctx",
      item: {
        summary: { name: "release", namespace: "apps", status: "deployed", revision: 1 },
        history: [],
        manifest,
      },
    });
    apiPostWithContextMock.mockResolvedValue({ active: "ctx", items: [], scannedRecords: 0, truncated: false });

    render(
      <HelmReleaseDrawer
        open
        onClose={vi.fn()}
        token="token"
        namespace="apps"
        releaseName="release"
      />,
    );

    const resourceMapTab = await screen.findByRole("tab", { name: "Resource Map" });
    expect(apiPostWithContextMock).not.toHaveBeenCalled();

    fireEvent.click(resourceMapTab);
    await waitFor(() => expect(apiPostWithContextMock).toHaveBeenCalledTimes(1));
    expect(apiPostWithContextMock).toHaveBeenCalledWith(
      "/api/dataplane/resource-presence",
      "token",
      "ctx",
      {
        identities: [expect.objectContaining({
          group: "",
          version: "v1",
          resource: "services",
          kind: "Service",
          scope: "namespaced",
          namespace: "apps",
          name: "backend",
        })],
      },
    );
    expect(await screen.findByTestId("helm-resource-map")).toBeTruthy();
  });
});
