import { useSyncExternalStore } from "react";

export type ConnectionHealth = "healthy" | "unhealthy";
export type ConnectionIssueKind = "backend" | "cluster" | "request";

export type ClusterConnectionStatus = {
  ok: boolean;
  context: string;
  cluster?: string;
  authInfo?: string;
  namespace?: string;
  serverVersion?: string;
  message?: string;
};

export type AppStatus = {
  ok: boolean;
  activeContext: string;
  backend: { ok: boolean; version?: string };
  cluster: ClusterConnectionStatus;
  checkedAt: string;
};

export type ConnectionIssue = {
  kind: ConnectionIssueKind;
  message: string;
  id: string;
  at: number;
};

export type ConnectionState = {
  health: ConnectionHealth;
  backendHealth: ConnectionHealth;
  backendVersion?: string;
  clusterHealth: ConnectionHealth;
  activeIssue?: ConnectionIssue;
  cluster?: ClusterConnectionStatus;
  lastTransitionAt: number;
  retryNonce: number;
  lastRecoveryShownAt?: number;
};

const state: ConnectionState = {
  health: "healthy",
  backendHealth: "healthy",
  clusterHealth: "healthy",
  lastTransitionAt: Date.now(),
  retryNonce: 0,
};

let snapshot: ConnectionState = { ...state };
const listeners = new Set<() => void>();

function emitChange() {
  snapshot = {
    ...state,
    activeIssue: state.activeIssue ? { ...state.activeIssue } : undefined,
    cluster: state.cluster ? { ...state.cluster } : undefined,
  };
  listeners.forEach((listener) => listener());
}

export function getConnectionState(): ConnectionState {
  return snapshot;
}

export function subscribeConnectionState(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribeConnectionState, getConnectionState, getConnectionState);
}

export function notifyApiSuccess() {
  if (state.backendHealth === "healthy") return;
  const now = Date.now();
  state.backendHealth = "healthy";
  recomputeHealth(now);
  emitChange();
}

export function notifyApiFailure(kind: ConnectionIssueKind, message: string) {
  if (kind === "backend") {
    updateBackend(false, message);
    return;
  }
  if (kind === "cluster") {
    updateCluster({ ok: false, context: state.cluster?.context || "", message });
    return;
  }
  const now = Date.now();
  if (state.activeIssue?.kind !== "request" || state.activeIssue.message !== message) {
    state.activeIssue = {
      kind,
      message,
      id: `issue-${now}`,
      at: now,
    };
  }
  emitChange();
}

export function notifyStatus(status: AppStatus) {
  const now = Date.now();
  const nextBackendHealth = status.backend?.ok === false ? "unhealthy" : "healthy";
  const nextBackendVersion = status.backend?.version;
  const nextCluster = status.cluster;
  const nextClusterHealth = status.cluster?.ok ? "healthy" : "unhealthy";
  if (
    state.backendHealth === nextBackendHealth &&
    state.backendVersion === nextBackendVersion &&
    state.clusterHealth === nextClusterHealth &&
    sameClusterStatus(state.cluster, nextCluster)
  ) {
    return;
  }
  state.backendHealth = nextBackendHealth;
  state.backendVersion = nextBackendVersion;
  state.cluster = nextCluster;
  state.clusterHealth = nextClusterHealth;
  recomputeHealth(now);
  emitChange();
}

function sameClusterStatus(a: ClusterConnectionStatus | undefined, b: ClusterConnectionStatus | undefined): boolean {
  if (!a || !b) return a === b;
  return a.ok === b.ok &&
    a.context === b.context &&
    a.cluster === b.cluster &&
    a.authInfo === b.authInfo &&
    a.namespace === b.namespace &&
    a.serverVersion === b.serverVersion &&
    a.message === b.message;
}

function updateBackend(ok: boolean, message: string) {
  const now = Date.now();
  state.backendHealth = ok ? "healthy" : "unhealthy";
  if (!ok) {
    if (state.activeIssue?.kind !== "backend" || state.activeIssue.message !== message) {
      state.activeIssue = {
        kind: "backend",
        message,
        id: `issue-${now}`,
        at: now,
      };
    }
    state.health = "unhealthy";
    state.lastTransitionAt = now;
  } else {
    recomputeHealth(now);
  }
  emitChange();
}

function updateCluster(cluster: ClusterConnectionStatus) {
  const now = Date.now();
  state.cluster = cluster;
  state.clusterHealth = cluster.ok ? "healthy" : "unhealthy";
  recomputeHealth(now);
  emitChange();
}

function recomputeHealth(now: number) {
  const was = state.health;
  if (state.backendHealth === "unhealthy") {
    state.health = "unhealthy";
    state.activeIssue = state.activeIssue?.kind === "backend"
      ? state.activeIssue
      : {
          kind: "backend",
          message: "The UI cannot reach the kview backend.",
          id: `issue-${now}`,
          at: now,
        };
  } else if (state.clusterHealth === "unhealthy") {
    const message = state.cluster?.message || "The backend cannot reach the active Kubernetes cluster.";
    state.health = "unhealthy";
    if (state.activeIssue?.kind !== "cluster" || state.activeIssue.message !== message) {
      state.activeIssue = {
        kind: "cluster",
        message,
        id: `issue-${now}`,
        at: now,
      };
    }
  } else {
    state.health = "healthy";
    state.activeIssue = undefined;
  }

  if (state.health !== was) {
    state.lastTransitionAt = now;
    if (state.health === "healthy") {
      state.lastRecoveryShownAt = now;
    }
  }
}

export function requestConnectionRetry() {
  state.retryNonce += 1;
  emitChange();
}
