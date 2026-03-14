import React from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip, CircularProgress, IconButton, Tooltip } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import VisibilityIcon from "@mui/icons-material/Visibility";
import DeleteIcon from "@mui/icons-material/Delete";
import EmptyState from "../shared/EmptyState";
import {
  chipSxForValue,
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
  metadata?: Record<string, string>;
};

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

  if (loading) {
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
            <TableCell sx={compactHeaderCellSx}>Target</TableCell>
            <TableCell sx={compactHeaderCellSx}>Status</TableCell>
            <TableCell sx={compactHeaderCellSx} align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {list.map((a) => (
            <TableRow key={a.id}>
              <TableCell sx={compactCellSx}>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {a.id}
                </Typography>
              </TableCell>
              <TableCell sx={compactCellSx}>{a.title || "-"}</TableCell>
              <TableCell sx={compactCellSx}>
                <Chip size="small" label={a.kind || "-"} sx={chipSxForValue(a.kind, "kind")} />
              </TableCell>
              <TableCell sx={compactCellSx}>
                <Chip size="small" label={a.type || "-"} sx={chipSxForValue(a.type, "type")} />
              </TableCell>
              <TableCell sx={compactCellSx}>
                <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                  {a.type === "portforward" && a.metadata?.localPort && a.metadata?.remotePort
                    ? `${a.metadata.localHost || "127.0.0.1"}:${a.metadata.localPort} -> ${a.metadata.remotePort}`
                    : `${a.metadata?.targetNamespace || "-"} / ${a.metadata?.targetResource || "-"}`}
                </Typography>
              </TableCell>
              <TableCell sx={compactCellSx}>
                <Chip
                  size="small"
                  label={a.status || "-"}
                  sx={chipSxForValue(a.status, "status")}
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

