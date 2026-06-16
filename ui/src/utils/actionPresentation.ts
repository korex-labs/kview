import React from "react";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import PauseCircleOutlinedIcon from "@mui/icons-material/PauseCircleOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ReplayIcon from "@mui/icons-material/Replay";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import TuneIcon from "@mui/icons-material/Tune";
import UndoIcon from "@mui/icons-material/Undo";
import UpgradeIcon from "@mui/icons-material/Upgrade";
import type { ButtonProps } from "@mui/material/Button";

export type ActionIconName =
  | "add"
  | "check"
  | "delete"
  | "more"
  | "pause"
  | "play"
  | "replay"
  | "restart"
  | "tune"
  | "undo"
  | "upgrade";

export type ActionPresentation = {
  id: string;
  label: string;
  icon?: ActionIconName;
  color?: ButtonProps["color"];
  order: number;
};

export type ActionPresentationDescriptor = {
  id?: string;
  label?: string;
  icon?: string;
  color?: string;
  order?: number;
};

const validActionIcons = new Set<ActionIconName>([
  "add",
  "check",
  "delete",
  "more",
  "pause",
  "play",
  "replay",
  "restart",
  "tune",
  "undo",
  "upgrade",
]);

const validActionColors = new Set([
  "primary",
  "secondary",
  "error",
  "warning",
  "info",
  "success",
  "inherit",
]);

const defaultActionPresentations: Record<string, ActionPresentation> = {
  scale: { id: "scale", label: "Scale", icon: "tune", order: 10 },
  "cronjob.suspend": { id: "cronjob.suspend", label: "Suspend", icon: "pause", color: "warning", order: 15 },
  "cronjob.resume": { id: "cronjob.resume", label: "Resume", icon: "play", color: "success", order: 15 },
  "job.rerun": { id: "job.rerun", label: "Rerun", icon: "replay", order: 20 },
  "cronjob.run": { id: "cronjob.run", label: "Run now", icon: "play", order: 20 },
  restart: { id: "restart", label: "Restart", icon: "restart", order: 30 },
  "custom.workload": { id: "custom.workload", label: "Custom actions", icon: "more", order: 40 },
  "helm.install": { id: "helm.install", label: "Install", icon: "add", color: "primary", order: 45 },
  "helm.reinstall": { id: "helm.reinstall", label: "Reinstall", icon: "replay", order: 50 },
  "helm.upgrade": { id: "helm.upgrade", label: "Upgrade", icon: "upgrade", order: 55 },
  "helm.rollback": { id: "helm.rollback", label: "Rollback", icon: "undo", order: 60 },
  "resource.yaml.validate": { id: "resource.yaml.validate", label: "Validate", icon: "check", order: 70 },
  "resource.yaml.apply": { id: "resource.yaml.apply", label: "Apply", icon: "upgrade", color: "warning", order: 75 },
  "resource.patch.validate": { id: "resource.patch.validate", label: "Validate patch", icon: "check", order: 80 },
  "resource.patch.apply": { id: "resource.patch.apply", label: "Apply patch", icon: "upgrade", color: "warning", order: 85 },
  delete: { id: "delete", label: "Delete", icon: "delete", color: "error", order: 90 },
  "helm.uninstall": { id: "helm.uninstall", label: "Uninstall", icon: "delete", color: "error", order: 90 },
};

const actionPresentations: Record<string, ActionPresentation> = clonePresentations(defaultActionPresentations);

function clonePresentations(input: Record<string, ActionPresentation>): Record<string, ActionPresentation> {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, { ...value }]));
}

function isActionIconName(value: unknown): value is ActionIconName {
  return typeof value === "string" && validActionIcons.has(value as ActionIconName);
}

function isActionColor(value: unknown): value is ButtonProps["color"] {
  return typeof value === "string" && validActionColors.has(value);
}

export function resetActionPresentationsForTest(): void {
  const defaults = clonePresentations(defaultActionPresentations);
  for (const key of Object.keys(actionPresentations)) delete actionPresentations[key];
  Object.assign(actionPresentations, defaults);
}

export function applyActionPresentationDescriptors(descriptors: ActionPresentationDescriptor[] | null | undefined): boolean {
  if (!Array.isArray(descriptors) || descriptors.length === 0) return false;
  const next = clonePresentations(defaultActionPresentations);
  for (const descriptor of descriptors) {
    const id = typeof descriptor.id === "string" ? descriptor.id.trim() : "";
    const label = typeof descriptor.label === "string" ? descriptor.label.trim() : "";
    if (!id || !label) continue;
    next[id] = {
      id,
      label,
      icon: isActionIconName(descriptor.icon) ? descriptor.icon : undefined,
      color: isActionColor(descriptor.color) ? descriptor.color : undefined,
      order: typeof descriptor.order === "number" && Number.isFinite(descriptor.order)
        ? Math.round(descriptor.order)
        : next[id]?.order ?? 100,
    };
  }
  if (JSON.stringify(actionPresentations) === JSON.stringify(next)) return false;
  for (const key of Object.keys(actionPresentations)) delete actionPresentations[key];
  Object.assign(actionPresentations, next);
  return true;
}

export function getActionPresentation(actionId: string): ActionPresentation | undefined {
  const id = actionId.trim();
  if (!id) return undefined;
  const exact = actionPresentations[id];
  if (exact) return { ...exact };
  const suffix = id.slice(id.lastIndexOf(".") + 1);
  const fallback = actionPresentations[suffix];
  return fallback ? { ...fallback, id } : undefined;
}

export function actionPresentationIcon(icon?: ActionIconName): React.ReactNode {
  switch (icon) {
    case "add":
      return React.createElement(AddIcon);
    case "check":
      return React.createElement(CheckIcon);
    case "delete":
      return React.createElement(DeleteOutlineIcon);
    case "more":
      return React.createElement(MoreHorizIcon);
    case "pause":
      return React.createElement(PauseCircleOutlinedIcon);
    case "play":
      return React.createElement(PlayArrowIcon);
    case "replay":
      return React.createElement(ReplayIcon);
    case "restart":
      return React.createElement(RestartAltIcon);
    case "tune":
      return React.createElement(TuneIcon);
    case "undo":
      return React.createElement(UndoIcon);
    case "upgrade":
      return React.createElement(UpgradeIcon);
    default:
      return undefined;
  }
}
