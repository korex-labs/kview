// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ApiDataplaneSearchItem } from "../../types/api";
import DataplaneSearchDrawer from "./DataplaneSearchDrawer";

vi.mock("../resources/namespaces/NamespaceDrawer", () => ({ default: ({ namespaceName, onNavigate }: { namespaceName: string; onNavigate?: (section: string, namespace: string) => void }) => <button onClick={() => onNavigate?.("pods", namespaceName)}>namespace:{namespaceName}</button> }));
vi.mock("../resources/helm/HelmReleaseDrawer", () => ({ default: ({ namespace, releaseName }: { namespace: string; releaseName: string }) => <div>helm:{namespace}/{releaseName}</div> }));
vi.mock("../shared/ResourceIdentityDrawer", () => ({ default: ({ identity }: { identity: { resource: string; namespace: string; name: string } | null }) => identity ? <div>fixed:{identity.resource}:{identity.namespace}/{identity.name}</div> : null }));

const item = (kind: string, namespace = "prod", name = "api") => ({ kind, namespace, name }) as ApiDataplaneSearchItem;

afterEach(cleanup);

describe("DataplaneSearchDrawer", () => {
  it("preserves Namespace onNavigate behavior", () => {
    const onNavigate = vi.fn();
    render(<DataplaneSearchDrawer token="token" item={item("namespaces", "", "prod")} onClose={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "namespace:prod" }));
    expect(onNavigate).toHaveBeenCalledWith("pods", "prod");
  });

  it("preserves virtual Helm search drawers without fabricating a map identity", () => {
    render(<DataplaneSearchDrawer token="token" item={item("helmreleases", "prod", "api")} onClose={vi.fn()} />);
    expect(screen.getByText("helm:prod/api")).toBeTruthy();
    expect(screen.queryByText(/fixed:/)).toBeNull();
  });

  it("dispatches fixed Kubernetes search results through the shared drawer", () => {
    render(<DataplaneSearchDrawer token="token" item={item("pods", "prod", "api")} onClose={vi.fn()} />);
    expect(screen.getByText("fixed:pods:prod/api")).toBeTruthy();
  });
});
