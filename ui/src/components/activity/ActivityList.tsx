import React from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip, CircularProgress } from "@mui/material";
import EmptyState from "../shared/EmptyState";

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

export default function ActivityList({ items, loading, error }: Props) {
  const list = items || [];

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (error) {
    return <EmptyState message="Unable to load activities." />;
  }

  if (list.length === 0) {
    return <EmptyState message="No active activities" />;
  }

  return (
    <Box sx={{ overflow: "auto", border: "1px solid var(--border-subtle)", borderRadius: 1 }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>ID</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Kind</TableCell>
            <TableCell>Type</TableCell>
            <TableCell>Target</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {list.map((a) => (
            <TableRow key={a.id}>
              <TableCell>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {a.id}
                </Typography>
              </TableCell>
              <TableCell>{a.title || "-"}</TableCell>
              <TableCell>{a.kind}</TableCell>
              <TableCell>{a.type}</TableCell>
              <TableCell>
                <Typography variant="caption" sx={{ fontFamily: "monospace" }}>
                  {a.type === "portforward" && a.metadata?.localPort && a.metadata?.remotePort
                    ? `${a.metadata.localHost || "127.0.0.1"}:${a.metadata.localPort} -> ${a.metadata.remotePort}`
                    : `${a.metadata?.targetNamespace || "-"} / ${a.metadata?.targetResource || "-"}`}
                </Typography>
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={a.status || "-"}
                  color={statusChipColor(a.status)}
                  sx={{ textTransform: "uppercase", fontSize: "0.65rem" }}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

