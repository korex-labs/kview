// @vitest-environment jsdom
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActiveContextProvider, useActiveContext } from "../../activeContext";
import { UserSettingsProvider } from "../../settingsContext";
import FocusedResourceMapDrawer from "./FocusedResourceMapDrawer";
import type { ApiResourceIdentity } from "../../types/api";

vi.mock("./ResourceMapPanel", () => ({ default: function Map({ identity, onOpenResource }: { identity: ApiResourceIdentity; onOpenResource: (identity: ApiResourceIdentity) => void }) {
  const context = useActiveContext();
  return <div data-testid="map" data-context={context}>{identity.namespace}/{identity.name}<button onClick={() => onOpenResource({ ...identity, name: "child" })}>Open related</button></div>;
} }));
vi.mock("./ResourceIdentityDrawer", () => ({ default: ({ identity }: { identity: ApiResourceIdentity | null }) => identity ? <div data-testid="child">{identity.name}</div> : null }));
afterEach(() => { cleanup(); localStorage.clear(); });

it("starts with the cached map and resets linked ownership across exact context changes", () => {
  const identity: ApiResourceIdentity = { group: "", version: "v1", resource: "pods", kind: "Pod", scope: "namespaced", namespace: "prod", name: "api" };
  const viewFor = (context: string) => <ActiveContextProvider value={context}><UserSettingsProvider><FocusedResourceMapDrawer token="token" identity={identity} open onClose={vi.fn()} /></UserSettingsProvider></ActiveContextProvider>;
  const view = render(viewFor("dev"));
  expect(screen.getByRole("tab", { name: "Resource Map" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByTestId("map").getAttribute("data-context")).toBe("dev");
  expect(screen.getByTestId("map").textContent).toContain("prod/api");
  fireEvent.click(screen.getByRole("button", { name: "Open related" }));
  expect(screen.getByTestId("child")).toBeTruthy();
  view.rerender(viewFor("other"));
  expect(screen.queryByTestId("child")).toBeNull();
  expect(screen.getByTestId("map").getAttribute("data-context")).toBe("other");
  expect(screen.getByRole("tab", { name: "Resource Map" }).getAttribute("aria-selected")).toBe("true");
});
