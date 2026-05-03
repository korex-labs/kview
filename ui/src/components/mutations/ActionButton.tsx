import React from "react";
import { Button, Tooltip } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import TuneIcon from "@mui/icons-material/Tune";
import UndoIcon from "@mui/icons-material/Undo";
import UpgradeIcon from "@mui/icons-material/Upgrade";
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
  startIcon?: React.ReactNode;
  /** When true, the button is rendered but disabled. */
  disabled?: boolean;
  /** Shown as a tooltip when disabled (e.g. "Not permitted by RBAC"). */
  disabledReason?: string;
  /** Pre-populated values for paramSpecs fields. */
  initialParams?: Record<string, string | boolean>;
  /** Optional click handler for callers that still want ActionButton chrome but custom dialog wiring. */
  onClickOverride?: () => void;
};

function defaultActionIcon(descriptor: MutationActionDescriptor, label?: string): React.ReactNode {
  const actionText = `${descriptor.id} ${label ?? descriptor.title}`.toLowerCase();
  if (actionText.includes("delete") || actionText.includes("uninstall")) return <DeleteOutlineIcon />;
  if (actionText.includes("restart")) return <RestartAltIcon />;
  if (actionText.includes("scale")) return <TuneIcon />;
  if (actionText.includes("rollback")) return <UndoIcon />;
  if (actionText.includes("upgrade")) return <UpgradeIcon />;
  if (actionText.includes("reinstall") || actionText.includes("rerun")) return <ReplayIcon />;
  if (actionText.includes("run")) return <PlayArrowIcon />;
  if (actionText.includes("install") || actionText.includes("create")) return <AddIcon />;
  return undefined;
}

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
  startIcon,
  disabled = false,
  disabledReason,
  initialParams,
  onClickOverride,
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
    if (onClickOverride) {
      onClickOverride();
      return;
    }
    open({ descriptor, targetRef, token, onSuccess, initialParams });
  }

  const effectiveStartIcon = startIcon ?? defaultActionIcon(descriptor, label);

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
          startIcon={effectiveStartIcon}
        >
          {label ?? descriptor.title}
        </Button>
      </span>
    </Tooltip>
  );
}
