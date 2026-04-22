export type ChipColor = "success" | "warning" | "error" | "info" | "default";

export function phaseChipColor(phase?: string | null): ChipColor {
  switch ((phase || "").toLowerCase()) {
    case "running":
      return "success";
    case "pending":
    case "unknown":
      return "warning";
    case "failed":
      return "error";
    case "succeeded":
      return "info";
    default:
      return "default";
  }
}

export function eventChipColor(kind?: string | null): ChipColor {
  switch (kind) {
    case "Normal":
      return "success";
    case "Warning":
      return "warning";
    default:
      return "default";
  }
}

export function conditionStatusColor(status?: string | null): ChipColor {
  if (status === "True") return "success";
  if (status === "False") return "error";
  if (status === "Unknown") return "warning";
  return "default";
}

export function statusChipColor(status?: string | null): ChipColor {
  switch (status) {
    case "Available":
      return "success";
    case "Progressing":
      return "warning";
    case "Paused":
      return "default";
    case "ScaledDown":
      return "default";
    default:
      return "default";
  }
}

/** Pod list API enrichment: ok | attention | problem */
export function listHealthHintColor(hint?: string | null): ChipColor {
  switch (hint) {
    case "problem":
      return "error";
    case "attention":
      return "warning";
    case "ok":
      return "success";
    default:
      return "default";
  }
}

/** Deployment list API enrichment: healthy | progressing | degraded | unknown */
export function deploymentHealthBucketColor(bucket?: string | null): ChipColor {
  switch (bucket) {
    case "healthy":
      return "success";
    case "progressing":
      return "warning";
    case "degraded":
      return "error";
    default:
      return "default";
  }
}

/** Coarse dataplane / list state (ok, empty, denied, partial_proxy, degraded) for chips */
export function dataplaneCoarseStateChipColor(state?: string | null): ChipColor {
  switch (state) {
    case "ok":
      return "success";
    case "empty":
      return "default";
    case "denied":
      return "error";
    case "partial_proxy":
    case "degraded":
      return "warning";
    default:
      return "default";
  }
}

export function jobStatusChipColor(status?: string | null): ChipColor {
  switch (status) {
    case "Complete":
      return "success";
    case "Failed":
      return "error";
    case "Running":
      return "warning";
    default:
      return "default";
  }
}

export function nodeStatusChipColor(status?: string | null): ChipColor {
  switch (status) {
    case "Ready":
      return "success";
    case "NotReady":
      return "error";
    case "Unknown":
      return "warning";
    default:
      return "default";
  }
}

export function namespacePhaseChipColor(phase?: string | null): ChipColor {
  switch (phase) {
    case "Active":
      return "success";
    case "Terminating":
      return "warning";
    default:
      return "default";
  }
}

export function pvcPhaseChipColor(phase?: string | null): ChipColor {
  switch (phase) {
    case "Bound":
      return "success";
    case "Pending":
      return "warning";
    case "Lost":
      return "error";
    default:
      return "default";
  }
}

export function pvPhaseChipColor(phase?: string | null): ChipColor {
  switch (phase) {
    case "Available":
      return "success";
    case "Bound":
      return "success";
    case "Released":
      return "warning";
    case "Failed":
      return "error";
    default:
      return "default";
  }
}

export function helmStatusChipColor(status?: string | null): ChipColor {
  switch (status) {
    case "deployed":
      return "success";
    case "superseded":
      return "default";
    case "failed":
      return "error";
    case "pending-install":
    case "pending-upgrade":
    case "pending-rollback":
    case "uninstalling":
      return "warning";
    case "unknown":
      return "warning";
    default:
      return "default";
  }
}

export function listSignalSeverityColor(severity?: string | null): ChipColor {
  switch ((severity || "").toLowerCase()) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "info";
    case "ok":
      return "success";
    default:
      return "default";
  }
}

export function listSignalLabel(severity?: string | null, count?: number | null): string {
  const normalized = (severity || "").toLowerCase();
  if (!normalized || normalized === "ok") return "OK";
  const title = normalized[0].toUpperCase() + normalized.slice(1);
  const signalCount = Number(count || 0);
  return signalCount > 0 ? `${title} (${signalCount})` : title;
}
