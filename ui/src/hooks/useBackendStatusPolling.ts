import { useEffect } from "react";
import { notifyApiFailure, notifyStatus, type AppStatus, type ConnectionHealth } from "../connectionState";
import { POLL_STATUS_INTERVAL_MS } from "../constants/pollIntervals";
import {
  performanceDiagnosticsEnabled,
  recordApiTiming,
} from "../utils/performanceDiagnostics";

type BackendStatusPollingOptions = {
  token: string;
  activeContext: string;
  backendHealth: ConnectionHealth;
  pageVisible: boolean;
  retryNonce: number;
  settingsOpen: boolean;
};

export default function useBackendStatusPolling({
  token,
  activeContext,
  backendHealth,
  pageVisible,
  retryNonce,
  settingsOpen,
}: BackendStatusPollingOptions) {
  useEffect(() => {
    if (!pageVisible) return;
    let cancelled = false;
    let inFlight = false;
    let controller: AbortController | null = null;

    const pollStatus = async () => {
      if (inFlight) return;
      inFlight = true;
      controller = new AbortController();
      const diagnosticsEnabled = performanceDiagnosticsEnabled();
      const startedAt = diagnosticsEnabled ? window.performance.now() : 0;
      try {
        const res = await fetch("/api/status", {
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(activeContext ? { "X-Kview-Context": activeContext } : {}),
          },
        });
        if (!res.ok) {
          if (diagnosticsEnabled) {
            recordApiTiming({
              method: "GET",
              path: "/api/status",
              durationMs: window.performance.now() - startedAt,
              parseMs: 0,
              bytes: 0,
              ok: false,
              status: res.status,
            });
          }
          const message = res.statusText || `Status check failed (${res.status})`;
          if (!cancelled) notifyApiFailure(res.status >= 500 ? "backend" : "request", message);
          return;
        }
        const text = await res.text();
        const parseStartedAt = diagnosticsEnabled ? window.performance.now() : 0;
        const status = JSON.parse(text || "null") as AppStatus;
        if (diagnosticsEnabled) {
          recordApiTiming({
            method: "GET",
            path: "/api/status",
            durationMs: window.performance.now() - startedAt,
            parseMs: window.performance.now() - parseStartedAt,
            bytes: text.length,
            ok: true,
            status: res.status,
          });
        }
        if (!cancelled) notifyStatus(status);
      } catch (err) {
        if (diagnosticsEnabled) {
          recordApiTiming({
            method: "GET",
            path: "/api/status",
            durationMs: window.performance.now() - startedAt,
            parseMs: 0,
            bytes: 0,
            ok: false,
          });
        }
        if (!cancelled) {
          notifyApiFailure("backend", String((err as Error | undefined)?.message || err || "Network error"));
        }
      } finally {
        inFlight = false;
        controller = null;
      }
    };

    void pollStatus();
    const statusPollIntervalMs = settingsOpen && backendHealth === "healthy" ? 30000 : POLL_STATUS_INTERVAL_MS;
    const id = window.setInterval(pollStatus, statusPollIntervalMs);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(id);
    };
  }, [activeContext, backendHealth, pageVisible, retryNonce, settingsOpen, token]);
}