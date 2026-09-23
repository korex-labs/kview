import { apiSubscribeResource, type ResourceLiveUpdate } from "./resourceLive";
export { ResourceLiveError as PodLiveError } from "./resourceLive";
export type PodLiveUpdate = ResourceLiveUpdate;

/** Compatibility adapter for the existing Pods wire contract. */
export function apiSubscribePods(token: string, contextName: string, namespace: string, signal: AbortSignal, onUpdate: (update: PodLiveUpdate) => void): Promise<void> {
  return apiSubscribeResource(token, contextName, namespace, "pods", signal, onUpdate);
}
