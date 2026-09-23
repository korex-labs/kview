import { apiSubscribePods } from "./podLive";
import useResourceLive, { type ResourceLiveOptions } from "./useResourceLive";

export default function usePodLive(options: Omit<ResourceLiveOptions, "resource">) {
  return useResourceLive({ ...options, resource: "pods" }, apiSubscribePods);
}
