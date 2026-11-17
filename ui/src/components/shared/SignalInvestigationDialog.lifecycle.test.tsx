// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiPost } from "../../api";
import { ActiveContextProvider } from "../../activeContext";
import type { DashboardSignalItem, SignalInvestigationResult } from "../../types/api";
import SignalInvestigationDialog from "./SignalInvestigationDialog";
import { buildInvestigationSnapshot } from "../../investigationSnapshots";

vi.mock("../../api", () => ({ apiPost: vi.fn() }));
vi.mock("./CodeBlock", () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
const signal = { kind: "Pod", resourceName: "example", namespace: "fixture", reason: "Test signal", severity: "high" } as DashboardSignalItem;
function bundle(summary: string): SignalInvestigationResult {
  return { signal, diagnosis: { summary, confidence: "low", evidence: [], nextSteps: [], unknowns: [] },
    primaryResource: { kind: "Pod", name: "example", relation: "primary" }, generatedAt: 1, exportMarkdown: "" };
}
function pending() {
  let resolve!: (value: { item: SignalInvestigationResult }) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<{ item: SignalInvestigationResult }>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const view = (context: string, item: DashboardSignalItem | null = signal, token = "fixture-token", close = vi.fn()) =>
  <ActiveContextProvider value={context}><SignalInvestigationDialog token={token} signal={item} onClose={close} /></ActiveContextProvider>;

it("does not start work while closed and cancels live work when switching to a saved bundle", async () => {
  const request = pending();
  vi.mocked(apiPost).mockReturnValue(request.promise);
  const mounted = render(view("context-a", null));
  expect(apiPost).not.toHaveBeenCalled();
  mounted.rerender(view("context-a"));
  const options = vi.mocked(apiPost).mock.calls[0][3];
  mounted.rerender(<ActiveContextProvider value="context-a"><SignalInvestigationDialog token="fixture-token" signal={null}
    snapshot={buildInvestigationSnapshot(bundle("Saved diagnosis"))} onClose={vi.fn()} /></ActiveContextProvider>);
  expect(options?.signal?.aborted).toBe(true);
  await act(async () => { request.resolve({ item: bundle("Obsolete live diagnosis") }); });
  expect(screen.queryByText("Obsolete live diagnosis")).toBeNull();
  expect(screen.getByText("Saved diagnosis")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(apiPost).toHaveBeenCalledTimes(1);
});

it("settles successful completion without creating an Activity record", async () => {
  const request = pending();
  vi.mocked(apiPost).mockReturnValue(request.promise);
  await act(async () => { render(view("context-a")); });
  expect(screen.getByRole("progressbar")).toBeTruthy();
  await act(async () => { request.resolve({ item: bundle("Completed diagnosis") }); });
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText("Completed diagnosis")).toBeTruthy();
  expect(apiPost).toHaveBeenCalledTimes(1);
});

it.each(["Request failed", "Request timed out", "AbortError"])("settles rejection: %s", async (message) => {
  const request = pending();
  vi.mocked(apiPost).mockReturnValue(request.promise);
  await act(async () => { render(view("context-a")); });
  await act(async () => { request.reject(new Error(message)); });
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText(`Could not build investigation bundle: ${message}`)).toBeTruthy();
});

it.each(["signal", "context", "token"])("aborts obsolete %s requests and rejects late completion/error publication", async (change) => {
  const old = pending(); const current = pending();
  vi.mocked(apiPost).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const mounted = render(view("context-a"));
  const oldOptions = vi.mocked(apiPost).mock.calls[0][3];
  mounted.rerender(view(change === "context" ? "context-b" : "context-a", change === "signal" ? { ...signal, resourceName: "other" } : signal,
    change === "token" ? "replacement-token" : "fixture-token"));
  expect(oldOptions?.signal?.aborted).toBe(true);
  expect(apiPost).toHaveBeenCalledTimes(2);
  expect(vi.mocked(apiPost).mock.calls[1][3]?.headers?.["X-Kview-Context"]).toBe(change === "context" ? "context-b" : "context-a");
  await act(async () => { old.resolve({ item: bundle("Obsolete result") }); });
  expect(screen.queryByText("Obsolete result")).toBeNull();
  expect(screen.getByRole("progressbar")).toBeTruthy();
  await act(async () => { current.resolve({ item: bundle("Current result") }); });
  expect(screen.getByText("Current result")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("ignores an old rejection while the replacement stays loading", async () => {
  const old = pending(); const current = pending();
  vi.mocked(apiPost).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  const mounted = render(view("context-a"));
  mounted.rerender(view("context-a", { ...signal, resourceName: "other" }));
  await act(async () => { old.reject(new Error("Obsolete failure")); });
  expect(screen.queryByText(/Obsolete failure/)).toBeNull();
  expect(screen.getByRole("progressbar")).toBeTruthy();
  mounted.unmount();
  expect(vi.mocked(apiPost).mock.calls[1][3]?.signal?.aborted).toBe(true);
});

it.each(["close", "unmount", "disabled"])("aborts on %s without a late error", async (action) => {
  const request = pending();
  vi.mocked(apiPost).mockReturnValue(request.promise);
  const onClose = vi.fn();
  const mounted = render(view("context-a", signal, "fixture-token", onClose));
  const options = vi.mocked(apiPost).mock.calls[0][3];
  if (action === "close") {
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    mounted.rerender(view("context-a", null));
  } else if (action === "disabled") mounted.rerender(view("context-a", signal, ""));
  else mounted.unmount();
  expect(options?.signal?.aborted).toBe(true);
  await act(async () => { request.reject(new DOMException("Aborted", "AbortError")); });
  expect(screen.queryByText(/Could not build investigation bundle/)).toBeNull();
  expect(screen.queryByRole("progressbar")).toBeNull();
});
