// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiResourceIdentity, ResourceMapResponse } from "../../../types/api";
import HelmReleaseResourceMap from "./HelmReleaseResourceMap";

vi.mock("../../shared/ResourceMapPanel", () => ({
  ResourceMapView: ({
    response,
    onOpenResource,
    canOpenResource,
  }: {
    response: ResourceMapResponse;
    onOpenResource: (identity: ApiResourceIdentity) => void;
    canOpenResource: (identity: ApiResourceIdentity) => boolean;
  }) => (
    <div data-testid="resource-map-view">
      {response.nodes.slice(1).map((node) => (
        <button
          key={node.id}
          disabled={!canOpenResource(node.identity)}
          onClick={() => onOpenResource(node.identity)}
        >
          {node.identity.kind}/{node.identity.name}
        </button>
      ))}
    </div>
  ),
}));

afterEach(cleanup);

describe("HelmReleaseResourceMap", () => {
  it("renders manifest semantics and dispatches selectable resources", () => {
    const onOpenResource = vi.fn();
    const certificate = { apiVersion: "cert-manager.io/v1", kind: "Certificate", name: "tls", namespace: "apps" };
    render(
      <HelmReleaseResourceMap
        releaseName="backend"
        releaseNamespace="apps"
        manifestResources={[
          { apiVersion: "v1", kind: "Service", name: "backend" },
          certificate,
          { apiVersion: "policy/v1", kind: "PodDisruptionBudget", name: "backend" },
        ]}
        onOpenResource={onOpenResource}
      />,
    );

    expect(screen.getByText(/Rendered Helm declarations plus cached workload ownership/)).toBeTruthy();
    expect(screen.getByText("3 declarations shown")).toBeTruthy();
    const owner = screen.getByTestId("resource-map-view").closest(".kview-native-scrollbar")!;
    expect(owner).not.toBeNull();
    expect(getComputedStyle(owner).overflow).toBe("auto");
    expect(owner.querySelector(".kview-native-scrollbar")).toBeNull();
    expect((screen.getByRole("button", { name: "Service/backend" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Certificate/tls" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "PodDisruptionBudget/backend" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Certificate/tls" }));
    expect(onOpenResource).toHaveBeenCalledTimes(1);
    expect(onOpenResource).toHaveBeenCalledWith(certificate);
  });
});
