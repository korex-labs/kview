import { useCallback, useMemo, useState } from "react";
import type { ResourceLiveOptions, ResourceLiveState } from "./useResourceLive";
import type { ResourceLiveUpdate } from "./resourceLive";

/** Snapshot readiness belongs to the exact authenticated list identity, not the socket. */
export default function useResourceLiveSnapshot({ token, contextName, namespace, resource, enabled }: ResourceLiveOptions) {
  const identity = useMemo(() => ({ token, contextName, namespace, resource, enabled }), [token, contextName, namespace, resource, enabled]);
  const [applied, setApplied] = useState<{ identity: object; revision?: string }>();
  const onSnapshotRevision = useCallback((revision: string | undefined) => setApplied({ identity, revision }), [identity]);
  return { appliedRevision: applied?.identity === identity ? applied.revision : undefined, onSnapshotRevision };
}

export function resourceLiveDisplayState(state: ResourceLiveState, update: ResourceLiveUpdate | undefined, appliedRevision: string | undefined): ResourceLiveState {
  const applied = Number(appliedRevision);
  return state === "live" && (!update || update.stale || !Number.isSafeInteger(update.revision) || update.revision <= 0 || !Number.isSafeInteger(applied) || applied < update.revision) ? "starting" : state;
}
