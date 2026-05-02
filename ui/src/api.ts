import { notifyApiFailure, notifyApiSuccess, type ConnectionIssueKind } from "./connectionState";

export type ContextInfo = {
  name: string;
  cluster: string;
  authInfo: string;
  namespace?: string;
};

export type ApiError = { status?: number; message: string; details?: unknown };

type ApiErrorShape = { status?: number; message: string };

let defaultApiContext = "";

export function setApiDefaultContext(contextName: string) {
  defaultApiContext = contextName.trim();
}

function mergeRequestHeaders(headers?: Record<string, string>, opts?: { useDefaultContext?: boolean }) {
  const merged = { ...(headers || {}) };
  if (opts?.useDefaultContext !== false && defaultApiContext && !merged["X-Kview-Context"]) {
    merged["X-Kview-Context"] = defaultApiContext;
  }
  return merged;
}

// API error envelope: backend sends either top-level "message" or "error" (string),
// or structured "error": { "code", "message" } for mutations. We extract message for consistent display.
function extractJsonMessage(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload === "string") return payload;
  if (typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const candidates = [
    record.message,
    record.error,
    record.detail,
    record.reason,
    record.status,
    record.statusMessage,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c;
  }
  if (record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string" && nested.message.trim()) return nested.message;
  }
  return null;
}

function stripHtml(input: string): string {
  const withoutTags = input.replace(/<[^>]*>/g, " ");
  return withoutTags.replace(/\s+/g, " ").trim();
}

function classifyFailureKind(status?: number, error?: unknown): ConnectionIssueKind {
  if (status && [502, 503, 504].includes(status)) return "backend";
  if (status) return "request";
  const message = typeof error === "string" ? error : (error as Error | undefined)?.message || "";
  const lower = message.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("networkerror") ||
    lower.includes("connection refused") ||
    lower.includes("load failed") ||
    lower.includes("timeout")
  ) {
    return "backend";
  }
  return "backend";
}

async function parseErrorResponse(res: Response): Promise<ApiErrorShape> {
  const status = res.status || undefined;
  let text = "";
  try {
    text = await res.text();
  } catch {
    text = "";
  }
  const raw = text.trim();
  if (raw) {
    const looksJson =
      res.headers.get("content-type")?.includes("application/json") ||
      raw.startsWith("{") ||
      raw.startsWith("[");
    if (looksJson) {
      try {
        const parsed = JSON.parse(raw);
        const msg = extractJsonMessage(parsed);
        if (msg) return normalizeAccessDenied({ status, message: msg });
      } catch {
        // fall through to raw handling
      }
    }
    const looksHtml = /<\s*html/i.test(raw) || /<!doctype/i.test(raw) || /<\s*body/i.test(raw);
    if (looksHtml) {
      const stripped = stripHtml(raw);
      if (stripped) return normalizeAccessDenied({ status, message: stripped });
    }
    return normalizeAccessDenied({ status, message: raw });
  }
  const fallback = res.statusText || String(res.status || "");
  return normalizeAccessDenied({ status, message: fallback });
}

function toError(shape: ApiErrorShape): Error {
  const err = new Error(shape.message);
  (err as Error & { status?: number }).status = shape.status;
  return err;
}

function normalizeAccessDenied(shape: ApiErrorShape): ApiErrorShape {
  const status = shape.status;
  if (status !== 400 || !shape.message) return shape;
  const msg = shape.message.toLowerCase();
  if (msg.includes("not allowed") || msg.includes("forbidden")) {
    return { ...shape, status: 403 };
  }
  return shape;
}

function shouldNotifyFailure(shape: ApiErrorShape): boolean {
  // RBAC / auth failures and expected resource-level responses belong in the
  // view that requested them. Reserve global toasts for likely infrastructure
  // or service-side failures.
  if (!shape.status) return true;
  if (shape.status === 408 || shape.status === 429) return true;
  return shape.status >= 500;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown };
  return record.name === "AbortError";
}

export function toApiError(error: unknown): ApiError {
  if (error && typeof error === "object") {
    const record = error as { status?: unknown; message?: unknown };
    const status = typeof record.status === "number" ? record.status : undefined;
    const message =
      typeof record.message === "string" && record.message.trim() ? record.message : String(error);
    return { status, message, details: error };
  }
  if (typeof error === "string" && error.trim()) {
    return { message: error };
  }
  return { message: "Unknown error", details: error };
}

export async function apiGet<T>(
  path: string,
  token: string,
  opts?: { headers?: Record<string, string>; signal?: AbortSignal; useDefaultContext?: boolean },
): Promise<T> {
  let res: Response;
  // Prefer Authorization header; do not put token in query string (see WebSocket paths for query fallback).
  const mergedHeaders = {
    Authorization: `Bearer ${token}`,
    ...mergeRequestHeaders(opts?.headers, { useDefaultContext: opts?.useDefaultContext }),
  };
  try {
    res = await fetch(path, {
      headers: mergedHeaders,
      signal: opts?.signal,
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    notifyApiFailure("backend", String((err as Error | undefined)?.message || err || "Network error"));
    throw err;
  }
  if (!res.ok) {
    const shape = await parseErrorResponse(res);
    if (shouldNotifyFailure(shape)) {
      notifyApiFailure(classifyFailureKind(shape.status, shape.message), shape.message || res.statusText);
    }
    throw toError(shape);
  }
  try {
    const json = await res.json();
    notifyApiSuccess();
    return json;
  } catch (err) {
    notifyApiFailure("request", "Failed to parse response");
    throw err;
  }
}

export async function apiPost<T>(path: string, token: string, body: unknown, opts?: { headers?: Record<string, string> }): Promise<T> {
  let res: Response;
  const mergedHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    ...mergeRequestHeaders(opts?.headers),
  };
  try {
    res = await fetch(path, {
      method: "POST",
      headers: mergedHeaders,
      body: JSON.stringify(body),
    });
  } catch (err) {
    notifyApiFailure("backend", String((err as Error | undefined)?.message || err || "Network error"));
    throw err;
  }
  if (!res.ok) {
    const shape = await parseErrorResponse(res);
    if (shouldNotifyFailure(shape)) {
      notifyApiFailure(classifyFailureKind(shape.status, shape.message), shape.message || res.statusText);
    }
    throw toError(shape);
  }
  try {
    const json = await res.json();
    notifyApiSuccess();
    return json;
  } catch (err) {
    notifyApiFailure("request", "Failed to parse response");
    throw err;
  }
}

export async function apiGetWithContext<T>(
  path: string,
  token: string,
  contextName: string,
  opts?: { signal?: AbortSignal },
): Promise<T> {
  if (!contextName) return apiGet<T>(path, token, { signal: opts?.signal, useDefaultContext: false });
  return apiGet<T>(path, token, { headers: { "X-Kview-Context": contextName }, signal: opts?.signal });
}

export async function apiPostWithContext<T>(path: string, token: string, contextName: string, body: unknown): Promise<T> {
  if (!contextName) throw new Error("Missing active context");
  return apiPost<T>(path, token, body, { headers: { "X-Kview-Context": contextName } });
}
