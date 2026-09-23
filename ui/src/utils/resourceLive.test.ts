import { afterEach, expect, it, vi } from "vitest";
import { apiSubscribeResource, resourceLiveDescriptors, type LiveResource } from "./resourceLive";
const resources: LiveResource[] = ["pods", "deployments", "statefulsets", "daemonsets", "replicasets", "jobs", "cronjobs"];
afterEach(() => vi.unstubAllGlobals());
function response(event: string, payload: unknown) {
  return new Response(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`, { headers: { "content-type": "text/event-stream" } });
}
it.each(resources)("subscribes to allowlisted %s with exact headers and unchanged revision", async (resource) => {
  const descriptor = resourceLiveDescriptors[resource];
  const payload = { context: "ctx", namespace: "app", state: "live", revision: 7, stale: false, ...(resource === "pods" ? {} : { resource, scope: "Namespaced" }) };
  const fetcher = vi.fn().mockResolvedValue(response(descriptor.event, payload));
  vi.stubGlobal("fetch", fetcher);
  const callback = vi.fn();
  const signal = new AbortController().signal;
  await apiSubscribeResource("secret", "ctx", "app", resource, signal, callback);
  expect(fetcher).toHaveBeenCalledWith(`/api/namespaces/app/${resource}/live`, expect.objectContaining({ signal, headers: { Authorization: "Bearer secret", "X-Kview-Context": "ctx", Accept: "text/event-stream" } }));
  expect(callback).toHaveBeenCalledWith(payload);
});
it.each(resources.filter((r) => r !== "pods"))("rejects every identity dimension for %s", async (resource) => {
  for (const mismatch of [{ context: "other" }, { namespace: "other" }, { resource: "pods" }, { scope: "Cluster" }, { scope: undefined }, { resource: undefined }]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response("resource", { context: "ctx", namespace: "app", resource, scope: "Namespaced", state: "live", revision: 7, stale: false, ...mismatch })));
    const callback = vi.fn();
    await expect(apiSubscribeResource("secret", "ctx", "app", resource, new AbortController().signal, callback)).rejects.toThrow("identity");
    expect(callback).not.toHaveBeenCalled();
  }
});
it("rejects arbitrary resources and non-concrete namespaces before fetching", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  for (const resource of ["nodes", "../pods", "toString"]) {
    await expect(apiSubscribeResource("secret", "ctx", "app", resource as LiveResource, new AbortController().signal, vi.fn())).rejects.toThrow();
  }
  for (const namespace of ["", "*", "all namespaces", "app/other"]) {
    await expect(apiSubscribeResource("secret", "ctx", namespace, "jobs", new AbortController().signal, vi.fn())).rejects.toThrow();
  }
  for (const [token, context] of [["", "ctx"], ["secret", ""], ["secret", " ctx"]]) {
    await expect(apiSubscribeResource(token, context, "app", "jobs", new AbortController().signal, vi.fn())).rejects.toThrow();
  }
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 403, 404, 429, 500, 503])("classifies HTTP %s and releases response bodies", async (status) => {
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { status })));
  await expect(apiSubscribeResource("secret", "ctx", "app", "jobs", new AbortController().signal, vi.fn())).rejects.toMatchObject({ retryable: status === 429 || status >= 500 });
  expect(cancel).toHaveBeenCalledOnce();
});
it("decodes fragmented workload frames and ignores unrelated events", async () => {
  const payload = { context: "ctx", namespace: "app", resource: "jobs", scope: "Namespaced", state: "live", revision: 7, stale: false };
  const text = `: heartbeat\r\n\r\nevent: pods\ndata: {}\n\nevent: resource\r\ndata: ${JSON.stringify(payload)}\r\n\r\n`;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { [...text].forEach((s) => c.enqueue(new TextEncoder().encode(s))); c.close(); } }), { headers: { "content-type": "text/event-stream" } })));
  const callback = vi.fn();
  await apiSubscribeResource("secret", "ctx", "app", "jobs", new AbortController().signal, callback);
  expect(callback).toHaveBeenCalledExactlyOnceWith(payload);
});
it.each(["data: " + "x".repeat(65536), ("data: x\n").repeat(12000)])("bounds unfinished workload frames %#", async (text) => {
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text)); }, cancel }), { headers: { "content-type": "text/event-stream" } })));
  await expect(apiSubscribeResource("secret", "ctx", "app", "jobs", new AbortController().signal, vi.fn())).rejects.toThrow("too large");
  expect(cancel).toHaveBeenCalledOnce();
});
it("releases a waiting workload reader on abort without publishing", async () => {
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/event-stream" } })));
  const controller = new AbortController();
  const callback = vi.fn();
  const pending = apiSubscribeResource("secret", "ctx", "app", "jobs", controller.signal, callback);
  await Promise.resolve();
  controller.abort();
  await pending;
  expect(cancel).toHaveBeenCalledOnce();
  expect(callback).not.toHaveBeenCalled();
});
