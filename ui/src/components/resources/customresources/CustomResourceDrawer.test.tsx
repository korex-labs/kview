// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CustomResourceDrawer, { resolvedCustomResourceNamespace, type CRRef } from "./CustomResourceDrawer";

// Exercise the real read-only CodeBlock and clipboard path; stub only Prism's DOM.
vi.mock("react-syntax-highlighter", () => ({
  Prism: ({ language, children }: { language: string; children: string }) => <pre><code data-language={language}>{children}</code></pre>,
}));
const apiGetMock = vi.hoisted(() => vi.fn());
const current = vi.hoisted(() => ({ context: "alpha", retryNonce: 0 }));
vi.mock("../../../activeContext", () => ({ useActiveContext: () => current.context }));

vi.mock("../../../api", () => ({
  apiGet: apiGetMock,
  apiGetWithContext: apiGetMock,
  toApiError: (error: { status?: number; message?: string }) => ({ status: error.status, message: error.message || String(error) }),
}));
vi.mock("../../../connectionState", () => ({ useConnectionState: () => ({ retryNonce: current.retryNonce }) }));
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
  vi.resetAllMocks();
  current.context = "alpha";
  current.retryNonce = 0;
});

describe("resolvedCustomResourceNamespace", () => {
  const ref = { group: "example.io", version: "v1beta1", resource: "widgets", kind: "Widget", namespace: "apps", name: "demo" };
  it("retries direct-resource details in the captured context", async () => {
    apiGetMock.mockRejectedValueOnce(new Error("temporarily unavailable")).mockResolvedValue({ item: { summary: { name: "retried" }, yaml: "" } });
    const props = { open: true, onClose: vi.fn(), token: "token", crRef: ref };
    const view = render(<CustomResourceDrawer {...props} />);
    await screen.findByText("temporarily unavailable");
    current.retryNonce++;
    view.rerender(<CustomResourceDrawer {...props} />);
    await screen.findByText("retried");
    expect(apiGetMock.mock.calls[1][2]).toBe("alpha");
  });
  it("offers an explicit retry after detail failure", async () => {
    apiGetMock.mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValue({ item: { summary: { name: "retried" }, yaml: "" } });
    render(<CustomResourceDrawer open onClose={vi.fn()} token="token" crRef={ref} />);
    await screen.findByText("temporarily unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry details" }));
    await screen.findByText("retried");
    expect(apiGetMock.mock.calls[1][2]).toBe("alpha");
  });
  it("pins the first loaded UID across retries", async () => {
    apiGetMock.mockResolvedValueOnce({ item: { summary: { name: "original", uid: "original-uid" }, yaml: "" } })
      .mockResolvedValue({ item: { summary: { name: "replacement", uid: "new-uid" }, yaml: "" } });
    const props = { open: true, onClose: vi.fn(), token: "token", crRef: ref };
    const view = render(<CustomResourceDrawer {...props} />);
    await screen.findByText("original");
    current.retryNonce++;
    view.rerender(<CustomResourceDrawer {...props} />);
    await screen.findByText(/UID changed/);
    expect(screen.queryByText("replacement")).toBeNull();
  });
  it("keeps the requested served version after resolution", async () => {
    apiGetMock.mockResolvedValueOnce({ resource: "widgets", storageVersion: "v1", scope: "Namespaced" })
      .mockResolvedValue({ item: { summary: { name: "version-result" }, yaml: "" } });
    render(<CustomResourceDrawer open onClose={vi.fn()} token="token" crRef={{ ...ref, resource: undefined }} />);
    await screen.findByText("version-result");
    expect(apiGetMock.mock.calls[1][0]).toContain("/v1beta1/widgets/");
  });
  it.each(["resolve", "detail"])("aborts obsolete %s requests on context/ref replacement and ignores late success", async (phase) => {
    let complete!: (value: unknown) => void;
    apiGetMock.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }))
      .mockResolvedValue({ item: { summary: { name: "current" }, yaml: "" } });
    const props = { open: true, onClose: vi.fn(), token: "token", crRef: { ...ref, resource: phase === "resolve" ? undefined : ref.resource } };
    const view = render(<CustomResourceDrawer {...props} />);
    const signal = apiGetMock.mock.calls[0][3].signal;
    current.context = "beta";
    view.rerender(<CustomResourceDrawer {...props} crRef={{ ...ref, name: "new", version: "v2" }} />);
    await screen.findByText("current");
    expect(signal.aborted).toBe(true);
    await act(async () => complete(phase === "resolve" ? { resource: "old-plural", storageVersion: "v9" } : { item: { summary: { name: "obsolete" } } }));
    expect(screen.queryByText("obsolete")).toBeNull();
    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(apiGetMock.mock.calls[1][0]).toContain("/v2/widgets/new");
    expect(apiGetMock.mock.calls[1][2]).toBe("beta");
  });
  it("ignores a late rejection on token/UID replacement and aborts on close", async () => {
    let reject!: (error: Error) => void;
    apiGetMock.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValue({ item: { summary: { name: "current", uid: "new-uid" }, yaml: "" } });
    const props = { open: true, onClose: vi.fn(), token: "token", crRef: { ...ref, uid: "old-uid" } };
    const view = render(<CustomResourceDrawer {...props} />);
    const oldSignal = apiGetMock.mock.calls[0][3].signal;
    view.rerender(<CustomResourceDrawer {...props} token="new-token" crRef={{ ...ref, uid: "new-uid" }} />);
    await screen.findByText("current");
    await act(async () => reject(new Error("obsolete failure")));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByText("obsolete failure")).toBeNull();
    view.rerender(<CustomResourceDrawer {...props} open={false} />);
    expect(apiGetMock.mock.calls[1][3].signal.aborted).toBe(true);
  });
  it("preserves absent, null, falsy values and generation zero; Events failures stay optional", async () => {
    apiGetMock.mockImplementation((path: string) => path.includes("/events?")
      ? Promise.reject(new Error("Events forbidden"))
      : Promise.resolve({ item: { summary: { name: "inspected", uid: "u/1", resourceVersion: "42", generation: 0, statusObservedGeneration: 0 }, status: null,
        conditions: [{ type: "Ready", status: "False", observedGeneration: 0 }], yaml: "" } }));
    render(<CustomResourceDrawer open onClose={vi.fn()} token="token" crRef={ref} />);
    await screen.findByText("inspected");
    expect(screen.getAllByText("0")).toHaveLength(3);
    expect(apiGetMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("tab", { name: "Spec" }));
    expect(screen.getByText("Absent")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Status" }));
    expect(screen.getByText("null")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    await screen.findByText(/Forbidden: you don.t have permission/);
    expect(screen.queryByText("No events found.")).toBeNull();
    const eventCall = apiGetMock.mock.calls[1];
    const query = new URL(eventCall[0], "http://test").searchParams;
    expect(query.get("namespace")).toBe("apps");
    expect(query.get("uid")).toBe("u/1");
    expect(query.has("expectedUID")).toBe(false);
    expect(query.get("limit")).toBe("50");
    expect(eventCall[2]).toBe("alpha");
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(screen.getByText("inspected")).toBeTruthy();
  });
  it.each([
    ["absent", undefined], ["null", null], ["false", false], ["zero", 0],
    ["empty string", ""], ["empty array", []], ["empty object", {}],
    ["nested JSON", { nested: [null, false, 0, "", {}, [], "<script> & \nquoted"] }],
    ["large JSON", "x".repeat(100_001)],
  ])("uses the shared read-only viewer without losing %s in either fragment", async (_, value) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    apiGetMock.mockResolvedValue({ item: { summary: { name: "json-resource" },
      ...(value === undefined ? {} : { spec: value, status: value }), yaml: "full document" } });
    const view = render(<CustomResourceDrawer open onClose={vi.fn()} token="token" crRef={ref} />);
    await screen.findByText("json-resource");
    for (const tab of ["Spec", "Status"]) {
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      expect(screen.queryByTestId("yaml-panel")).toBeNull();
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(view.container.querySelector('[contenteditable="true"]')).toBeNull();
      expect(screen.queryByRole("button", { name: /Patch|Apply|Edit/ })).toBeNull();
      if (value === undefined) {
        expect(screen.getByText("Absent")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
      } else {
        const serialized = JSON.stringify(value, null, 2);
        expect(screen.queryByText("Absent")).toBeNull();
        if (serialized.length > 100_000) {
          expect(screen.getByText(/syntax highlighting disabled/)).toBeTruthy();
          expect(screen.getByText(serialized, { exact: true })).toBeTruthy();
        } else {
          const code = view.container.querySelector('code[data-language="json"]');
          expect(code).not.toBeNull();
          expect(code?.textContent).toBe(serialized);
        }
        // The actual shared viewer copies the serialized native value, not a preview.
        fireEvent.click(screen.getByRole("button", { name: /Copy|Copied/ }));
        await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(serialized));
      }
    }
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["group", { group: "other.io" }], ["version", { version: "v2" }], ["plural", { resource: "others" }],
    ["namespace", { namespace: "other-ns" }], ["name", { name: "other-name" }],
    ["UID", { uid: "new-uid" }], ["scope", { scope: "namespaced" }],
    ["kind", { kind: "Other" }], ["default namespace", { defaultNamespace: "other" }],
  ] as [string, Partial<CRRef>][])("invalidates pending details when %s alone changes", async (_, change) => {
    let reject!: (error: Error) => void;
    apiGetMock.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }))
      .mockResolvedValue({ item: { summary: { name: "new identity", uid: "new-uid" }, yaml: "" } });
    const props = { open: true, onClose: vi.fn(), token: "token", crRef: ref };
    const view = render(<CustomResourceDrawer {...props} />);
    const signal = apiGetMock.mock.calls[0][3].signal;
    view.rerender(<CustomResourceDrawer {...props} crRef={{ ...ref, ...change }} />);
    await screen.findByText("new identity");
    await act(async () => reject(new Error("old identity error")));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByText("old identity error")).toBeNull();
    expect(apiGetMock).toHaveBeenCalledTimes(2);
  });
  it.each(["context", "token"])("invalidates pending resolution when %s alone changes", async (field) => {
    let complete!: (value: unknown) => void;
    apiGetMock.mockImplementationOnce(() => new Promise((done) => { complete = done; }))
      .mockResolvedValueOnce({ resource: "widgets", scope: "Namespaced", storageVersion: "v1" })
      .mockResolvedValue({ item: { summary: { name: "current" }, yaml: "" } });
    const props = { open: true, onClose: vi.fn(), token: "one", crRef: { ...ref, resource: undefined } };
    const view = render(<CustomResourceDrawer {...props} />);
    const signal = apiGetMock.mock.calls[0][3].signal;
    if (field === "context") current.context = "beta";
    view.rerender(<CustomResourceDrawer {...props} token={field === "token" ? "two" : "one"} />);
    await screen.findByText("current");
    expect(signal.aborted).toBe(true);
    await act(async () => complete({ resource: "obsolete", scope: "Namespaced", storageVersion: "v9" }));
    expect(apiGetMock).toHaveBeenCalledTimes(3);
    expect(apiGetMock.mock.calls[2][0]).toContain("/v1beta1/widgets/");
    expect(apiGetMock.mock.calls[2].slice(1, 3)).toEqual(field === "context" ? ["one", "beta"] : ["two", "alpha"]);
  });
  it("does not read without explicit context and cancels pending resolution on unmount", async () => {
    current.context = "";
    const props = { open: true, onClose: vi.fn(), token: "token", crRef: ref };
    const view = render(<CustomResourceDrawer {...props} />);
    await screen.findByText("Missing active context");
    expect(apiGetMock).not.toHaveBeenCalled();
    current.context = "alpha";
    let reject!: (error: Error) => void;
    apiGetMock.mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
    view.rerender(<CustomResourceDrawer {...props} crRef={{ ...ref, resource: undefined }} />);
    const signal = apiGetMock.mock.calls[0][3].signal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => reject(new Error("late resolution failure")));
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });
  it("rejects a replacement UID and does not fetch Events", async () => {
    apiGetMock.mockResolvedValue({ item: { summary: { name: "replacement", uid: "new" }, yaml: "" } });
    render(<CustomResourceDrawer open onClose={vi.fn()} token="token" crRef={{ ...ref, uid: "old" }} />);
    await screen.findByText(/UID changed/);
    expect(screen.queryByText("replacement")).toBeNull();
    expect(apiGetMock).toHaveBeenCalledTimes(1);
  });
  it("renders raw CR conditions neutrally instead of guessing polarity or freshness", async () => {
    apiGetMock.mockResolvedValue({ item: {
      summary: { name: "demo", signalSeverity: "unknown" },
      conditions: [
        { type: "Degraded", status: "True" },
        { type: "Installed", status: "False" },
      ],
      yaml: "",
    } });
    render(<CustomResourceDrawer open onClose={vi.fn()} token="token"
      crRef={{ group: "example.io", version: "v1", resource: "widgets", kind: "Widget", namespace: "apps", name: "demo" }} />);
    await screen.findByText("Degraded");
    for (const label of ["True", "False"]) {
      const chip = screen.getByText(label).closest(".MuiChip-root");
      expect(chip?.classList.contains("MuiChip-colorDefault")).toBe(true);
      expect(getComputedStyle(chip!.closest("tr")!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    }
  });

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
      "alpha",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
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
