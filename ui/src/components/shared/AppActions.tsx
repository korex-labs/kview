import React from "react";
import { Button, IconButton, Tooltip } from "@mui/material";
import type { ButtonProps } from "@mui/material/Button";
import type { IconButtonProps } from "@mui/material/IconButton";

export type AppActionIntent = "primary" | "secondary" | "neutral" | "warning" | "destructive";

function buttonColor(intent: AppActionIntent): ButtonProps["color"] | undefined {
  switch (intent) {
    case "destructive":
      return "error";
    case "warning":
      return "warning";
    case "secondary":
      return "secondary";
    case "primary":
      return "primary";
    case "neutral":
    default:
      return undefined;
  }
}

function buttonVariant(intent: AppActionIntent, variant?: ButtonProps["variant"]): ButtonProps["variant"] {
  if (variant) return variant;
  if (intent === "primary") return "contained";
  return "outlined";
}

export type AppButtonProps = Omit<ButtonProps, "action" | "color"> & {
  intent?: AppActionIntent;
  tooltip?: React.ReactNode;
  color?: ButtonProps["color"];
};

export function AppButton({
  intent = "neutral",
  tooltip,
  color,
  variant,
  size = "small",
  children,
  ...props
}: AppButtonProps) {
  const button = (
    <Button
      size={size}
      variant={buttonVariant(intent, variant)}
      color={color || buttonColor(intent)}
      {...props}
    >
      {children}
    </Button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip title={tooltip}>
      <span>{button}</span>
    </Tooltip>
  );
}

export type DialogActionButtonProps = Omit<AppButtonProps, "intent"> & {
  action: "cancel" | "secondary" | "primary" | "destructive" | "warning";
};

export function DialogActionButton({ action, variant, ...props }: DialogActionButtonProps) {
  switch (action) {
    case "primary":
      return <AppButton intent="primary" variant={variant || "contained"} {...props} />;
    case "destructive":
      return <AppButton intent="destructive" variant={variant || "outlined"} {...props} />;
    case "warning":
      return <AppButton intent="warning" variant={variant || "contained"} {...props} />;
    case "secondary":
      return <AppButton intent="neutral" variant={variant || "outlined"} {...props} />;
    case "cancel":
    default:
      return <AppButton intent="neutral" variant={variant || "text"} {...props} />;
  }
}

export type AppIconButtonProps = Omit<IconButtonProps, "title"> & {
  tooltip: React.ReactNode;
  label: string;
  intent?: AppActionIntent;
};

export function AppIconButton({
  tooltip,
  label,
  intent = "neutral",
  color,
  size = "small",
  children,
  ...props
}: AppIconButtonProps) {
  return (
    <Tooltip title={tooltip}>
      <span>
        <IconButton
          aria-label={label}
          size={size}
          color={color || buttonColor(intent)}
          {...props}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}
