// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CustomResourceKindTable, { kindPreferenceKey, kindPagePath, printerCell, type ExactKind } from "./CustomResourceKindTable";
const state = vi.hoisted(() => ({ context: "ctx", get: vi.fn(), props: null as any })); // eslint-disable-line @typescript-eslint/no-explicit-any
vi.mock("../../../activeContext", () => ({ useActiveContext: () => state.context }));
vi.mock("../../../api", () => ({ apiGetWithContext: state.get }));
vi.mock("./CustomResourceDrawer", () => ({ default: () => <div>drawer</div> }));
vi.mock("../../shared/ResourceListPage", () => ({ default: function MockList(props: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  state.props = props;
  const { fetchRows } = props;
  React.useEffect(() => { const controller = new AbortController(); void fetchRows(state.context, "initial", controller.signal).catch(() => {}); return () => controller.abort(); }, [fetchRows]);
  return <div>{props.dataplaneMetaPrefix}{props.renderFooterExtra?.(() => Promise.resolve())}</div>;
} }));
const kind: ExactKind = { group: "one.io", version: "v1beta1", resource: "widgets", scope: "Namespaced" };
const page = (continuation = "") => ({ ...kind, namespace: "ns", kind: "Widget", columns: [{ name: "Name", type: "string" }, { name: "Name", type: "string" }], items: [{ name: "w", namespace: "ns", uid: "uid", identityKnown: true, cells: ["w", null] }, { identityKnown: false, cells: ["unverified", null] }], meta: { columnSource: "table", partial: true, truncated: !!continuation, continue: continuation, unknownIdentityRows: 1, incompleteCellRows: 1, limit: 200, pages: 1 } });
afterEach(cleanup);
beforeEach(() => { state.context = "ctx"; state.get.mockReset(); state.get.mockResolvedValue(page()); });
describe("exact CR kind pages", () => {
  it("keys preferences by exact GVR/scope and preserves opaque continuation", () => {
    for (const changed of [{ group: "two.io" }, { version: "v1" }, { resource: "others" }, { scope: "Cluster" as const }]) expect(kindPreferenceKey(kind)).not.toBe(kindPreferenceKey({ ...kind, ...changed }));
    const url = new URL(kindPagePath(kind, "ns", "a+/=&?"), "http://local");
    expect(url.pathname).toBe("/api/customresource-kinds/one.io/v1beta1/widgets");
    expect(url.searchParams.get("continue")).toBe("a+/=&?");
    expect(url.searchParams.get("limit")).toBe("200");
    expect(new URL(kindPagePath({ ...kind, scope: "Cluster" }, "ns", ""), "http://local").searchParams.has("namespace")).toBe(false);
    expect(() => kindPagePath(kind, "", "")).toThrow();
    expect(printerCell(null)).toBe("Unknown");
    expect(printerCell("x".repeat(10000)).length).toBeLessThan(2100);
  });
  it("fetches just one page, aligns duplicate columns, and disables unknown identities", async () => {
    state.get.mockResolvedValue(page("a+/=&?"));
    render(<CustomResourceKindTable token="t" kind={kind} namespace="ns" onBack={() => {}} />);
    await screen.findByText(/Partial page/);
    expect(state.get).toHaveBeenCalledTimes(1);
    expect(state.get.mock.calls[0].slice(1, 3)).toEqual(["t", "ctx"]);
    expect(new Set(state.props.columns.map((c: { field: string }) => c.field)).size).toBe(state.props.columns.length);
    expect(state.props.isRowActionable({ identityKnown: false })).toBe(false);
    expect(state.props.renderDrawer({ selectedRow: { identityKnown: false }, open: true })).toBe(null);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
    expect(new URL(state.get.mock.calls[1][0], "http://local").searchParams.get("continue")).toBe("a+/=&?");
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(3));
    expect(new URL(state.get.mock.calls[2][0], "http://local").searchParams.has("continue")).toBe(false);
  });
  it("resets pagination on token/context/namespace/kind identity and ignores late pages", async () => {
    state.get.mockResolvedValue(page("next"));
    const view = render(<CustomResourceKindTable token="t" kind={kind} namespace="ns" onBack={() => {}} />);
    await screen.findByText(/Partial page/);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    view.rerender(<CustomResourceKindTable token="new" kind={kind} namespace="ns" onBack={() => {}} />);
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(3));
    expect(state.get.mock.calls[2][0]).not.toContain("continue=");
    state.context = "other";
    view.rerender(<CustomResourceKindTable token="new" kind={{ ...kind, version: "v1" }} namespace="other-ns" onBack={() => {}} />);
    await waitFor(() => expect(state.get).toHaveBeenCalledTimes(4));
    await act(async () => resolve({ ...page(), meta: { columnSource: "standard", fallbackReason: "STALE" } }));
    expect(screen.queryByText(/STALE/)).toBeNull();
    expect(state.get.mock.calls[2][3].signal.aborted).toBe(true);
  });
  it("shows the explicit standard-column fallback reason", async () => {
    state.get.mockResolvedValue({ ...page(), meta: { ...page().meta, columnSource: "standard", fallbackReason: "serverReturnedObjectList" } });
    render(<CustomResourceKindTable token="t" kind={kind} namespace="ns" onBack={() => {}} />);
    await screen.findByText(/Standard columns.*serverReturnedObjectList/);
  });
});
