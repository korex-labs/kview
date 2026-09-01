// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomResourceDrawer, { resolvedCustomResourceNamespace } from "./CustomResourceDrawer";

const apiGetMock = vi.hoisted(() => vi.fn());

vi.mock("../../../api", () => ({
  apiGet: apiGetMock,
  toApiError: (error: { status?: number; message?: string }) => ({ status: error.status, message: error.message || String(error) }),
}));
vi.mock("../../../connectionState", () => ({ useConnectionState: () => ({ retryNonce: 0 }) }));
vi.mock("../../layout/RightDrawer", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../../shared/ResourceDrawerShell", () => ({
  default: ({ children, dynamicLinks }: { children: React.ReactNode; dynamicLinks?: unknown }) => (
    <div data-testid="drawer-shell" data-dynamic-links={JSON.stringify(dynamicLinks)}>{children}</div>
  ),
}));
vi.mock("../../shared/ResourceYamlPanel", () => ({
  default: ({ target }: { target?: unknown }) => <div data-testid="yaml-panel" data-target={JSON.stringify(target)} />,
}));
vi.mock("./CustomResourceActions", () => ({
  default: ({ namespace }: { namespace: string }) => <div data-testid="custom-actions" data-namespace={namespace} />,
}));
vi.mock("../../shared/ResourceTags", () => ({ ResourceDrawerTags: () => null }));
vi.mock("../../shared/ResourceMacros", () => ({ ResourceDrawerMacros: () => null }));
vi.mock("../namespaces/NamespaceDrawer", () => ({ default: () => null }));
vi.mock("./CustomResourceStatusCell", () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("resolvedCustomResourceNamespace", () => {
  it("preserves explicit namespaces and applies defaults only to namespaced CRDs", () => {
    expect(resolvedCustomResourceNamespace({ namespace: "explicit", defaultNamespace: "release" }, "Cluster")).toBe("explicit");
    expect(resolvedCustomResourceNamespace({ namespace: "", defaultNamespace: "release" }, "Namespaced")).toBe("release");
    expect(resolvedCustomResourceNamespace({ namespace: "", defaultNamespace: "release" }, "Cluster")).toBe("");
    expect(resolvedCustomResourceNamespace({ namespace: "", defaultNamespace: "release" }, null)).toBe("");
  });

  it("propagates the resolved namespace to links, actions, detail reads, and YAML targets", async () => {
    apiGetMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/customresources/resolve")) {
        return Promise.resolve({ resource: "certificates", storageVersion: "v1", scope: "Namespaced" });
      }
      return Promise.resolve({
        item: {
          summary: {
            name: "tls",
            namespace: "apps",
            group: "cert-manager.io",
            version: "v1",
            kind: "Certificate",
            ageSec: 10,
            createdAt: 1,
          },
          conditions: [],
          yaml: "apiVersion: cert-manager.io/v1",
        },
      });
    });

    render(
      <CustomResourceDrawer
        open
        onClose={vi.fn()}
        token="token"
        crRef={{
          group: "cert-manager.io",
          version: "v1",
          kind: "Certificate",
          namespace: "",
          defaultNamespace: "apps",
          name: "tls",
          provenance: "helmManifest",
        }}
      />,
    );

    const actions = await screen.findByTestId("custom-actions");
    expect(actions.getAttribute("data-namespace")).toBe("apps");
    expect(apiGetMock).toHaveBeenCalledWith(
      "/api/customresources/cert-manager.io/v1/certificates/tls?namespace=apps",
      "token",
    );

    const dynamicLinks = JSON.parse(screen.getByTestId("drawer-shell").getAttribute("data-dynamic-links") || "{}");
    expect(dynamicLinks).toMatchObject({ namespace: "apps", scope: "namespaced", apiResource: "certificates" });

    fireEvent.click(screen.getByRole("tab", { name: "YAML" }));
    await waitFor(() => expect(screen.getByTestId("yaml-panel")).toBeTruthy());
    const target = JSON.parse(screen.getByTestId("yaml-panel").getAttribute("data-target") || "{}");
    expect(target).toMatchObject({ namespace: "apps", resource: "certificates", name: "tls" });
  });

  it("describes an unresolved manifest reference without claiming the object was deleted", async () => {
    const error = Object.assign(new Error("no CRD found for group example.io and kind Widget"), { status: 404 });
    apiGetMock.mockRejectedValue(error);

    render(
      <CustomResourceDrawer
        open
        onClose={vi.fn()}
        token="token"
        crRef={{ group: "example.io", version: "v1", kind: "Widget", namespace: "apps", name: "demo", provenance: "helmManifest" }}
      />,
    );

    expect(await screen.findByText(/CRD metadata for this manifest reference is not available/i)).toBeTruthy();
    expect(screen.queryByText(/This resource is no longer available/i)).toBeNull();
  });
});
