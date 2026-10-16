import { useEffect, useSyncExternalStore } from "react";

// Deliberately outside UserSettings, operator profiles and transfer/export bundles.
const CONSENT_KEY = "kview:installationStatisticsConsent:v1";
const CHANGED = "kview:installationStatisticsConsentChanged";
const pending = new Set<AbortController>();
let deniedInMemory = false;
function cancelPending() { for (const controller of pending) controller.abort(); }
export function statisticsConsent(): boolean {
  try { return !deniedInMemory && window.localStorage.getItem(CONSENT_KEY) === "true"; }
  catch { return false; }
}
export function setStatisticsConsent(enabled: boolean): void {
  if (!enabled) cancelPending();
  deniedInMemory = false;
  try { window.localStorage.setItem(CONSENT_KEY, String(enabled)); }
  catch { deniedInMemory = true; } // A failed opt-out write must still stop this tab.
  window.dispatchEvent(new Event(CHANGED));
}
function subscribe(callback: () => void) {
  const changed = () => { if (!statisticsConsent()) cancelPending(); callback(); };
  window.addEventListener(CHANGED, changed);
  window.addEventListener("storage", changed);
  return () => {
    window.removeEventListener(CHANGED, changed);
    window.removeEventListener("storage", changed);
  };
}
export function useStatisticsConsent() {
  return useSyncExternalStore(subscribe, statisticsConsent, () => false);
}
export async function sendInstallationStatistics(token: string, signal: AbortSignal) {
  if (!token || !statisticsConsent() || signal.aborted || document.visibilityState !== "visible") return;
  const controller = new AbortController();
  pending.add(controller);
  try {
    // Never forward cluster context or publish optional failures as connection errors.
    await fetch("/api/statistics", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ consent: true }),
      signal: AbortSignal.any([signal, controller.signal, AbortSignal.timeout(12_000)]),
    });
  } catch { /* Best effort; retry only from a subsequent visible UI invocation. */ }
  finally { pending.delete(controller); }
}
export function useInstallationStatistics(token: string) {
  const enabled = useStatisticsConsent();
  useEffect(() => {
    if (!enabled || !token) return;
    const controller = new AbortController();
    let sending = false;
    const send = () => {
      if (sending) return;
      sending = true;
      void sendInstallationStatistics(token, controller.signal).finally(() => { sending = false; });
    };
    const visible = () => {
      if (document.visibilityState === "visible") send();
      else cancelPending();
    };
    send();
    const timer = window.setInterval(send, 15 * 60 * 1000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, token]);
}
