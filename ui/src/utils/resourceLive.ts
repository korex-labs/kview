/** Explicit transport allowlist; availability is not table enablement. */
export const resourceLiveDescriptors = {
  pods: { event: "pods", scope: "Namespaced" },
  deployments: { event: "resource", scope: "Namespaced" },
  statefulsets: { event: "resource", scope: "Namespaced" },
  daemonsets: { event: "resource", scope: "Namespaced" },
  replicasets: { event: "resource", scope: "Namespaced" },
  jobs: { event: "resource", scope: "Namespaced" },
  cronjobs: { event: "resource", scope: "Namespaced" },
} as const;
export type LiveResource = keyof typeof resourceLiveDescriptors;

export type ResourceLiveUpdate = {
  resource?: LiveResource;
  scope?: "Namespaced";
  context: string;
  namespace: string;
  state: "starting" | "live" | "reconnecting" | "blocked" | "stopped";
  revision: number;
  stale: boolean;
  observedAt?: string;
  resourceVersion?: string;
  reason?: string;
};

export class ResourceLiveError extends Error {
  constructor(message: string, readonly retryable = false) { super(message); }
}

const maxFrame = 64 * 1024;

/** Header-authenticated, bounded SSE consumer. Never resolves a default context. */
export async function apiSubscribeResource(token: string, contextName: string, namespace: string, resource: LiveResource, signal: AbortSignal, onUpdate: (update: ResourceLiveUpdate) => void): Promise<void> {
  if (!Object.prototype.hasOwnProperty.call(resourceLiveDescriptors, resource)) throw new ResourceLiveError("Unsupported Live resource");
  const descriptor = resourceLiveDescriptors[resource];
  if (!token || !contextName || contextName.trim() !== contextName || !/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/.test(namespace) || namespace.length > 63) {
    throw new ResourceLiveError("Live requires an exact context and namespace");
  }
  const response = await fetch(`/api/namespaces/${encodeURIComponent(namespace)}/${resource}/live`, {
    headers: { Authorization: `Bearer ${token}`, "X-Kview-Context": contextName, Accept: "text/event-stream" },
    signal, cache: "no-store",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ResourceLiveError(`Live unavailable (${response.status})`, response.status === 429 || response.status >= 500);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
    await response.body?.cancel();
    throw new ResourceLiveError("Invalid Live stream");
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
    if (frameSize > maxFrame) throw new ResourceLiveError("Live frame too large");
    if (!text) {
      if (event === descriptor.event && data) {
        let value: unknown;
        try { value = JSON.parse(data); } catch { throw new ResourceLiveError("Invalid Live payload"); }
        const u = value as ResourceLiveUpdate | null;
        if (!u || u.context !== contextName || u.namespace !== namespace || (resource !== "pods" && (u.resource !== resource || u.scope !== descriptor.scope)) || !["starting", "live", "reconnecting", "blocked", "stopped"].includes(u.state) || !Number.isSafeInteger(u.revision) || u.revision < 0 || typeof u.stale !== "boolean" || [u.reason, u.observedAt, u.resourceVersion].some((v) => v !== undefined && typeof v !== "string")) {
          throw new ResourceLiveError("Invalid Live identity or payload");
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
      if (buffer.length + frameSize > maxFrame) throw new ResourceLiveError("Live frame too large");
    }
  } finally {
    signal.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
