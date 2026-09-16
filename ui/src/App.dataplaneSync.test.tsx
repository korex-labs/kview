// @vitest-environment jsdom

import React, { StrictMode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataplaneSettingsSync } from "./App";
import { ActiveContextProvider } from "./activeContext";
import { defaultUserSettings } from "./settings";

const mocks = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn(), changed: vi.fn() }));
let settings = defaultUserSettings();
vi.mock("./settingsContext", async (original) => ({
  ...await original<typeof import("./settingsContext")>(),
  useUserSettings: () => ({ settings }),
}));
vi.mock("./api", async (original) => ({
  ...await original<typeof import("./api")>(),
  apiPost: mocks.post,
  apiGetWithContext: mocks.get,
}));
vi.mock("./signalExclusions", async (original) => ({
  ...await original<typeof import("./signalExclusions")>(),
  dispatchSignalExclusionsChanged: mocks.changed,
}));

function deferred() {
  let resolve!: (value: object) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<object>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function sync(context = "", token = "token-a") {
  return <StrictMode><ActiveContextProvider value={context}><DataplaneSettingsSync token={token} /></ActiveContextProvider></StrictMode>;
}
async function debounce() {
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
}
beforeEach(() => {
  vi.useFakeTimers();
  settings = defaultUserSettings();
  mocks.post.mockReset().mockResolvedValue({});
  mocks.get.mockReset().mockResolvedValue({});
  mocks.changed.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("DataplaneSettingsSync", () => {
  it("does not overlap or repeat the bundle when bootstrap selects a context after the debounce", async () => {
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    const view = render(sync());
    await debounce();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    view.rerender(sync("ctx-a"));
    await debounce();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({}));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    settings = structuredClone(settings);
    view.rerender(sync("ctx-b"));
    await debounce();
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("serializes real edits and coalesces queued changes to the latest complete bundle", async () => {
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    const view = render(sync());
    await debounce();
    settings = { ...settings, appearance: { ...settings.appearance, dashboardRefreshSec: 30 } };
    view.rerender(sync("ctx-a"));
    await debounce();
    settings = { ...settings, appearance: { ...settings.appearance, dashboardRefreshSec: 60 } };
    settings.dataplane = { ...settings.dataplane, contextOverrides: { "ctx-b": { metrics: { enabled: false } } } };
    view.rerender(sync("ctx-b"));
    await debounce();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({}));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[1][2]).toMatchObject({ global: { dashboard: { refreshSec: 60 } }, contextOverrides: { "ctx-b": { metrics: { enabled: false } } } });
  });

  it("drops a queued edit reverted to the in-flight bundle", async () => {
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    const view = render(sync());
    await debounce();
    const original = settings;
    settings = { ...settings, appearance: { ...settings.appearance, dashboardRefreshSec: 60 } };
    view.rerender(sync());
    await debounce();
    settings = original;
    view.rerender(sync());
    await debounce();
    await act(async () => pending.resolve({}));
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("restores an earlier bundle after a different write, even if that write fails", async () => {
    const view = render(sync());
    await debounce();
    const original = settings;
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    settings = { ...settings, appearance: { ...settings.appearance, dashboardRefreshSec: 60 } };
    view.rerender(sync());
    await debounce();
    settings = original;
    view.rerender(sync());
    await debounce();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    await act(async () => pending.reject(new Error("response lost")));
    expect(mocks.post).toHaveBeenCalledTimes(3);
    expect(mocks.post.mock.calls[2][2]).toEqual(mocks.post.mock.calls[0][2]);
  });

  it("retries a queued identical bundle after the in-flight request fails", async () => {
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    const view = render(sync());
    await debounce();
    view.rerender(sync("ctx-a"));
    await debounce();
    await act(async () => pending.reject(new Error("unavailable")));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.changed).toHaveBeenCalledTimes(1);
  });

  it("does not mark errors as synced and retries on the next sync trigger", async () => {
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    const view = render(sync());
    await debounce();
    await act(async () => pending.reject(new Error("unavailable")));
    expect(mocks.changed).not.toHaveBeenCalled();
    view.rerender(sync("ctx-a"));
    await debounce();
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.changed).toHaveBeenCalledTimes(1);
  });

  it("keeps token identity and serializes a new credential's sync", async () => {
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    const view = render(sync("ctx-a"));
    await debounce();
    view.rerender(sync("ctx-a", "token-b"));
    await debounce();
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({}));
    expect(mocks.post).toHaveBeenCalledTimes(2);
    expect(mocks.post.mock.calls[1][1]).toBe("token-b");
  });

  it("warms the current context's effective sweep policy without resending the global bundle", async () => {
    settings.dataplane.global.namespaceEnrichment.enabled = true;
    settings.dataplane.global.namespaceEnrichment.sweep.enabled = false;
    settings.dataplane.contextOverrides["ctx-a"] = {
      namespaceEnrichment: {
        ...settings.dataplane.global.namespaceEnrichment,
        sweep: { ...settings.dataplane.global.namespaceEnrichment.sweep, enabled: true },
      },
    };
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    const view = render(sync());
    await debounce();
    view.rerender(sync("ctx-a"));
    await debounce();
    expect(mocks.get).not.toHaveBeenCalled();
    await act(async () => pending.resolve({}));
    expect(mocks.get).toHaveBeenCalledWith("/api/namespaces", "token-a", "ctx-a");
    view.rerender(sync("ctx-b"));
    await debounce();
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("discards queued work and completion effects on unmount but syncs again on a fresh mount", async () => {
    const pending = deferred();
    mocks.post.mockReturnValueOnce(pending.promise);
    const view = render(sync());
    await debounce();
    settings = { ...settings, appearance: { ...settings.appearance, dashboardRefreshSec: 60 } };
    view.rerender(sync("ctx-a"));
    await debounce();
    view.unmount();
    await act(async () => pending.resolve({}));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.changed).not.toHaveBeenCalled();
    render(sync("ctx-a"));
    await debounce();
    expect(mocks.post).toHaveBeenCalledTimes(2);
  });
});
