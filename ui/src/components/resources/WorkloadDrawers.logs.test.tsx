// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiGet } from "../../api";
import { ActiveContextProvider } from "../../activeContext";
import { UserSettingsProvider } from "../../settingsContext";
import { defaultUserSettings, saveUserSettings } from "../../settings";
import { fetchNamespacedResourceDetailWithWarnings } from "../../utils/resourceDrawerFetch";
import DeploymentDrawer from "./deployments/DeploymentDrawer";
import StatefulSetDrawer from "./statefulsets/StatefulSetDrawer";
import DaemonSetDrawer from "./daemonsets/DaemonSetDrawer";
import ReplicaSetDrawer from "./replicasets/ReplicaSetDrawer";
import JobDrawer from "./jobs/JobDrawer";

vi.mock("../../utils/resourceDrawerFetch", async (original) => ({ ...await original<typeof import("../../utils/resourceDrawerFetch")>(), fetchNamespacedResourceDetailWithWarnings: vi.fn() }));
vi.mock("../../utils/useResourceSignals", () => ({ default: () => ({ signals: [] }) }));
vi.mock("../metrics/useMetricsStatus", () => ({ useMetricsStatus: () => null, isMetricsUsable: () => false }));
vi.mock("../../api", async (original) => ({ ...await original<typeof import("../../api")>(), apiGet: vi.fn().mockResolvedValue({}) }));
vi.mock("../mutations/useResourceCapabilities", () => ({ useResourceCapabilities: () => ({ patch: false }), RBAC_DISABLED_REASON: "Denied" }));
vi.mock("../mutations/useMutationDialog", () => ({ useMutationDialog: () => ({ open: vi.fn() }) }));
vi.mock("../shared/ResourceTags", () => ({ ResourceDrawerTags: () => null }));
vi.mock("../shared/ResourceMacros", () => ({ ResourceDrawerMacros: () => null }));
vi.mock("../shared/ResourceDynamicLinks", () => ({ default: () => null }));
vi.mock("../shared/ResourceIdentityDrawer", () => ({ default: () => null }));
vi.mock("../shared/YamlEditDialog", () => ({ default: () => null }));
vi.mock("./deployments/DeploymentActions", () => ({ default: () => null }));
vi.mock("./statefulsets/StatefulSetActions", () => ({ default: () => null }));
vi.mock("./daemonsets/DaemonSetActions", () => ({ default: () => null }));
vi.mock("./replicasets/ReplicaSetActions", () => ({ default: () => null }));
vi.mock("./jobs/JobActions", () => ({ default: () => null }));
vi.mock("./pods/PodActions", () => ({ default: () => null }));
class Socket {
  static instances: Socket[] = [];
  close = vi.fn();
  constructor(readonly url: string) { Socket.instances.push(this); }
}
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.mocked(apiGet).mockResolvedValue({ item: {
    summary: { uid: "fixture-pod-uid", name: "sample-pod", namespace: "fixture", phase: "Running" },
    containers: [{ name: "main", state: "Running" }], conditions: [], lifecycle: {}, resources: {},
  } });
});

const common = { open: true, token: "fixture-token", namespace: "fixture", onClose: vi.fn() };
const cases = [
  ["Deployment", <DeploymentDrawer {...common} deploymentName="sample" />],
  ["StatefulSet", <StatefulSetDrawer {...common} statefulSetName="sample" />],
  ["DaemonSet", <DaemonSetDrawer {...common} daemonSetName="sample" />],
  ["ReplicaSet", <ReplicaSetDrawer {...common} replicaSetName="sample" />],
  ["Job", <JobDrawer {...common} jobName="sample" />],
] as const;
function Harness({ children, context = "fixture-a" }: { children: React.ReactNode; context?: string }) {
  return <ActiveContextProvider value={context}><UserSettingsProvider>{children}</UserSettingsProvider></ActiveContextProvider>;
}
afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it.each(cases)("%s opens Logs for the selected related Pod without triggering its Overview row action", async (_, drawer) => {
  vi.mocked(fetchNamespacedResourceDetailWithWarnings).mockResolvedValue({
    item: { summary: { name: "sample", namespace: "fixture" }, conditions: [], spec: {},
      pods: [{ name: "sample-pod", phase: "Succeeded", ready: "0/1", restarts: 0, ageSec: 5 }] },
    detailSignals: [], warningEvents: [],
  });
  saveUserSettings({ ...defaultUserSettings(), logs: { lines: 500, pretty: false, wrap: false } });
  const view = await act(async () => render(<Harness>{drawer}</Harness>));

  fireEvent.click(screen.getByRole("tab", { name: "Pods" }));
  const row = screen.getByText("sample-pod").closest("tr")!;
  const logs = within(row).getByRole("button", { name: "Logs" });
  expect(logs.textContent).toBe("");
  expect(logs.querySelector("svg")).not.toBeNull();
  expect(getComputedStyle(logs).height).toBe("24px");
  expect(getComputedStyle(logs).width).toBe("24px");
  expect(logs.parentElement?.getAttribute("aria-label")).toBe("Open Pod logs");
  await act(async () => fireEvent.click(logs));
  expect(Socket.instances).toHaveLength(1);
  expect(Object.fromEntries(new URL(Socket.instances[0].url).searchParams)).toMatchObject({
    context: "fixture-a", uid: "fixture-pod-uid", tail: "500", follow: "1", previous: "0",
  });
  for (const name of ["Pretty JSON", "Wrap"]) {
    expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("false");
  }
  fireEvent.click(screen.getByRole("button", { name: "History" }));
  expect(Socket.instances[0].close).toHaveBeenCalledOnce();
  expect(Object.fromEntries(new URL(Socket.instances[1].url).searchParams)).toMatchObject({ follow: "0", previous: "1" });
  await act(async () => view.rerender(<Harness context="fixture-b">{drawer}</Harness>));
  expect(Socket.instances[1].close).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "History" })).toBeNull();
  expect(fetchNamespacedResourceDetailWithWarnings).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("tab", { name: "Pods" }));
  await act(async () => fireEvent.click(screen.getByText("sample-pod").closest("tr")!));
  expect(Socket.instances).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "History" })).toBeNull();
});
