import React from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip, CircularProgress, IconButton } from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import EmptyState from "../shared/EmptyState";
import { apiDelete } from "../../sessionsApi";

type Session = {
  id: string;
  type: string;
  title: string;
  status: string;
  createdAt: string;
  targetCluster?: string;
  targetNamespace?: string;
  targetResource?: string;
};

type Props = {
  items?: Session[];
  loading?: boolean;
  error?: string;
  token: string;
  onChange?: () => void;
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

export default function SessionList({ items, loading, error, token, onChange }: Props) {
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
    <Box sx={{ overflow: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Title</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Target</TableCell>
            <TableCell>Created</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {list.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.title || s.id}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={s.type}
                  sx={{ textTransform: "uppercase", fontSize: "0.65rem" }}
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
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {s.targetCluster || "-"} / {s.targetNamespace || "-"} / {s.targetResource || "-"}
                </Typography>
              </TableCell>
              <TableCell>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {new Date(s.createdAt).toLocaleTimeString()}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <IconButton
                  size="small"
                  aria-label="terminate session"
                  onClick={async () => {
                    await apiDelete(`/api/sessions/${encodeURIComponent(s.id)}`, token);
                    onChange?.();
                  }}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

