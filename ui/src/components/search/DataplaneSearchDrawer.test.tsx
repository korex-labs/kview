// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ApiDataplaneSearchItem } from "../../types/api";
import DataplaneSearchDrawer from "./DataplaneSearchDrawer";
import { useActiveContext } from "../../activeContext";

vi.mock("../resources/namespaces/NamespaceDrawer", () => ({ default: ({ namespaceName, onNavigate }: { namespaceName: string; onNavigate?: (section: string, namespace: string) => void }) => <button onClick={() => onNavigate?.("pods", namespaceName)}>namespace:{namespaceName}</button> }));
vi.mock("../resources/helm/HelmReleaseDrawer", () => ({ default: ({ namespace, releaseName }: { namespace: string; releaseName: string }) => <div>helm:{namespace}/{releaseName}</div> }));
vi.mock("../shared/ResourceIdentityDrawer", () => ({ default: function Drawer({ identity, destination }: { identity: { resource: string; namespace: string; name: string } | null; destination?: string }) {
  const context = useActiveContext();
  return identity ? <div data-context={context} data-destination={destination}>fixed:{identity.resource}:{identity.namespace}/{identity.name}</div> : null;
} }));

const item = (kind: string, namespace = "prod", name = "api") => ({ kind, namespace, name }) as ApiDataplaneSearchItem;

afterEach(cleanup);

describe("DataplaneSearchDrawer", () => {
  it("passes explicit map intent and exact result context without namespace navigation", () => {
    const onNavigate = vi.fn();
    const view = render(<DataplaneSearchDrawer token="token" item={{ ...item("pods"), cluster: "remote" }} destination="resource-map" onClose={vi.fn()} onNavigate={onNavigate} />);
    const drawer = screen.getByText("fixed:pods:prod/api");
    expect(drawer.getAttribute("data-context")).toBe("remote");
    expect(drawer.getAttribute("data-destination")).toBe("resource-map");
    expect(onNavigate).not.toHaveBeenCalled();
    view.rerender(<DataplaneSearchDrawer token="token" item={{ ...item("namespaces", "", "prod"), cluster: "other" }} destination="resource-map" onClose={vi.fn()} />);
    expect(screen.getByText("fixed:namespaces:/prod").getAttribute("data-context")).toBe("other");
    expect(screen.queryByText("fixed:pods:prod/api")).toBeNull();
  });

  it("renders no drawer for an empty selection", () => {
    const view = render(<DataplaneSearchDrawer token="token" item={null} onClose={vi.fn()} />);
    expect(view.container.textContent).toBe("");
  });

  it("preserves Namespace onNavigate behavior", async () => {
    const onNavigate = vi.fn();
    render(<DataplaneSearchDrawer token="token" item={item("namespaces", "", "prod")} onClose={vi.fn()} onNavigate={onNavigate} />);
    fireEvent.click(await screen.findByRole("button", { name: "namespace:prod" }));
    expect(onNavigate).toHaveBeenCalledWith("pods", "prod");
  });

  it("preserves virtual Helm search drawers without fabricating a map identity", async () => {
    render(<DataplaneSearchDrawer token="token" item={item("helmreleases", "prod", "api")} onClose={vi.fn()} />);
    expect(await screen.findByText("helm:prod/api")).toBeTruthy();
    expect(screen.queryByText(/fixed:/)).toBeNull();
  });

  it("dispatches fixed Kubernetes search results through the shared drawer", () => {
    render(<DataplaneSearchDrawer token="token" item={item("pods", "prod", "api")} onClose={vi.fn()} />);
    expect(screen.getByText("fixed:pods:prod/api")).toBeTruthy();
  });
});
