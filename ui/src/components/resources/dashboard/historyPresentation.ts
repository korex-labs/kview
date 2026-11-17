import { fmtBytes } from "../../../utils/format";

export function historyStorage(d: { retainedHours: number; retainedBytes: number; databaseBytes: number }): { label: string; title: string } {
  return {
    label: `Persisted ${d.retainedHours}h · ${fmtBytes(d.retainedBytes)}`,
    title: `Retained hourly records for this context, not the selected period. Payload ${fmtBytes(d.retainedBytes)} across contexts (hourly records and current state); database ${fmtBytes(d.databaseBytes)} includes overhead and other history data.`,
  };
}

export function historyError(cause: unknown): string {
  const e = cause as { status?: number; message?: string } | null;
  switch (e?.status) {
    case 409: return "History collection is disabled. Open Settings → Dataplane → History to enable collection for this context.";
    case 404: return "No retained signal history is available for this exact scope.";
    case 401: case 403: return "History access denied. Check application authentication and permissions.";
    case 422: return "History query exceeds the memory limit. Choose a shorter period or narrow the date range.";
    case 503: return "History storage is unavailable. Retry after the administrator checks the local store.";
    default: return `History error: ${e?.message || "Could not read local history."}`;
  }
}
