import { useEffect, useState } from "react";
import { apiSubscribePods, PodLiveError, type PodLiveUpdate } from "./podLive";
import usePageVisible from "./usePageVisible";

type State = "off" | "starting" | "live" | "reconnecting" | "paused" | "blocked" | "stopped";
export default function usePodLive({ token, contextName, namespace, enabled }: { token: string; contextName: string; namespace: string; enabled: boolean }) {
  const visible = usePageVisible();
  const [result, setResult] = useState<{ state: State; update?: PodLiveUpdate }>({ state: "off" });
  useEffect(() => {
    if (!enabled || !visible) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    let terminal = false;
    setResult({ state: "starting" });
    const connect = async () => {
      try {
        await apiSubscribePods(token, contextName, namespace, controller.signal, (update) => {
          if (controller.signal.aborted) return;
          if (update.state === "blocked" || update.state === "stopped") {
            terminal = true;
            controller.abort();
          }
          if (update.state === "live" && update.revision > 0 && !update.stale) failures = 0;
          setResult({ state: update.state === "live" && (!update.revision || update.stale) ? "starting" : update.state, update });
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof PodLiveError && !error.retryable) {
          terminal = true;
          setResult({ state: "blocked" });
        }
      }
      if (controller.signal.aborted || terminal) return;
      setResult((old) => ({ ...old, state: "reconnecting" }));
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)) * (0.8 + Math.random() * 0.4);
      timer = setTimeout(() => void connect(), delay);
    };
    void connect();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [token, contextName, namespace, enabled, visible]);
  return !enabled ? { state: "off" as const } : !visible ? { state: "paused" as const } : result;
}
