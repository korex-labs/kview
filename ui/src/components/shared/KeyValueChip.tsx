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
  maxKeyLen?: number;
  maxValueLen?: number;
};

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  if (maxLen <= 3) return value.slice(0, maxLen);
  return `${value.slice(0, maxLen - 3)}...`;
}

export default function KeyValueChip({
  chipKey,
  value,
  onClick,
  color = "default",
  variant = "filled",
  maxKeyLen = 28,
  maxValueLen = 32,
}: Props) {
  const full = `${chipKey}=${value}`;
  const displayKey = truncate(chipKey, maxKeyLen);
  const displayValue = truncate(value, maxValueLen);
  const truncated = displayKey !== chipKey || displayValue !== value;
  const chip = onClick ? (
    <ResourceLinkChip label={displayKey} count={displayValue} color={color} onClick={onClick} />
  ) : (
    <ScopedCountChip size="small" label={displayKey} count={displayValue} color={color} variant={variant} />
  );
  if (!truncated) return chip;
  return (
    <Tooltip title={full} arrow>
      <span>{chip}</span>
    </Tooltip>
  );
}
