import React from "react";
import {
  Box,
  Typography,
  IconButton,
  Divider,
  Chip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { valueOrDash } from "../../../utils/format";
import KeyValueTable from "../../shared/KeyValueTable";
import Section from "../../shared/Section";
import RightDrawer from "../../layout/RightDrawer";

type HelmChart = {
  chartName: string;
  chartVersion: string;
  appVersion: string;
  releases: number;
  namespaces: string[];
};

export default function HelmChartDrawer(props: {
  open: boolean;
  onClose: () => void;
  chart: HelmChart | null;
}) {
  const chart = props.chart;

  const summaryItems = chart
    ? [
        { label: "Chart", value: valueOrDash(chart.chartName), monospace: true },
        { label: "Version", value: valueOrDash(chart.chartVersion) },
        { label: "App Version", value: valueOrDash(chart.appVersion) },
        { label: "Releases", value: String(chart.releases) },
      ]
    : [];

  return (
    <RightDrawer open={props.open} onClose={props.onClose} PaperProps={{ sx: { width: 620 } }}>
      <Box sx={{ width: 620, p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Helm Chart: {chart?.chartName || "-"}
          </Typography>
          <IconButton onClick={props.onClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ my: 1 }} />

        {chart && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2, overflow: "auto" }}>
            <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
              <KeyValueTable rows={summaryItems} columns={2} />
            </Box>

            <Section title="Namespaces">
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                {chart.namespaces.length > 0 ? (
                  chart.namespaces.map((ns) => (
                    <Chip key={ns} size="small" label={ns} variant="outlined" />
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    -
                  </Typography>
                )}
              </Box>
            </Section>
          </Box>
        )}
      </Box>
    </RightDrawer>
  );
}
