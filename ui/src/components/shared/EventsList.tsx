import React from "react";
import { Box, Chip, Typography } from "@mui/material";
import { fmtTimeAgo, valueOrDash } from "../../utils/format";
import { eventChipColor } from "../../utils/k8sUi";
import { panelBoxCompactSx } from "../../theme/sxTokens";
import EmptyState from "./EmptyState";

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
  involvedKind?: string;
  involvedName?: string;
};

type EventsListProps = {
  events: EventDTO[];
  emptyMessage?: string;
  showTarget?: boolean;
};

export default function EventsList({
  events,
  emptyMessage = "No events found.",
  showTarget = false,
}: EventsListProps) {
  if (events.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <>
      {events.map((e, idx) => (
        <Box key={idx} sx={panelBoxCompactSx}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Chip
                size="small"
                label={e.type || "Unknown"}
                color={eventChipColor(e.type)}
              />
              <Typography variant="subtitle2">
                {valueOrDash(e.reason)} (x{valueOrDash(e.count)})
              </Typography>
              {showTarget && (e.involvedKind || e.involvedName) ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${valueOrDash(e.involvedKind)} ${valueOrDash(e.involvedName)}`}
                />
              ) : null}
            </Box>
            <Typography variant="caption" color="text.secondary">
              {fmtTimeAgo(e.lastSeen)}
            </Typography>
          </Box>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", mt: 0.5 }}>
            {valueOrDash(e.message)}
          </Typography>
        </Box>
      ))}
    </>
  );
}
