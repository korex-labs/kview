import { useEffect, useState } from "react";

export const SIGNAL_SUPPRESSIONS_CHANGED_EVENT = "kview:signal-suppressions-changed";

export function dispatchSignalSuppressionsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SIGNAL_SUPPRESSIONS_CHANGED_EVENT));
}

export function useSignalSuppressionsRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const changed = () => setRevision((current) => current + 1);
    window.addEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, changed);
    return () => window.removeEventListener(SIGNAL_SUPPRESSIONS_CHANGED_EVENT, changed);
  }, []);
  return revision;
}