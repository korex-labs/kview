// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ResourceIdentityDrawer from "./ResourceIdentityDrawer";
vi.mock("../resources/customresources/CustomResourceDrawer", () => ({ default: ({ crRef }: { crRef: unknown }) => <div data-testid="cr-ref">{JSON.stringify(crRef)}</div> }));
vi.mock("./FocusedResourceMapDrawer", () => ({ default: ({ identity }: { identity: unknown }) => <div data-testid="map-ref">{JSON.stringify(identity)}</div> }));
afterEach(cleanup);
it("forwards custom-resource UID, exact GVR and scope", async () => {
  render(<ResourceIdentityDrawer token="token" onClose={vi.fn()} identity={{ group: "example.io", version: "v1beta1", resource: "widgets", kind: "Widget", namespace: "apps", name: "demo", scope: "namespaced", uid: "u1" }} />);
  expect(JSON.parse((await screen.findByTestId("cr-ref")).textContent!)).toEqual({ group: "example.io", version: "v1beta1", resource: "widgets", kind: "Widget", namespace: "apps", name: "demo", scope: "namespaced", uid: "u1" });
});
it("routes an explicit map destination without mounting the ordinary details", async () => {
  const identity = { group: "example.io", version: "v1beta1", resource: "widgets", kind: "Widget", namespace: "apps", name: "demo", scope: "namespaced" as const, uid: "u1" };
  render(<ResourceIdentityDrawer token="token" onClose={vi.fn()} identity={identity} destination="resource-map" />);
  expect(JSON.parse((await screen.findByTestId("map-ref")).textContent!)).toEqual(identity);
  expect(screen.queryByTestId("cr-ref")).toBeNull();
});
