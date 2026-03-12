import React from "react";
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography, Chip, CircularProgress } from "@mui/material";
import EmptyState from "../shared/EmptyState";

type Activity = {
  id: string;
  kind: string;
  type: string;
  title: string;
  status: string;
};

type Props = {
  items?: Activity[];
  loading?: boolean;
  error?: string;
};

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
    <Box sx={{ overflow: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>ID</TableCell>
            <TableCell>Title</TableCell>
            <TableCell>Kind</TableCell>
            <TableCell>Type</TableCell>
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
                <Chip size="small" label={a.status || "-"} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

