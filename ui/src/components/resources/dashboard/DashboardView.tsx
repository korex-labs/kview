import React from "react";
import { Box, Typography } from "@mui/material";
import DataplaneStatus from "../../shared/DataplaneStatus";

type Props = {
  token: string;
};

export default function DashboardView(props: Props) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
      <Box sx={{ px: 2, pt: 1 }}>
        <Typography variant="h6">Cluster dataplane overview</Typography>
        <Typography variant="body2" color="text.secondary">
          Shows current dataplane state for the active context, including snapshot freshness and observer status.
        </Typography>
      </Box>
      <DataplaneStatus token={props.token} />
    </Box>
  );
}

