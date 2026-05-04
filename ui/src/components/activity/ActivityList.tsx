import React from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography, CircularProgress, IconButton, Tooltip } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";
import EmptyState from "../shared/EmptyState";
import StatusChip from "../shared/StatusChip";
import { fmtDurationMs } from "../../utils/format";
import {
  activityChipSx,
  chipColorForValue,
  compactCellSx,
  compactHeaderCellSx,
  compactTableSx,
  compactTableContainerSx,
  panelEmptyStateSx,
} from "./activityUi";

type Activity = {
  id: string;
  kind: string;
  type: string;
  title: string;
  status: string;
  createdAt?: string;
  startedAt?: string;
  resourceType?: string;
  executionMs?: number;
  metadata?: Record<string, string>;
  __exiting?: boolean;
};

function fmtStarted(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** User-facing operation type (API still uses internal type strings). */
function activityTypeDisplayLabel(type: string): string {
  switch ((type || "").toLowerCase()) {
    case "namespace-list-enrich":
      return "Namespace rows";
    case "dataplane-snapshot":
      return "Resource list";
    case "runtime-log":
    case "runtime_log":
      return "System log";
    case "connectivity":
      return "Connectivity";
    case "analytics-poller":
      return "Analytics";
    default:
      return type || "—";
  }
}

function activityTargetDisplay(a: Activity): string {
  if (a.type === "portforward" && a.metadata?.localPort && a.metadata?.remotePort) {
    return `${a.metadata.localHost || "127.0.0.1"}:${a.metadata.localPort} -> ${a.metadata.remotePort}`;
  }
  if (a.type === "namespace-list-enrich") {
    const focused = a.metadata?.focusedTargets ?? "0";
    const sweep = a.metadata?.sweepTargets ?? "0";
    const detail = a.metadata?.detailDone ?? "0";
    const related = a.metadata?.relatedDone ?? "0";
    const total = a.metadata?.enrichTargets ?? "0";
    const warmKinds = a.metadata?.warmKinds ?? "0";
    return `${a.metadata?.cluster || "-"} · ${a.metadata?.stage || a.status || "-"} · focused ${focused} · sweep ${sweep} · ${warmKinds} kinds · ${detail}/${total} details · ${related}/${total} counts`;
  }
  if (a.type === "dataplane-snapshot") {
    return `${a.metadata?.cluster || "-"} / ${a.metadata?.namespace || "-"} / ${a.metadata?.kind || "-"}`;
  }
  if (a.type === "connectivity") {
    return `${a.metadata?.context || "-"} · ${a.metadata?.state || a.status || "-"}`;
  }
  return `${a.metadata?.targetNamespace || "-"} / ${a.metadata?.targetResource || "-"}`;
}

type Props = {
  items?: Activity[];
  loading?: boolean;
  error?: string;
  onViewTerminal?: (activity: Activity) => void;
  onOpenPortForward?: (activity: Activity) => void;
  onFocusLogs?: (activity: Activity) => void;
  onDeleteSession?: (activity: Activity) => void;
};

export default function ActivityList({
  items,
  loading,
  error,
  onViewTerminal,
  onOpenPortForward,
  onFocusLogs,
  onDeleteSession,
}: Props) {
  const list = items || [];

  if (loading && list.length === 0) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (error) {
    return <EmptyState message="Unable to load activities." sx={panelEmptyStateSx} />;
  }

  if (list.length === 0) {
    return <EmptyState message="No active activities yet." sx={panelEmptyStateSx} />;
  }

  return (
    <Box sx={compactTableContainerSx}>
      <Table size="small" stickyHeader sx={compactTableSx}>
        <TableHead>
          <TableRow>
            <TableCell sx={compactHeaderCellSx}>ID</TableCell>
            <TableCell sx={compactHeaderCellSx}>Title</TableCell>
            <TableCell sx={compactHeaderCellSx}>Kind</TableCell>
            <TableCell sx={compactHeaderCellSx}>Type</TableCell>
            <TableCell sx={compactHeaderCellSx}>Resource</TableCell>
            <TableCell sx={compactHeaderCellSx}>Started</TableCell>
            <TableCell sx={compactHeaderCellSx} align="right">
              Duration
            </TableCell>
            <TableCell sx={compactHeaderCellSx}>Target</TableCell>
            <TableCell sx={compactHeaderCellSx}>Status</TableCell>
            <TableCell sx={compactHeaderCellSx} align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {list.map((a) => (
            <TableRow key={a.id} data-exiting={a.__exiting ? "true" : undefined} hover>
              <TableCell sx={compactCellSx}>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {a.id}
                </Typography>
              </TableCell>
              <TableCell sx={compactCellSx}>{a.title || "-"}</TableCell>
              <TableCell sx={compactCellSx}>
                <StatusChip size="small" label={a.kind || "-"} color={chipColorForValue(a.kind, "kind")} sx={activityChipSx} />
              </TableCell>
              <TableCell sx={compactCellSx}>
                <StatusChip
                  size="small"
                  label={activityTypeDisplayLabel(a.type)}
                  color={chipColorForValue(a.type, "type")}
                  sx={activityChipSx}
                />
              </TableCell>
              <TableCell sx={compactCellSx}>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                  {a.resourceType || "—"}
                </Typography>
              </TableCell>
              <TableCell sx={compactCellSx}>
                <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                  {fmtStarted(a.startedAt || a.createdAt)}
                </Typography>
              </TableCell>
              <TableCell sx={compactCellSx} align="right">
                <Typography variant="caption" sx={{ fontFamily: "monospace", fontVariantNumeric: "tabular-nums" }}>
                  {fmtDurationMs(a.executionMs)}
                </Typography>
              </TableCell>
              <TableCell sx={compactCellSx}>
                <Typography variant="caption" sx={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
                  {activityTargetDisplay(a)}
                </Typography>
              </TableCell>
              <TableCell sx={compactCellSx}>
                <StatusChip
                  size="small"
                  label={a.status || "-"}
                  color={chipColorForValue(a.status, "status")}
                  sx={activityChipSx}
                />
              </TableCell>
              <TableCell sx={compactCellSx} align="right">
                {a.type === "portforward" && (
                  <>
                    <Tooltip title="Open forwarded endpoint">
                      <span>
                        <IconButton
                          size="small"
                          disabled={!a.metadata?.localPort}
                          onClick={() => onOpenPortForward?.(a)}
                        >
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete session">
                      <IconButton size="small" onClick={() => onDeleteSession?.(a)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
                {a.type === "terminal" && (
                  <>
                    <Tooltip title="View terminal">
                      <IconButton size="small" onClick={() => onViewTerminal?.(a)}>
                        <VisibilityIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete session">
                      <IconButton size="small" onClick={() => onDeleteSession?.(a)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
                {(a.kind === "runtime" || a.type === "runtime-log" || a.type === "runtime_log" || a.type === "log") && (
                  <Tooltip title="Open Logs tab">
                    <IconButton size="small" onClick={() => onFocusLogs?.(a)}>
                      <VisibilityIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
