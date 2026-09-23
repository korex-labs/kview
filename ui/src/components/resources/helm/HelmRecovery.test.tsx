// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HelmRecovery, { type HelmRecoveryPreview } from "./HelmRecovery";

const environment = vi.hoisted(() => ({ context: "ctx", health: "healthy" }));
vi.mock("../../../activeContext", () => ({ useActiveContext: () => environment.context }));
vi.mock("../../../connectionState", () => ({
  useConnectionState: () => ({ health: environment.health }),
  notifyApiSuccess: vi.fn(), notifyApiFailure: vi.fn(),
}));
const preview: HelmRecoveryPreview = {
  namespace: "apps", release: "release", eligible: true,
  latest: { revision: 3, status: "pending-upgrade", description: "Preparing upgrade", secretName: "actual-history-secret", uid: "uid-3", resourceVersion: "rv-3" },
  previous: { revision: 2, status: "deployed", secretName: "prior-secret" },
  confirmation: "delete apps/release revision 3",
};
const props = { open: true, token: "token", namespace: "apps", releaseName: "release", onRecovered: vi.fn(), onOpenSecret: vi.fn() };
const fetchMock = vi.fn();
function response(item: unknown, status = 200) { return new Response(JSON.stringify(item), { status, headers: { "Content-Type": "application/json" } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
function setup(item = preview, canDelete = true) {
  fetchMock.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/api/capabilities") return Promise.resolve(response({ capabilities: { delete: canDelete, update: false, patch: false, create: false } }));
    if (init?.method === "POST") return Promise.resolve(response({ active: environment.context, item: { status: "ok", message: "History Secret deleted" } }));
    return Promise.resolve(response({ active: environment.context, item }));
  });
}
function posts() { return fetchMock.mock.calls.filter(([path, init]) => path !== "/api/capabilities" && init?.method === "POST"); }
async function openPreview() {
  fireEvent.click(screen.getByRole("button", { name: "Preview recovery" }));
  await screen.findByText("Preparing upgrade");
}
async function openConfirmation() {
  const review = screen.getByRole("button", { name: "Review history Secret deletion" });
  await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(review);
  const modal = await screen.findByRole("dialog");
  await within(modal).findByRole("textbox", { name: "Confirmation" });
  await waitFor(() => expect((within(modal).getByRole("textbox") as HTMLInputElement).disabled).toBe(false));
  return modal;
}
function acknowledge(modal: HTMLElement) {
  fireEvent.change(within(modal).getByRole("textbox", { name: "Confirmation" }), { target: { value: preview.confirmation } });
  fireEvent.click(within(modal).getByRole("checkbox"));
}
beforeEach(() => { environment.context = "ctx"; environment.health = "healthy"; vi.stubGlobal("fetch", fetchMock); setup(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe("Guarded Helm recovery", () => {
  it("uses a fresh preview, exact typed acknowledgement and stopped-writers gate, then posts only the concrete identity", async () => {
    render(<HelmRecovery {...props} />);
    await openPreview();
    fireEvent.click(screen.getByRole("button", { name: "actual-history-secret" }));
    expect(props.onOpenSecret).toHaveBeenCalledWith("actual-history-secret");
    const modal = await openConfirmation();
    const confirm = within(modal).getByRole("button", { name: "Delete history Secret" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(modal).getByRole("textbox"), { target: { value: preview.confirmation } });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(modal).getByRole("checkbox"));
    fireEvent.change(within(modal).getByRole("textbox"), { target: { value: `${preview.confirmation} ` } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(modal).getByRole("textbox"), { target: { value: preview.confirmation } });
    fireEvent.click(confirm);
    await waitFor(() => expect(props.onRecovered).toHaveBeenCalledTimes(1));
    expect(posts()).toHaveLength(1);
    const [path, init] = posts()[0];
    expect(path).toBe("/api/namespaces/apps/helmreleases/release/recovery");
    expect(init.headers).toMatchObject({ Authorization: "Bearer token", "X-Kview-Context": "ctx" });
    expect(JSON.parse(init.body)).toEqual({ expectedRevision: 3, expectedSecretName: "actual-history-secret", expectedUID: "uid-3", expectedResourceVersion: "rv-3", confirmation: preview.confirmation, writersStopped: true });
    expect(fetchMock.mock.calls.filter(([p, i]) => p.endsWith("/recovery") && !i?.method)).toHaveLength(3);
    await screen.findByText("History Secret deleted");
  });

  it.each(["backend denial", "readonly capability", "failed", "pending-install", "first revision", "no prior"])("blocks unsafe preview: %s", async (reason) => {
    const item = structuredClone(preview);
    if (reason === "backend denial") { item.eligible = false; item.blockedReason = "Forbidden by server"; }
    if (reason === "failed" || reason === "pending-install") item.latest.status = reason;
    if (reason === "first revision") { item.latest.revision = 1; item.confirmation = "delete apps/release revision 1"; }
    if (reason === "no prior") delete item.previous;
    setup(item, reason !== "readonly capability");
    render(<HelmRecovery {...props} />);
    await openPreview();
    expect((screen.getByRole("button", { name: "Review history Secret deletion" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Recovery guidance and alternatives" }));
    expect(screen.getByText(/For failed releases, use Rollback in History/)).toBeTruthy();
    expect(screen.getByText(/Age does not prove abandonment/)).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });

  it("invalidates a 409 preview and requires explicit fetch and new confirmation, without retrying the POST", async () => {
    render(<HelmRecovery {...props} />); await openPreview();
    let modal = await openConfirmation(); acknowledge(modal);
    fetchMock.mockImplementationOnce(() => Promise.resolve(response({ message: "History changed" }, 409)));
    fireEvent.click(within(modal).getByRole("button", { name: "Delete history Secret" }));
    await screen.findByText(/Fetch a new preview and confirm again/);
    expect(posts()).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Preview recovery" }));
    await screen.findByText("Preparing upgrade"); modal = await openConfirmation();
    expect((within(modal).getByRole("textbox") as HTMLInputElement).value).toBe("");
    expect((within(modal).getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    acknowledge(modal); fireEvent.click(within(modal).getByRole("button", { name: "Delete history Secret" }));
    await waitFor(() => expect(props.onRecovered).toHaveBeenCalledTimes(1));
  });

  it("does not double-submit while a deletion is unresolved", async () => {
    render(<HelmRecovery {...props} />); await openPreview();
    const modal = await openConfirmation(); acknowledge(modal);
    const pending = deferred<Response>(); fetchMock.mockImplementationOnce(() => pending.promise);
    const button = within(modal).getByRole("button", { name: "Delete history Secret" });
    fireEvent.click(button); fireEvent.click(button);
    expect(posts()).toHaveLength(1);
    await act(async () => pending.resolve(response({ active: "ctx", item: { status: "ok", message: "Deleted" } })));
  });

  it.each(["token", "context", "namespace", "name", "close", "offline", "unmount"])("ignores late preview and aborts on %s", async (dimension) => {
    const pending = deferred<Response>(); fetchMock.mockImplementationOnce(() => pending.promise);
    const mounted = render(<HelmRecovery {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Preview recovery" }));
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    if (dimension === "context") environment.context = "other";
    if (dimension === "offline") environment.health = "unhealthy";
    if (dimension === "unmount") mounted.unmount();
    else mounted.rerender(<HelmRecovery {...props} token={dimension === "token" ? "other" : props.token} namespace={dimension === "namespace" ? "other" : props.namespace} releaseName={dimension === "name" ? "other" : props.releaseName} open={dimension !== "close"} />);
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(response({ active: "ctx", item: preview })));
    expect(screen.queryByText("Preparing upgrade")).toBeNull();
    expect(props.onRecovered).not.toHaveBeenCalled();
  });

  it.each(["token", "context", "namespace", "name", "close", "offline", "unmount"])("ignores late POST success on %s", async (dimension) => {
    const mounted = render(<HelmRecovery {...props} />); await openPreview();
    const modal = await openConfirmation(); acknowledge(modal);
    const pending = deferred<Response>(); fetchMock.mockImplementationOnce(() => pending.promise);
    fireEvent.click(within(modal).getByRole("button", { name: "Delete history Secret" }));
    if (dimension === "context") environment.context = "other";
    if (dimension === "offline") environment.health = "unhealthy";
    if (dimension === "unmount") mounted.unmount();
    else mounted.rerender(<HelmRecovery {...props} token={dimension === "token" ? "other" : props.token} namespace={dimension === "namespace" ? "other" : props.namespace} releaseName={dimension === "name" ? "other" : props.releaseName} open={dimension !== "close"} />);
    await act(async () => pending.resolve(response({ active: "ctx", item: { status: "ok", message: "STALE success" } })));
    expect(props.onRecovered).not.toHaveBeenCalled();
    expect(screen.queryByText("STALE success")).toBeNull();
  });

  it("fails closed on mismatched server identity and allows preview retry", async () => {
    setup({ ...preview, release: "wrong" }); render(<HelmRecovery {...props} />);
      fireEvent.click(screen.getByRole("button", { name: "Preview recovery" }));
    await screen.findByText(/preview identity mismatch/);
    expect(screen.queryByRole("button", { name: "Review history Secret deletion" })).toBeNull();
    setup(); fireEvent.click(screen.getByRole("button", { name: "Preview recovery" }));
    await screen.findByText("Preparing upgrade");
  });
});
