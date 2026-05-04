import React from "react";
import { Tooltip } from "@mui/material";
import type { ChipColor } from "../../utils/k8sUi";
import ResourceLinkChip from "./ResourceLinkChip";
import ScopedCountChip from "./ScopedCountChip";

type Props = {
  chipKey: string;
  value: string;
  onClick?: () => void;
  color?: ChipColor | "primary";
  variant?: "filled" | "outlined";
  maxWidth?: number | string;
  maxKeyLen?: number;
  maxValueLen?: number;
};

export default function KeyValueChip({
  chipKey,
  value,
  onClick,
  color = "default",
  variant = "filled",
  maxWidth = "100%",
}: Props) {
  const full = `${chipKey}=${value}`;
  const chip = onClick ? (
    <ResourceLinkChip label={chipKey} count={value} color={color} onClick={onClick} sx={{ maxWidth }} title={full} />
  ) : (
    <ScopedCountChip size="small" label={chipKey} count={value} color={color} variant={variant} sx={{ maxWidth }} title={full} />
  );
  return (
    <Tooltip title={full} arrow>
      <span>{chip}</span>
    </Tooltip>
  );
}
