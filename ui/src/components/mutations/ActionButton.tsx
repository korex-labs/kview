import React from "react";
import { Button, Tooltip } from "@mui/material";
import { useMutationDialog } from "./useMutationDialog";
import type { MutationActionDescriptor, TargetRef } from "../../lib/actions/types";
import { useConnectionState } from "../../connectionState";

export type ActionButtonProps = {
  descriptor: MutationActionDescriptor;
  targetRef: TargetRef;
  token: string;
  onSuccess?: () => void;
  /** Override the button label (defaults to descriptor.title). */
  label?: string;
  color?: "primary" | "secondary" | "error" | "warning" | "info" | "success" | "inherit";
  size?: "small" | "medium" | "large";
  variant?: "text" | "outlined" | "contained";
  /** When true, the button is rendered but disabled. */
  disabled?: boolean;
  /** Shown as a tooltip when disabled (e.g. "Not permitted by RBAC"). */
  disabledReason?: string;
  /** Pre-populated values for paramSpecs fields. */
  initialParams?: Record<string, string | boolean>;
};

/**
 * A thin declarative helper that opens the MutationDialog when clicked.
 *
 * Requires a MutationProvider ancestor.
 */
export default function ActionButton({
  descriptor,
  targetRef,
  token,
  onSuccess,
  label,
  color,
  size = "small",
  variant = "outlined",
  disabled = false,
  disabledReason,
  initialParams,
}: ActionButtonProps) {
  const { open } = useMutationDialog();
  const { health } = useConnectionState();
  const offline = health === "unhealthy";
  const effectiveDisabled = disabled || offline;
  const effectiveDisabledReason = offline
    ? "Cluster connection is unavailable"
    : disabledReason;

  function handleClick() {
    if (effectiveDisabled) return;
    open({ descriptor, targetRef, token, onSuccess, initialParams });
  }

  return (
    <Tooltip title={effectiveDisabled && effectiveDisabledReason ? effectiveDisabledReason : ""}>
      {/* span wrapper required so Tooltip works on a disabled button */}
      <span>
        <Button
          size={size}
          variant={variant}
          color={color}
          disabled={effectiveDisabled}
          onClick={handleClick}
        >
          {label ?? descriptor.title}
        </Button>
      </span>
    </Tooltip>
  );
}
