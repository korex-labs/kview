// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ResourceIdentityDrawer from "./ResourceIdentityDrawer";

vi.mock("../resources/pods/PodDrawer", () => ({ default: ({ namespace, podName, token }: { namespace: string; podName: string; token: string }) => <div>pod:{namespace}/{podName}:{token}</div> }));
vi.mock("../resources/customresources/CustomResourceDrawer", () => ({ default: ({ crRef }: { crRef: { group: string; resource: string; name: string } }) => <div>custom:{crRef.group}/{crRef.resource}/{crRef.name}</div> }));

afterEach(cleanup);

describe("ResourceIdentityDrawer lazy dispatch", () => {
  it("renders a fixed related-resource drawer with canonical props", async () => {
    render(<ResourceIdentityDrawer token="token" identity={{ group: "", version: "v1", resource: "pods", kind: "Pod", scope: "namespaced", namespace: "prod", name: "api" }} onClose={vi.fn()} />);
    expect(await screen.findByText("pod:prod/api:token")).toBeTruthy();
  });

  it("renders a dynamic drawer only from an authoritative complete identity", async () => {
    render(<ResourceIdentityDrawer token="token" identity={{ group: "cert-manager.io", version: "v1", resource: "certificates", kind: "Certificate", scope: "namespaced", namespace: "prod", name: "api" }} onClose={vi.fn()} />);
    expect(await screen.findByText("custom:cert-manager.io/certificates/api")).toBeTruthy();
  });
});
