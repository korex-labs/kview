import React from "react";
import { Box } from "@mui/material";
import { panelBoxSx } from "../../theme/sxTokens";
import ConditionsTable, { type Condition } from "./ConditionsTable";
import type { ChipColor } from "../../utils/k8sUi";

type HealthConditionsPanelProps = {
  conditions: Condition[];
  isHealthy?: (cond: Condition) => boolean;
  chipColor?: (cond: Condition) => ChipColor;
  emptyMessage?: string;
  title?: string;
  unhealthyFirst?: boolean;
};

export default function HealthConditionsPanel({
  conditions,
  isHealthy,
  chipColor,
  emptyMessage,
  title = "Health & Conditions",
  unhealthyFirst = true,
}: HealthConditionsPanelProps) {
  return (
    <Box sx={panelBoxSx}>
      <ConditionsTable
        conditions={conditions}
        isHealthy={isHealthy}
        chipColor={chipColor}
        emptyMessage={emptyMessage}
        title={title}
        unhealthyFirst={unhealthyFirst}
        variant="section"
      />
    </Box>
  );
}
