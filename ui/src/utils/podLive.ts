export type PodLiveUpdate = {
  context: string;
  namespace: string;
  state: "starting" | "live" | "reconnecting" | "blocked" | "stopped";
  revision: number;
  stale: boolean;
  observedAt?: string;
  resourceVersion?: string;
  reason?: string;
};

export class PodLiveError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

const maxFrame = 64 * 1024;

/** Header-authenticated, bounded SSE consumer. Never resolves a default context. */
export async function apiSubscribePods(token: string, contextName: string, namespace: string, signal: AbortSignal, onUpdate: (update: PodLiveUpdate) => void): Promise<void> {
  if (!token || !contextName || contextName.trim() !== contextName || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63) {
    throw new PodLiveError("Live requires an exact context and namespace");
  }
  const response = await fetch(`/api/namespaces/${encodeURIComponent(namespace)}/pods/live`, {
    headers: { Authorization: `Bearer ${token}`, "X-Kview-Context": contextName, Accept: "text/event-stream" },
    signal, cache: "no-store",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new PodLiveError(`Live unavailable (${response.status})`, response.status === 429 || response.status >= 500);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    await response.body?.cancel();
    throw new PodLiveError("Invalid Live stream");
  }
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";
  let data = "";
  let frameSize = 0;
  const line = (text: string) => {
    frameSize += text.length;
    if (frameSize > maxFrame) throw new PodLiveError("Live frame too large");
    if (!text) {
      if (event === "pods" && data) {
        let value: unknown;
        try { value = JSON.parse(data); } catch { throw new PodLiveError("Invalid Live payload"); }
        const u = value as PodLiveUpdate | null;
        if (!u || u.context !== contextName || u.namespace !== namespace || !["starting", "live", "reconnecting", "blocked", "stopped"].includes(u.state) || !Number.isSafeInteger(u.revision) || u.revision < 0 || typeof u.stale !== "boolean" || [u.reason, u.observedAt, u.resourceVersion].some((v) => v !== undefined && typeof v !== "string")) {
          throw new PodLiveError("Invalid Live identity or payload");
        }
        if (!signal.aborted) onUpdate(u);
      }
      event = ""; data = ""; frameSize = 0;
    } else if (text.startsWith("event:")) event = text.slice(6).trim();
    else if (text.startsWith("data:")) data += `${text.slice(5).replace(/^ /, "")}\n`;
  };
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end).replace(/\r$/, ""));
        buffer = buffer.slice(end + 1);
      }
      if (buffer.length + frameSize > maxFrame) throw new PodLiveError("Live frame too large");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
