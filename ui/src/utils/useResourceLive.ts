import { useEffect, useMemo, useState } from "react";
import { apiSubscribeResource, ResourceLiveError, type ResourceLiveUpdate, type LiveResource } from "./resourceLive";
import usePageVisible from "./usePageVisible";

export type ResourceLiveState = "off" | "starting" | "live" | "reconnecting" | "paused" | "blocked" | "stopped";
export type ResourceLiveOptions = { token: string; contextName: string; namespace: string; resource: LiveResource; enabled: boolean };
export type ResourceLiveSubscriber = (token: string, contextName: string, namespace: string, signal: AbortSignal, onUpdate: (update: ResourceLiveUpdate) => void) => Promise<void>;
export default function useResourceLive({ token, contextName, namespace, resource, enabled }: ResourceLiveOptions, subscribe?: ResourceLiveSubscriber) {
  const visible = usePageVisible();
  // Referential identity also separates disable/re-enable and hidden/resume generations.
  const identity = useMemo(() => ({ token, contextName, namespace, resource, enabled, visible }), [token, contextName, namespace, resource, enabled, visible]);
  const [result, setResult] = useState<{ identity?: object; state: ResourceLiveState; update?: ResourceLiveUpdate }>({ state: "off" });
  useEffect(() => {
    if (!enabled || !visible) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let terminal = false;
    setResult({ identity, state: "starting" });
    const connect = async () => {
      try {
        const onUpdate = (update: ResourceLiveUpdate) => {
          if (controller.signal.aborted) return;
          if (update.state === "blocked" || update.state === "stopped") {
            terminal = true;
            controller.abort();
          }
          if (update.state === "live" && update.revision > 0 && !update.stale) failures = 0;
          setResult({ identity, state: update.state === "live" && (!update.revision || update.stale) ? "starting" : update.state, update });
        };
        await (subscribe ? subscribe(token, contextName, namespace, controller.signal, onUpdate) : apiSubscribeResource(token, contextName, namespace, resource, controller.signal, onUpdate));
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ResourceLiveError && !error.retryable) {
          terminal = true;
          setResult({ identity, state: "blocked" });
        }
      }
      if (controller.signal.aborted || terminal) return;
      setResult((old) => ({ ...old, state: "reconnecting" }));
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)) * (0.8 + Math.random() * 0.4);
      timer = setTimeout(() => void connect(), delay);
    };
    void connect();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, contextName, namespace, resource, enabled, visible, identity, subscribe]);
  return !enabled ? { state: "off" as const } : !visible ? { state: "paused" as const } : result.identity === identity ? { state: result.state, ...(result.update ? { update: result.update } : {}) } : { state: "starting" as const };
}
