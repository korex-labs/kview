// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HelmReleaseDrawer from "./HelmReleaseDrawer";

const apiGetMock = vi.hoisted(() => vi.fn());
const apiPostWithContextMock = vi.hoisted(() => vi.fn());

vi.mock("../../../api", () => ({
  apiGet: apiGetMock,
  apiPostWithContext: apiPostWithContextMock,
}));
vi.mock("../../../activeContext", () => ({ useActiveContext: () => "ctx" }));
vi.mock("../../../connectionState", () => ({ useConnectionState: () => ({ retryNonce: 0 }) }));
vi.mock("../../../utils/useResourceSignals", () => ({
  default: () => ({ signals: [], suppressedSignals: [], suppressedSignalCount: 0, loading: false, error: "", retry: vi.fn() }),
}));
vi.mock("../../layout/RightDrawer", () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
}));
vi.mock("../../shared/ResourceDrawerShell", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
vi.mock("../secrets/SecretDrawer", () => ({ default: () => null }));
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
});

describe("HelmReleaseDrawer presence lifecycle", () => {
  it("requests cache presence only after Resource Map opens", async () => {
    apiGetMock.mockResolvedValue({
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
