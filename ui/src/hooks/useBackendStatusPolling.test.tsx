// @vitest-environment jsdom

import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import useBackendStatusPolling from "./useBackendStatusPolling";

const connectionMocks = vi.hoisted(() => ({
  notifyApiFailure: vi.fn(),
  notifyStatus: vi.fn(),
}));

const performanceMocks = vi.hoisted(() => ({
  enabled: vi.fn(() => false),
  recordApiTiming: vi.fn(),
}));

vi.mock("../connectionState", () => ({
  notifyApiFailure: connectionMocks.notifyApiFailure,
  notifyStatus: connectionMocks.notifyStatus,
}));

vi.mock("../utils/performanceDiagnostics", () => ({
  performanceDiagnosticsEnabled: performanceMocks.enabled,
  recordApiTiming: performanceMocks.recordApiTiming,
}));

type PollingOptions = Parameters<typeof useBackendStatusPolling>[0];

const defaultOptions: PollingOptions = {
  token: "status-token",
  activeContext: "",
  backendHealth: "healthy",
  pageVisible: true,
  retryNonce: 0,
  settingsOpen: false,
};

const statusPayload = {
  ok: true,
  activeContext: "test-context",
  backend: { ok: true, version: "test" },
  cluster: { ok: true, context: "test-context" },
  checkedAt: "2026-07-30T00:00:00Z",
};

function Harness(props: PollingOptions) {
  useBackendStatusPolling(props);
  return null;
}

function response(status = 200, body = JSON.stringify(statusPayload), statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

async function flushPolling() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  connectionMocks.notifyApiFailure.mockReset();
  connectionMocks.notifyStatus.mockReset();
  performanceMocks.enabled.mockReset().mockReturnValue(false);
  performanceMocks.recordApiTiming.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response()));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useBackendStatusPolling", () => {
  it.each([
    { settingsOpen: false, backendHealth: "healthy" as const, intervalMs: 5000 },
    { settingsOpen: true, backendHealth: "unhealthy" as const, intervalMs: 5000 },
    { settingsOpen: true, backendHealth: "healthy" as const, intervalMs: 30000 },
  ])("polls immediately and every $intervalMs ms", async ({ settingsOpen, backendHealth, intervalMs }) => {
    render(<Harness {...defaultOptions} settingsOpen={settingsOpen} backendHealth={backendHealth} />);

    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(intervalMs - 1);
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not overlap status requests when a poll is still in flight", async () => {
    let resolveFirst!: (value: Response) => void;
    let callCount = 0;
    vi.mocked(fetch).mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve(response());
    });

    render(<Harness {...defaultOptions} />);
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveFirst(response());
    await flushPolling();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sends authentication and context headers, reports timing, and publishes successful status", async () => {
    const body = JSON.stringify(statusPayload);
    vi.mocked(fetch).mockResolvedValue(response(200, body));
    performanceMocks.enabled.mockReturnValue(true);
    vi.spyOn(window.performance, "now")
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(120)
      .mockReturnValueOnce(125)
      .mockReturnValueOnce(130);

    render(<Harness {...defaultOptions} activeContext="test-context" />);
    await flushPolling();

    expect(fetch).toHaveBeenCalledWith("/api/status", {
      signal: expect.any(AbortSignal),
      headers: {
        Authorization: "Bearer status-token",
        "X-Kview-Context": "test-context",
      },
    });
    expect(connectionMocks.notifyStatus).toHaveBeenCalledWith(statusPayload);
    expect(performanceMocks.recordApiTiming).toHaveBeenCalledWith({
      method: "GET",
      path: "/api/status",
      durationMs: 25,
      parseMs: 10,
      bytes: body.length,
      ok: true,
      status: 200,
    });
  });

  it.each([
    { status: 503, statusText: "Service Unavailable", kind: "backend" },
    { status: 401, statusText: "Unauthorized", kind: "request" },
  ])("classifies HTTP $status as a $kind failure", async ({ status, statusText, kind }) => {
    vi.mocked(fetch).mockResolvedValue(response(status, "", statusText));

    render(<Harness {...defaultOptions} />);
    await flushPolling();

    expect(connectionMocks.notifyApiFailure).toHaveBeenCalledWith(kind, statusText);
    expect(connectionMocks.notifyStatus).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "network",
      arrange: () => vi.mocked(fetch).mockRejectedValue(new Error("connection refused")),
      message: "connection refused",
    },
    {
      name: "parse",
      arrange: () => vi.mocked(fetch).mockResolvedValue(response(200, "not json")),
      message: "Unexpected token",
    },
  ])("classifies $name failures as backend failures", async ({ arrange, message }) => {
    arrange();

    render(<Harness {...defaultOptions} />);
    await flushPolling();

    expect(connectionMocks.notifyApiFailure).toHaveBeenCalledWith("backend", expect.stringContaining(message));
    expect(connectionMocks.notifyStatus).not.toHaveBeenCalled();
  });

  it("does not poll while the page is hidden", async () => {
    render(<Harness {...defaultOptions} pageVisible={false} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the interval and ignores an in-flight result after cleanup", async () => {
    let resolveFetch!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    }));

    const { unmount } = render(<Harness {...defaultOptions} />);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    const requestSignal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal;
    expect(requestSignal?.aborted).toBe(false);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(requestSignal?.aborted).toBe(true);
    resolveFetch(response());
    await flushPolling();

    expect(connectionMocks.notifyStatus).not.toHaveBeenCalled();
    expect(connectionMocks.notifyApiFailure).not.toHaveBeenCalled();
  });
});
