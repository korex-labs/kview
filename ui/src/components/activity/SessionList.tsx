import React from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip, CircularProgress, IconButton } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import EmptyState from "../shared/EmptyState";

type Session = {
  id: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
  targetCluster?: string;
  targetNamespace?: string;
  targetResource?: string;
  targetContainer?: string;
  metadata?: Record<string, string>;
};

type Props = {
  items?: Session[];
  loading?: boolean;
  error?: string;
  onOpen?: (session: Session) => void;
  onTerminate?: (session: Session) => void;
};

function statusChipColor(status: string):
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "primary"
  | "secondary" {
  switch (status) {
    case "running":
      return "success";
    case "starting":
    case "pending":
      return "info";
    case "stopping":
      return "warning";
    case "stopped":
      return "default";
    case "failed":
      return "error";
    default:
      return "default";
  }
}

export default function SessionList({ items, loading, error, onOpen, onTerminate }: Props) {
  const list = (items || []).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (error) {
    return <EmptyState message="Unable to load sessions." />;
  }

  if (list.length === 0) {
    return <EmptyState message="No active sessions." />;
  }

  return (
    <Box sx={{ overflow: "auto", border: "1px solid var(--border-subtle)", borderRadius: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Title</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Target</TableCell>
            <TableCell sx={{ width: 84 }}>Created</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {list.map((s) => (
            <TableRow
              key={s.id}
              hover
              sx={{ cursor: onOpen && s.type === "terminal" ? "pointer" : "default" }}
              onClick={() => {
                if (s.type === "terminal") {
                  onOpen?.(s);
                }
              }}
            >
              <TableCell>{s.title || s.id}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={s.type || "-"}
                  sx={{ textTransform: "uppercase", fontSize: "0.65rem" }}
                  color={s.type === "portforward" ? "secondary" : s.type === "terminal" ? "primary" : "default"}
                />
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={s.status || "-"}
                  color={statusChipColor(s.status)}
                  sx={{ textTransform: "uppercase", fontSize: "0.65rem" }}
                />
              </TableCell>
              <TableCell>
                <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                  {s.type === "portforward" && s.metadata && s.metadata.localPort && s.metadata.remotePort ? (
                    <>
                      {(s.metadata.localHost || "127.0.0.1") + ":" + s.metadata.localPort} {" → "} {s.metadata.remotePort}
                      <br />
                      {(s.targetNamespace || "-") + " / " + (s.targetResource || "-")}
                    </>
                  ) : (
                    `${s.targetNamespace || "-"} / ${s.targetResource || "-"} / ${s.targetContainer || "-"}`
                  )}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                  {new Date(s.createdAt).toLocaleTimeString()}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <IconButton
                  size="small"
                  aria-label="open session"
                  disabled={s.type !== "terminal"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen?.(s);
                  }}
                >
                  <OpenInNewIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label="terminate session"
                  onClick={(e) => {
                    e.stopPropagation();
                    onTerminate?.(s);
                  }}
                >
                  <StopCircleOutlinedIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

