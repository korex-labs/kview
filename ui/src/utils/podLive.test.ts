import { afterEach, describe, expect, it, vi } from "vitest";
import { apiSubscribePods, PodLiveError } from "./podLive";
const update = { context: "ctx", namespace: "app", state: "live", revision: 4, stale: false };
const frame = (value: unknown) => `event: pods\r\ndata: ${JSON.stringify(value)}\r\n\r\n`;
function response(chunks: string[]) {
  return new Response(new ReadableStream({ start(c) { chunks.forEach((s) => c.enqueue(new TextEncoder().encode(s))); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
}
afterEach(() => vi.unstubAllGlobals());
describe("Pod Live stream", () => {
  it("decodes fragmented frames/comments and authenticates only in exact headers", async () => {
    const text = `: heartbeat\n\n${frame(update)}${frame({ ...update, revision: 5 })}`;
    const fetcher = vi.fn().mockResolvedValue(response([...text]));
    vi.stubGlobal("fetch", fetcher);
    const onUpdate = vi.fn();
    const signal = new AbortController().signal;
    await apiSubscribePods("secret", "ctx", "app", signal, onUpdate);
    expect(fetcher).toHaveBeenCalledWith("/api/namespaces/app/pods/live", expect.objectContaining({ signal, headers: { Authorization: "Bearer secret", "X-Kview-Context": "ctx", Accept: "text/event-stream" } }));
    expect(onUpdate.mock.calls.map(([v]) => v.revision)).toEqual([4, 5]);
  });
  it.each([{ ...update, context: "other" }, { ...update, namespace: "other" }, { ...update, revision: "4" }, { ...update, stale: 1 }, { ...update, state: "connected" }])("rejects malformed or wrong-identity payload %j", async (value) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response([frame(value)])));
    const callback = vi.fn();
    await expect(apiSubscribePods("secret", "ctx", "app", new AbortController().signal, callback)).rejects.toBeInstanceOf(PodLiveError);
    expect(callback).not.toHaveBeenCalled();
  });
  it("bounds unterminated frames", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(["data: " + "x".repeat(65536)])));
    await expect(apiSubscribePods("secret", "ctx", "app", new AbortController().signal, vi.fn())).rejects.toThrow("too large");
  });
  it("cancels a blocked reader and never delivers after abort", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/event-stream" } })));
    const controller = new AbortController();
    const callback = vi.fn();
    const pending = apiSubscribePods("secret", "ctx", "app", controller.signal, callback);
    await Promise.resolve();
    controller.abort();
    await pending;
    expect(cancel).toHaveBeenCalledOnce();
    expect(callback).not.toHaveBeenCalled();
  });
  it("treats access denial as terminal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));
    await expect(apiSubscribePods("secret", "ctx", "app", new AbortController().signal, vi.fn())).rejects.toMatchObject({ retryable: false });
  });
});
