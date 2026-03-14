import React from "react";
import { Box, Chip, Tooltip, Typography } from "@mui/material";
import Section from "./Section";
import EmptyState from "./EmptyState";
import { actionRowSx } from "../../theme/sxTokens";

type MetadataSectionProps = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  /** If false, renders without Section wrapper (for embedding in Accordions). Default true. */
  wrapInSection?: boolean;
};

function ChipsList({ entries }: { entries: [string, string][] }) {
  return (
    <Box sx={[actionRowSx, { mt: 0.5 }]}>
      {entries.map(([k, v]) => {
        const label = `${k}=${v}`;
        const needsTooltip = label.length > 64;
        const chip = (
          <Chip
            key={k}
            size="small"
            label={needsTooltip ? `${label.slice(0, 60)}...` : label}
          />
        );
        return needsTooltip ? (
          <Tooltip key={k} title={label} arrow>
            {chip}
          </Tooltip>
        ) : (
          chip
        );
      })}
    </Box>
  );
}

function MetadataContent({
  labels,
  annotations,
}: {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}) {
  const labelEntries = Object.entries(labels || {});
  const annotationEntries = Object.entries(annotations || {});

  return (
    <>
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Labels
        </Typography>
        {labelEntries.length === 0 ? (
          <EmptyState message="No labels." sx={{ mt: 0.5 }} />
        ) : (
          <ChipsList entries={labelEntries} />
        )}
      </Box>

      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          Annotations
        </Typography>
        {annotationEntries.length === 0 ? (
          <EmptyState message="No annotations." sx={{ mt: 0.5 }} />
        ) : (
          <ChipsList entries={annotationEntries} />
        )}
      </Box>
    </>
  );
}

export default function MetadataSection({
  labels,
  annotations,
  wrapInSection = true,
}: MetadataSectionProps) {
  if (wrapInSection) {
    return (
      <Section title="Metadata">
        <MetadataContent labels={labels} annotations={annotations} />
      </Section>
    );
  }

  return <MetadataContent labels={labels} annotations={annotations} />;
}
