import React from "react";
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { fmtTs, valueOrDash } from "../../utils/format";
import { conditionStatusColor } from "../../utils/k8sUi";
import type { ChipColor } from "../../utils/k8sUi";
import Section from "./Section";
import EmptyState from "./EmptyState";

export type Condition = {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: number;
};

type ConditionsTableProps = {
  conditions: Condition[];
  /** Custom health check. Default: status === "True" is healthy. */
  isHealthy?: (cond: Condition) => boolean;
  /** Custom chip color. Receives the full condition. Default: conditionStatusColor(cond.status). */
  chipColor?: (cond: Condition) => ChipColor;
  /** Empty state message. */
  emptyMessage?: string;
  /** "accordion" (default) wraps in Accordion; "section" wraps in Section. */
  variant?: "accordion" | "section";
  /** Title for the accordion/section. Default: "Conditions & Health". */
  title?: string;
};

function defaultIsHealthy(cond: Condition): boolean {
  return cond.status === "True";
}

function ConditionsBody({
  conditions,
  isHealthy,
  chipColor,
  emptyMessage,
}: {
  conditions: Condition[];
  isHealthy: (cond: Condition) => boolean;
  chipColor: (cond: Condition) => ChipColor;
  emptyMessage: string;
}) {
  if (conditions.length === 0) {
    return <EmptyState message={emptyMessage} sx={{ mt: 1 }} />;
  }

  return (
    <Table size="small" sx={{ mt: 1 }}>
      <TableHead>
        <TableRow>
          <TableCell>Type</TableCell>
          <TableCell>Status</TableCell>
          <TableCell>Reason</TableCell>
          <TableCell>Message</TableCell>
          <TableCell>Last Transition</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {conditions.map((c, idx) => {
          const unhealthy = !isHealthy(c);
          return (
            <TableRow
              key={c.type || String(idx)}
              sx={{
                backgroundColor: unhealthy ? "var(--chip-error-bg)" : "transparent",
              }}
            >
              <TableCell>{valueOrDash(c.type)}</TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={valueOrDash(c.status)}
                  color={chipColor(c)}
                />
              </TableCell>
              <TableCell>{valueOrDash(c.reason)}</TableCell>
              <TableCell sx={{ maxWidth: 320, whiteSpace: "pre-wrap" }}>
                {valueOrDash(c.message)}
              </TableCell>
              <TableCell>
                {c.lastTransitionTime ? fmtTs(c.lastTransitionTime) : "-"}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export default function ConditionsTable({
  conditions,
  isHealthy = defaultIsHealthy,
  chipColor = (cond: Condition) => conditionStatusColor(cond.status),
  emptyMessage = "No conditions reported.",
  variant = "accordion",
  title = "Conditions & Health",
}: ConditionsTableProps) {
  const hasUnhealthy = conditions.some((c) => !isHealthy(c));

  if (variant === "section") {
    return (
      <Section title={title}>
        <ConditionsBody
          conditions={conditions}
          isHealthy={isHealthy}
          chipColor={chipColor}
          emptyMessage={emptyMessage}
        />
      </Section>
    );
  }

  return (
    <Accordion defaultExpanded={hasUnhealthy}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2">{title}</Typography>
        {hasUnhealthy && (
          <Chip size="small" color="error" label="Unhealthy" sx={{ ml: 1 }} />
        )}
      </AccordionSummary>
      <AccordionDetails>
        <ConditionsBody
          conditions={conditions}
          isHealthy={isHealthy}
          chipColor={chipColor}
          emptyMessage={emptyMessage}
        />
      </AccordionDetails>
    </Accordion>
  );
}
