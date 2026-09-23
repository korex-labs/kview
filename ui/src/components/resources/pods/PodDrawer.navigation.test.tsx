// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTerminalSession } from "../../../sessionsApi";
import { apiGet } from "../../../api";
import { ActiveContextProvider } from "../../../activeContext";
import { UserSettingsProvider } from "../../../settingsContext";
import KeyboardProvider from "../../../keyboard/KeyboardProvider";
import { defaultKeyboardSettings } from "../../../settings";
import PodDrawer from "./PodDrawer";

vi.mock("../../../api", async (original) => ({ ...await original<typeof import("../../../api")>(), apiGet: vi.fn() }));
vi.mock("../../../utils/useResourceSignals", () => ({ default: () => [] }));
vi.mock("../../metrics/useMetricsStatus", () => ({ useMetricsStatus: () => null, isMetricsUsable: () => false }));
vi.mock("../../shared/ResourceTags", () => ({ ResourceDrawerTags: () => null }));
vi.mock("../../shared/ResourceMacros", () => ({ ResourceDrawerMacros: () => null }));
vi.mock("../../shared/ResourceDynamicLinks", () => ({ default: () => null }));
vi.mock("../../shared/ResourceIdentityDrawer", () => ({ default: () => null }));
vi.mock("../../shared/ResourceMapPanel", () => ({ default: () => <div>Map content</div> }));
vi.mock("../../shared/CodeBlock", () => ({ default: ({ code }: { code: string }) => <pre>{code}</pre> }));
vi.mock("../../shared/YamlEditDialog", () => ({ default: () => null }));
vi.mock("../../mutations/useResourceCapabilities", () => ({ useResourceCapabilities: () => ({ patch: false }), RBAC_DISABLED_REASON: "Denied" }));
vi.mock("../../mutations/useMutationDialog", () => ({ useMutationDialog: () => ({ open: vi.fn() }) }));
vi.mock("./PodActions", () => ({ default: () => null }));

vi.mock("../../../sessionsApi", () => ({ createTerminalSession: vi.fn().mockResolvedValue("session-test") }));

const details = {
  summary: { uid: "pod-uid", name: "api", namespace: "prod", phase: "Running", ready: "1/1", restarts: 0, maxRestarts: 0 },
  conditions: [], lifecycle: {}, containers: [], resources: { podSecurityContext: {} },
  metadata: { labels: { app: "navigation-fixture" }, annotations: {} },
  yaml: "apiVersion: v1\nkind: Pod\nmetadata:\n  name: api\n",
};

function Harness() {
  return <ActiveContextProvider value="test"><UserSettingsProvider><KeyboardProvider
    settingsOpen={false} keyboardSettings={defaultKeyboardSettings()}
    onFocusGlobalSearch={vi.fn()} onSelectSection={vi.fn()} onOpenSettings={vi.fn()}
  ><PodDrawer open token="test" namespace="prod" podName="api" onClose={vi.fn()} /></KeyboardProvider></UserSettingsProvider></ActiveContextProvider>;
}

afterEach(() => { cleanup(); localStorage.clear(); vi.clearAllMocks(); });

describe("PodDrawer terminal launch", () => {
  it.each([0, 1, 2])("keeps selection only when needed (%s running containers)", async (count) => {
    const containers = Array.from({ length: count }, (_, i) => ({ name: `container-${i}`, state: "Running", ready: true }));
    vi.mocked(apiGet).mockResolvedValue({ item: { ...details, containers: [...containers, { name: "finished", state: "Terminated" }] } });
    await act(async () => { render(<Harness />); });
    const button = screen.getByRole("button", { name: "Terminal" });
    expect((button as HTMLButtonElement).disabled).toBe(count === 0);
    await act(async () => { fireEvent.click(button); });
    if (count === 2) {
      expect(createTerminalSession).not.toHaveBeenCalled();
      expect(screen.getAllByRole("menuitem")).toHaveLength(2);
      await act(async () => { fireEvent.click(screen.getByRole("menuitem", { name: "container-1" })); });
    } else expect(screen.queryByRole("menuitem")).toBeNull();
    if (count) expect(createTerminalSession).toHaveBeenCalledExactlyOnceWith({ namespace: "prod", pod: "api", container: `container-${count - 1}`, title: `api / container-${count - 1}` }, "test");
    else expect(createTerminalSession).not.toHaveBeenCalled();
  });
});

describe("PodDrawer Object navigation", () => {
  it("groups only Metadata/YAML, keeps direct shortcuts from other and auxiliary sections, and preserves YAML permission gating", async () => {
    vi.mocked(apiGet).mockResolvedValue({ item: details });
    await act(async () => { render(<Harness />); });
    const shell = screen.getByTestId("drawer-pods");
    const tabs = within(shell).getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-label") || tab.textContent)).toEqual([
      "Overview", "Containers", "Resources", "Networking", "Events", "Logs", "Object", "Resource Map", "Notes",
    ]);
    expect(screen.queryByRole("button", { name: "YAML" })).toBeNull();
    expect(screen.queryByText(details.yaml)).toBeNull();
    const shortcut = (key: string) => { shell.focus(); fireEvent.keyDown(shell, { key }); };
    shortcut("y");
    expect(screen.getByRole("tab", { name: "Object" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "YAML" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/apiVersion: v1/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Patch" }) as HTMLButtonElement).disabled).toBe(true);
    shortcut("m");
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-pressed")).toBe("true");
    expect(getComputedStyle(screen.getByRole("button", { name: "Details" })).textTransform).toBe("none");
    expect(screen.getByRole("button", { name: "Details" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "YAML" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByText("navigation-fixture")).toBeTruthy();
    expect(screen.queryByText(/apiVersion: v1/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "YAML" }));
    expect(screen.getByText(/apiVersion: v1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Resource Map" }));
    expect(screen.getByText("Map content")).toBeTruthy();
    shortcut("y");
    expect(screen.queryByText("Map content")).toBeNull();
    expect(screen.getByText(/apiVersion: v1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    shortcut("m");
    expect(screen.getByText("navigation-fixture")).toBeTruthy();
    expect(screen.queryByText("Operator notes")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand drawer to full screen" }));
    expect(screen.getByRole("button", { name: "Details" }).getAttribute("aria-pressed")).toBe("true");
    expect(getComputedStyle(screen.getByRole("button", { name: "Details" })).textTransform).toBe("none");
    expect(screen.getByRole("button", { name: "Details" }).querySelector("svg")).toBeTruthy();
    expect(screen.getByRole("button", { name: "YAML" }).querySelector("svg")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore drawer size" }));
    expect(screen.getByRole("tab", { name: "Object" }).getAttribute("aria-selected")).toBe("true");
    // Neither visiting Object nor entering the menu starts networking/events/log reads.
    expect(vi.mocked(apiGet).mock.calls.map(([path]) => path)).toEqual([
      "/api/namespaces/prod/pods/api",
      "/api/investigations/snapshots?kind=pods&namespace=prod&name=api", // Notes, explicitly visited above.
    ]);
  }, 20000);
});
