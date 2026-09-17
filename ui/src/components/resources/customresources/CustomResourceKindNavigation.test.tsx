// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomResourceKindTable, { kindPreferenceKey, type ExactKind, type KindPage } from "./CustomResourceKindTable";
import CustomResourcesTable from "./CustomResourcesTable";
import ClusterCustomResourcesTable from "./ClusterCustomResourcesTable";
import CustomResourceDefinitionsTable from "../customresourcedefinitions/CustomResourceDefinitionsTable";
import { columnWidthsStorageKey } from "../../shared/ResourceListPage";

// Keep the real lists, query lifecycle, DataGrid, metadata strip and CRD detail/entry
// mounted. Only unrelated app providers and detail actions are test doubles.
const state = vi.hoisted(() => ({ context: "ctx", get: vi.fn(), crdScope: "Namespaced", drawer: vi.fn() }));
vi.mock("../../../api", async (importOriginal) => ({ ...await importOriginal<typeof import("../../../api")>(), apiGetWithContext: state.get, apiGet: vi.fn() }));
vi.mock("../../../activeContext", () => ({ useActiveContext: () => state.context }));
vi.mock("../../../connectionState", () => ({ useConnectionState: () => ({ health: "healthy", retryNonce: 0 }) }));
vi.mock("../../../keyboard/KeyboardProvider", () => ({
  useKeyboardControls: () => ({ keyboardSettings: {}, requestKeyboardFocus: vi.fn() }), useTableKeyboardControls: vi.fn(),
}));
vi.mock("../../../settingsContext", () => ({ useUserSettings: () => ({
  settings: { appearance: { smartFiltersEnabled: false }, smartFilters: { rules: [], minCount: 1 }, resourceTags: { enabled: false, definitions: [], assignments: {} }, savedViews: [] }, setSettings: vi.fn(),
}) }));
vi.mock("../../../utils/useEmptyListAccessCheck", () => ({ default: () => null }));
vi.mock("../../../utils/useResourceSignals", () => ({ default: () => ({ signals: [] }) }));
vi.mock("../../shared/ResourceTableToolbar", () => ({ default: () => null }));
vi.mock("../../layout/RightDrawer", () => ({ default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <aside>{children}</aside> : null }));
vi.mock("../../shared/ResourceDrawerShell", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("../customresourcedefinitions/CRDActions", () => ({ default: () => null }));
vi.mock("../../shared/AttentionSummary", () => ({ default: () => null }));
vi.mock("./CustomResourceDrawer", () => ({ default: (props: { open: boolean; crRef: unknown }) => {
  if (!props.open) return null;
  state.drawer(props.crRef);
  return <div data-testid="cr-drawer">Object details</div>;
} }));
const kind: ExactKind = { group: "one.io", version: "v1beta1", resource: "widgets", scope: "Namespaced" };
function pageFor(path: string): KindPage {
  const url = new URL(path, "http://local");
  const [, , , group, version, resource] = url.pathname.split("/");
  const scope = url.searchParams.get("scope") as ExactKind["scope"];
  const namespace = url.searchParams.get("namespace") || "";
  return { group, version, resource, scope, namespace, kind: "Widget", columns: [{ name: "Name", type: "string" }, { name: "Status", type: "string" }],
    items: [{ id: "", name: "verified", namespace, group, version, resource, kind: "Widget", uid: "uid-1", identityKnown: true, ageKnown: false, ageSec: 0, cells: ["verified", "Ready"], provenance: "kubernetes" },
      { id: "", name: "", namespace, group, version, resource, kind: "Widget", uid: "", identityKnown: false, ageKnown: false, ageSec: 0, cells: ["unverified", null] }],
    meta: { columnSource: "table", limit: 200, pages: 1, continue: url.searchParams.has("continue") ? "" : "a+/=&?", truncated: !url.searchParams.has("continue"), partial: true, unknownIdentityRows: 1, incompleteCellRows: 1 } };
}
const aggregateRows = ["one.io", "two.io"].map((group) => ({ name: "same-name", kind: "Widget", group, version: "v1beta1", resource: "widgets", namespace: "ns", ageSec: 0, provenance: "kubernetes" }));
function apiResponse(path: string) {
  if (path.startsWith("/api/customresource-kinds/")) return pageFor(path);
  if (path.includes("/events?")) return { items: [] };
  if (path === "/api/customresourcedefinitions/widgets.one.io") return { item: {
    summary: { name: "widgets.one.io", group: "one.io", plural: "widgets", kind: "Widget", scope: state.crdScope },
    versions: [{ name: "v1beta1", served: true, storage: false }, { name: "v1", served: true, storage: true }, { name: "v0", served: false, storage: false }], conditions: [], metadata: {},
  } };
  if (path === "/api/customresourcedefinitions") return { items: [{ name: "widgets.one.io", group: "one.io", kind: "Widget", scope: state.crdScope, versions: "v1beta1,v1", ageSec: 0 }] };
  if (path.includes("/customresources") || path === "/api/clusterresources") return { items: [...aggregateRows, { ...aggregateRows[0], name: "manifest-only", provenance: "helmManifest" }], meta: { totalKinds: 2, accessibleKinds: 2, deniedKinds: 0, errorKinds: 0,
    discovery: { source: "helmCandidates", listDenied: true, universeUnknown: true, candidates: 3, confirmed: 2, denied: 0, notFound: 1, errors: 0 } } };
  return { item: { observers: [] }, revision: "1" };
}
const exactCalls = () => state.get.mock.calls.filter(([path]) => String(path).startsWith("/api/customresource-kinds/"));
const button = (name: string) => screen.getByRole("button", { name });
const exactView = (props: Partial<{ token: string; namespace: string; kind: ExactKind }> = {}) => <CustomResourceKindTable token="t" namespace="ns" kind={kind} onBack={() => {}} {...props} />;
async function settle() { await act(async () => {}); }
beforeEach(() => { state.context = "ctx"; state.crdScope = "Namespaced"; state.get.mockReset(); state.drawer.mockReset(); state.get.mockImplementation(async (path: string) => apiResponse(path)); });
afterEach(() => { cleanup(); localStorage.clear(); });

describe("mounted exact-kind navigation", () => {
  it.each([false, true])("enters from the real aggregate (cluster=%s), separates colliding groups, and returns", async (cluster) => {
    render(cluster ? <ClusterCustomResourcesTable token="t" /> : <CustomResourcesTable token="t" namespace="ns" />);
    await settle();
    const entry = await screen.findByTitle(`two.io/v1beta1/widgets · ${cluster ? "Cluster" : "Namespaced"}`);
    expect(screen.getByText(/total kind universe unknown/)).toBeTruthy();
    const manifestRow = screen.getByText("manifest-only").closest('[role="row"]')!;
    expect(manifestRow.querySelector('[role="button"]')?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(entry);
    await screen.findByText(/Server printer columns/);
    const url = new URL(exactCalls()[0][0], "http://local");
    expect(url.pathname).toBe("/api/customresource-kinds/two.io/v1beta1/widgets");
    expect(url.searchParams.get("scope")).toBe(cluster ? "Cluster" : "Namespaced");
    expect(url.searchParams.get("namespace")).toBe(cluster ? null : "ns");
    expect(screen.queryByText(/total kind universe unknown/)).toBeNull();
    fireEvent.click(button("Back to all custom resources"));
    await screen.findByText("manifest-only");
    expect(screen.queryByText(/Server printer columns/)).toBeNull();
  });

  it.each(["Namespaced", "Cluster"])("enters the selected served version from a real %s CRD detail and returns to aggregate", async (scope) => {
    state.crdScope = scope;
    render(<CustomResourceDefinitionsTable token="t" namespace="ns" />);
    await settle();
    fireEvent.doubleClick(await screen.findByText("widgets.one.io"));
    const browse = await screen.findByRole("button", { name: `Browse v1beta1 · ${scope}${scope === "Namespaced" ? " · ns" : ""}` });
    expect(screen.queryByRole("button", { name: /Browse v0/ })).toBeNull();
    fireEvent.click(browse);
    await screen.findByText(/Server printer columns/);
    expect(exactCalls()[0][0]).toContain("/one.io/v1beta1/widgets?");
    fireEvent.click(button("Back to all custom resources"));
    await screen.findByText("manifest-only");
  });

  it("requires a selected namespace in the CRD detail and in direct kind navigation", async () => {
    const view = render(<CustomResourceDefinitionsTable token="t" />);
    await settle();
    fireEvent.doubleClick(await screen.findByText("widgets.one.io"));
    expect((await screen.findByRole("button", { name: "Browse v1beta1 · Namespaced" }) as HTMLButtonElement).disabled).toBe(true);
    expect(exactCalls()).toHaveLength(0);
    view.unmount();
    render(exactView({ namespace: "" }));
    expect(screen.getByText(/Select an exact kind and namespace/)).toBeTruthy();
    expect(exactCalls()).toHaveLength(0);
  });

  it("does not drain pages; renders fallback/counters and pins actionable rows to UID", async () => {
    state.get.mockImplementation(async (path: string) => {
      const page = pageFor(path); page.meta.columnSource = "standard"; page.meta.fallbackReason = "serverReturnedObjectList"; return page;
    });
    render(exactView());
    await screen.findByText(/Standard columns.*serverReturnedObjectList/);
    expect(screen.getByText(/1 unknown identities · 1 incomplete cell rows/)).toBeTruthy();
    expect(exactCalls()).toHaveLength(1);
    fireEvent.doubleClick(await screen.findByText("unverified"));
    expect(state.drawer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("unverified"));
    expect(screen.getByText("unverified").closest('[role="row"]')?.getAttribute("aria-selected")).not.toBe("true");
    fireEvent.doubleClick(screen.getByText("verified"));
    expect(state.drawer).toHaveBeenLastCalledWith(expect.objectContaining({ ...kind, scope: "namespaced", uid: "uid-1", name: "verified", namespace: "ns" }));
    fireEvent.click(button("Next page"));
    await waitFor(() => expect(exactCalls()).toHaveLength(2));
    await settle();
    expect(new URL(exactCalls()[1][0], "http://local").searchParams.get("continue")).toBe("a+/=&?");
    expect(screen.queryByTestId("cr-drawer")).toBeNull();
    fireEvent.click(button("Previous page"));
    await waitFor(() => expect(exactCalls()).toHaveLength(3));
    expect(new URL(exactCalls()[2][0], "http://local").searchParams.has("continue")).toBe(false);
  });

  it.each(["context", "token", "namespace", "group", "version", "resource", "scope"] as const)("resets cursor/selection and ignores aborted late results after only %s changes", async (dimension) => {
    const view = render(exactView());
    await screen.findByText(/Server printer columns/);
    fireEvent.doubleClick(await screen.findByText("verified"));
    let resolve!: (value: KindPage) => void;
    state.get.mockImplementationOnce(() => new Promise<KindPage>((done) => { resolve = done; }));
    fireEvent.click(button("Next page"));
    await waitFor(() => expect(exactCalls()).toHaveLength(2));
    const obsolete = exactCalls()[1];
    const props: Partial<{ token: string; namespace: string; kind: ExactKind }> = {};
    if (dimension === "context") state.context = "other";
    else if (dimension === "token") props.token = "new-token";
    else if (dimension === "namespace") props.namespace = "other-ns";
    else props.kind = { ...kind, [dimension]: dimension === "scope" ? "Cluster" : "other" };
    view.rerender(exactView(props));
    await waitFor(() => expect(exactCalls()).toHaveLength(3));
    await settle();
    expect(obsolete[3].signal.aborted).toBe(true);
    expect(new URL(exactCalls()[2][0], "http://local").searchParams.has("continue")).toBe(false);
    expect(exactCalls()[2].slice(1, 3)).toEqual([props.token || "t", state.context]);
    const stale = pageFor(obsolete[0]); stale.meta.fallbackReason = "STALE"; stale.meta.columnSource = "standard";
    await act(async () => resolve(stale));
    expect(screen.queryByText(/STALE/)).toBeNull();
    expect(screen.queryByTestId("cr-drawer")).toBeNull();
    expect(screen.getByText(/Page 1 ·/)).toBeTruthy();
  });

  it.each([403, 500])("keeps a coherent stale partial/fallback page after reload HTTP %s and recovers on Retry", async (status) => {
    state.get.mockImplementationOnce(async (path: string) => {
      const page = pageFor(path);
      page.meta.columnSource = "standard";
      page.meta.fallbackReason = "serverReturnedObjectList";
      return page;
    });
    render(exactView());
    await settle();
    const evidence = screen.getByText(/Standard columns.*serverReturnedObjectList/).textContent;
    const headers = () => screen.getAllByRole("columnheader").map((header) => header.textContent);
    const originalHeaders = headers();
    state.get.mockRejectedValueOnce(Object.assign(new Error("reload denied"), { status }));
    fireEvent.click(button("Reload page"));
    await settle();
    expect(screen.getByRole("alert").textContent).toMatch(/Reload failed.*last successful page.*stale/i);
    expect(screen.getByText(/Standard columns.*serverReturnedObjectList/).textContent).toBe(evidence);
    expect(evidence).toMatch(/Partial page.*1 unknown identities · 1 incomplete cell rows/);
    expect(headers()).toEqual(originalHeaders);
    expect(screen.getByText("Ready")).toBeTruthy();
    fireEvent.doubleClick(screen.getByText("verified"));
    expect(state.drawer).toHaveBeenLastCalledWith(expect.objectContaining({ uid: "uid-1", name: "verified" }));
    fireEvent.doubleClick(screen.getByText("unverified"));
    expect(state.drawer.mock.calls.every(([ref]) => ref.uid === "uid-1")).toBe(true);
    let resolve!: (page: KindPage) => void;
    state.get.mockImplementationOnce(() => new Promise<KindPage>((done) => { resolve = done; }));
    fireEvent.click(button("Retry"));
    await settle();
    expect((button("Retry") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toMatch(/stale/i);
    const recovered = pageFor(exactCalls()[2][0]);
    recovered.items[0].cells[1] = "Recovered";
    recovered.meta.partial = false;
    recovered.meta.incompleteCellRows = 0;
    await act(async () => resolve(recovered));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Recovered")).toBeTruthy();
    expect(screen.queryByText(/serverReturnedObjectList/)).toBeNull();
    expect(screen.getByText(/Server printer columns/).textContent).not.toContain("Partial page");
    expect(exactCalls()).toHaveLength(3);
  });

  it("shows initial load failure without stale metadata and retries", async () => {
    state.get.mockRejectedValueOnce(Object.assign(new Error("forbidden"), { status: 403 }));
    render(exactView());
    await settle();
    expect(screen.getAllByRole("alert").some((alert) => /Load failed/.test(alert.textContent || ""))).toBe(true);
    expect(screen.queryByText(/last successful page|Server printer columns|unknown identities/)).toBeNull();
    fireEvent.click(button("Retry"));
    await settle();
    expect(screen.getByText("verified")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["context", "kind"])("clears failure and metadata on %s switch and ignores aborted old reload rejection", async (dimension) => {
    const view = render(exactView());
    await settle();
    state.get.mockRejectedValueOnce(new Error("old failure"));
    fireEvent.click(button("Reload page"));
    await settle();
    expect(screen.getByRole("alert").textContent).toMatch(/Reload failed/);
    let reject!: (error: Error) => void;
    state.get.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    fireEvent.click(button("Retry"));
    await settle();
    const obsolete = exactCalls()[2];
    let resolve!: (page: KindPage) => void;
    state.get.mockImplementationOnce(() => new Promise<KindPage>((done) => { resolve = done; }));
    if (dimension === "context") state.context = "other";
    view.rerender(exactView(dimension === "kind" ? { kind: { ...kind, resource: "others" } } : {}));
    await settle();
    expect(obsolete[3].signal.aborted).toBe(true);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/Server printer columns|unknown identities/)).toBeNull();
    expect(screen.queryByText("verified")).toBeNull();
    await act(async () => reject(new Error("late old failure")));
    expect(screen.queryByRole("alert")).toBeNull();
    const current = pageFor(exactCalls()[3][0]);
    current.columns = [{ name: "New column", type: "string" }];
    await act(async () => resolve(current));
    expect(screen.getByRole("columnheader", { name: /New column/ })).toBeTruthy();
    expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("isolates persisted dynamic visibility and width from another group and aggregate lists", async () => {
    const field = 'printer:1:["Status","string",""]';
    const key = columnWidthsStorageKey("ctx", kindPreferenceKey(kind), "ns");
    localStorage.setItem(`${key}:visibility`, JSON.stringify({ [field]: false }));
    localStorage.setItem(key, JSON.stringify({ identity: 311 }));
    const view = render(exactView());
    await screen.findByText(/Server printer columns/);
    expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /^Identity/ }).style.width).toBe("311px");
    view.rerender(exactView({ kind: { ...kind, group: "two.io" } }));
    await screen.findByRole("columnheader", { name: "Status" });
    expect(screen.getByRole("columnheader", { name: /^Identity/ }).style.width).toBe("150px");
    view.unmount();
    render(<CustomResourcesTable token="t" namespace="ns" />);
    await screen.findByRole("columnheader", { name: "Status" });
    expect(localStorage.getItem(columnWidthsStorageKey("ctx", "customresources", "ns"))).toBeNull();
  });

  it("rejects an exact page with a different response identity and allows retry", async () => {
    state.get.mockImplementationOnce(async (path: string) => ({ ...pageFor(path), group: "wrong.io" }));
    render(exactView());
    await settle();
    expect(screen.queryByText("verified")).toBeNull();
    expect((button("Next page") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button("Retry"));
    await screen.findByText("verified");
    expect(exactCalls()).toHaveLength(2);
  });
});
