import { afterEach, describe, expect, it, vi } from "vitest";
import { apiGet, apiGetWithContext, apiPost, apiPostWithContext, setApiDefaultContext, toApiError } from "./api";
import { getConnectionState, notifyStatus } from "./connectionState";

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function resetConnectionState() {
  notifyStatus({
    ok: true,
    activeContext: "ctx",
    backend: { ok: true, version: "test" },
    cluster: { ok: true, context: "ctx" },
    checkedAt: new Date(0).toISOString(),
  });
}

describe("api helpers", () => {
  afterEach(() => {
    setApiDefaultContext("");
    vi.unstubAllGlobals();
    resetConnectionState();
  });

  it("apiGet sends the bearer token and parses JSON responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiGet<{ ok: boolean }>("/api/status", "secret-token")).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("/api/status", {
      headers: { Authorization: "Bearer secret-token" },
      signal: undefined,
    });
  });

  it("context helpers add X-Kview-Context only when needed", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    await apiGetWithContext("/api/pods", "token", "kind-prod");
    await apiGetWithContext("/api/pods", "token", "");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/pods", {
      headers: { Authorization: "Bearer token", "X-Kview-Context": "kind-prod" },
      signal: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/pods", {
      headers: { Authorization: "Bearer token" },
      signal: undefined,
    });
  });

  it("apiGet sends the default context unless a caller overrides or suppresses it", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    setApiDefaultContext("kind-dev");

    await apiGet("/api/pods", "token");
    await apiGet("/api/pods", "token", { headers: { "X-Kview-Context": "kind-prod" } });
    await apiGet("/api/pods", "token", { useDefaultContext: false });

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/pods", {
      headers: { Authorization: "Bearer token", "X-Kview-Context": "kind-dev" },
      signal: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/pods", {
      headers: { Authorization: "Bearer token", "X-Kview-Context": "kind-prod" },
      signal: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/pods", {
      headers: { Authorization: "Bearer token" },
      signal: undefined,
    });
  });

  it("apiPost serializes JSON and requires context for context posts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ created: true }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiPost("/api/actions", "token", { action: "restart" })).resolves.toEqual({ created: true });
    await expect(apiPostWithContext("/api/actions", "token", "", {})).rejects.toThrow("Missing active context");

    expect(fetchMock).toHaveBeenCalledWith("/api/actions", {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restart" }),
    });
  });

  it("extracts structured API error messages and preserves status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { message: "cannot restart pod" } }, { status: 422, statusText: "Unprocessable Entity" }),
      ),
    );

    await expect(apiGet("/api/fail", "token")).rejects.toMatchObject({
      message: "cannot restart pod",
      status: 422,
    });
  });

  it("normalizes forbidden-looking 400 responses to 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ message: "user is not allowed to list pods" }, { status: 400 })),
    );

    await expect(apiGet("/api/pods", "token")).rejects.toMatchObject({
      message: "user is not allowed to list pods",
      status: 403,
    });
  });

  it("strips HTML error responses before throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<html><body><h1>Bad Gateway</h1><p>upstream failed</p></body></html>", {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "content-type": "text/html" },
        }),
      ),
    );

    await expect(apiGet("/api/status", "token")).rejects.toMatchObject({
      message: "Bad Gateway upstream failed",
      status: 502,
    });
    expect(getConnectionState().backendHealth).toBe("unhealthy");
  });

  it("does not turn aborted requests into backend failures", async () => {
    resetConnectionState();
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(apiGet("/api/status", "token")).rejects.toBe(abort);
    expect(getConnectionState().backendHealth).toBe("healthy");
  });

  it("toApiError normalizes unknown thrown values", () => {
    expect(toApiError("boom")).toEqual({ message: "boom" });
    expect(toApiError(null)).toMatchObject({ message: "Unknown error" });
    expect(toApiError(Object.assign(new Error("failed"), { status: 500 }))).toMatchObject({
      message: "failed",
      status: 500,
    });
  });
});
