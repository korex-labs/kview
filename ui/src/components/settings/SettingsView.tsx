import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Checkbox,
  Chip,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Popover,
  Select,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { useTheme, type Theme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import PaletteOutlinedIcon from "@mui/icons-material/PaletteOutlined";
import QueryStatsIcon from "@mui/icons-material/QueryStats";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark, oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  applyDataplaneProfile,
  customActionResourceKeys,
  defaultDataplaneSettings,
  dataplaneNamespaceWarmResourceKeys,
  dataplaneTTLResourceKeys,
  exportUserSettingsJSON,
  exportSettingsTransferJSON,
  newCustomActionDefinition,
  newCustomCommandDefinition,
  newSmartFilterRule,
  parseSettingsTransferJSON,
  parseUserSettingsJSON,
  sanitizeRegexFlags,
  smartFilterResourceKeysForScope,
  dataplaneSettingsForContext,
  applySettingsTransferBundle,
  type CustomActionDefinition,
  type CustomActionKind,
  type CustomActionPatchType,
  type CustomActionTarget,
  type CustomCommandDefinition,
  type CustomCommandOutputType,
  type CustomCommandSafety,
  type DataplaneProfile,
  type DataplaneContextOverrideSettings,
  type DataplaneSettings,
  type KeyboardSettings,
  type KviewUserSettingsV2,
  type DynamicLinkDefinition,
  type ResourceAutoTagRuleDefinition,
  type ResourceMacroDefinition,
  type ResourceMacroExtractorDefinition,
  type ResourceTagDefinition,
  type SettingsResourceScopeMode,
  type SettingsScopeMode,
  type SignalOverride,
  type SettingsTransferMergeStrategy,
  type SettingsTransferSection,
  type SettingsTransferBundleV1,
  type SmartFilterRule,
  settingsTransferMergeStrategies,
  settingsTransferSectionIds,
  settingsTransferSections,
} from "../../settings";
import { useUserSettings } from "../../settingsContext";
import type { AppStateV1 } from "../../state";
import { getResourceLabel, type ListResourceKey } from "../../utils/k8sResources";
import { actionRowSx } from "../../theme/sxTokens";
import InfoHint from "../shared/InfoHint";
import ResourceTagChip from "../shared/ResourceTagChip";
import { AppButton, AppIconButton } from "../shared/AppActions";
import {
  FieldGroup,
  SettingField,
  SettingGrid,
  SettingRow,
  SettingSection,
  SettingsMultiSelect,
  type SettingsMultiSelectOption,
  ScopeTag,
} from "./shared";
import { apiGet, apiGetWithContext, apiPost } from "../../api";
import type { ApiDataplaneSignalCatalogResponse, DataplaneSignalCatalogItem } from "../../types/api";
import SettingsIcon, { type SettingsIconName } from "./SettingsIcon";
import { buildPerformanceDiagnosticsReport } from "../../utils/performanceDiagnostics";
import { sideRailIconSx, sideRailListItemSx, sideRailListTextSx, sideRailPaperSx } from "../shared/sideRail";

type SettingsSection = "appearance" | "keyboard" | "smartFilters" | "resourceTags" | "linksMacros" | "commands" | "actions" | "dataplane" | "importExport";
type DataplaneTab = "overview" | "enrichment" | "metrics" | "signals" | "cache";
type LinksMacrosTab = "manual" | "extractors" | "links";
type ResourceTagsTab = "manual" | "auto";

type Props = {
  token: string;
  contexts: Array<{ name: string }>;
  namespaces: string[];
  activeContext: string;
  activeNamespace: string;
  appState: AppStateV1;
  setAppState: React.Dispatch<React.SetStateAction<AppStateV1>>;
  onClose: () => void;
};

function dataplaneWarmResourceLabel(kind: string): string {
  if (kind === "helmreleases") return "Helm Releases";
  return getResourceLabel(kind as ListResourceKey);
}

function dataplaneProfileLabel(profile: DataplaneProfile): string {
  switch (profile) {
    case "manual":
      return "Manual";
    case "balanced":
      return "Balanced";
    case "wide":
      return "Wide";
    case "diagnostic":
      return "Diagnostic";
    case "focused":
    default:
      return "Focused";
  }
}

function dataplaneProfileEnrichmentText(profile: DataplaneProfile): string {
  switch (profile) {
    case "manual":
      return "Manual mode disables automatic namespace enrichment and background sweep; live reads still populate snapshots when you open lists.";
    case "balanced":
      return "Balanced enrichment warms more namespace targets and key resource lists while keeping background work modest.";
    case "wide":
      return "Wide enrichment warms all namespaced dataplane list kinds and enables a measured idle sweep across more namespaces.";
    case "diagnostic":
      return "Diagnostic enrichment is the most aggressive profile for troubleshooting broad cluster state and stale signal coverage.";
    case "focused":
    default:
      return "Focused enrichment keeps high-value data warm for the active namespace, recent namespaces, and favourites.";
  }
}

const sections: Array<{ id: SettingsSection; label: string; icon: SettingsIconName }> = [
  { id: "appearance", label: "Appearance", icon: "appearance" },
  { id: "keyboard", label: "Keyboard", icon: "keyboard" },
  { id: "smartFilters", label: "Smart Filters", icon: "smartFilters" },
  { id: "resourceTags", label: "Resource Tags", icon: "resourceTags" },
  { id: "linksMacros", label: "Links & Macros", icon: "linksMacros" },
  { id: "commands", label: "Custom Commands", icon: "commands" },
  { id: "actions", label: "Custom Actions", icon: "actions" },
  { id: "dataplane", label: "Dataplane", icon: "dataplane" },
  { id: "importExport", label: "Import / Export", icon: "importExport" },
];

const dataplaneTabs: Array<{ value: DataplaneTab; label: string; icon: SettingsIconName }> = [
  { value: "overview", label: "Overview", icon: "overview" },
  { value: "enrichment", label: "Enrichment", icon: "enrichment" },
  { value: "metrics", label: "Metrics", icon: "metrics" },
  { value: "signals", label: "Signals", icon: "signals" },
  { value: "cache", label: "Cache", icon: "cache" },
];

const linksMacrosTabs: Array<{ value: LinksMacrosTab; label: string; icon: SettingsIconName }> = [
  { value: "manual", label: "Manual Macros", icon: "linksMacros" },
  { value: "extractors", label: "Extracted Macros", icon: "smartFilters" },
  { value: "links", label: "Dynamic Links", icon: "linksMacros" },
];

const resourceTagsTabs: Array<{ value: ResourceTagsTab; label: string; icon: SettingsIconName }> = [
  { value: "manual", label: "Manual Tags", icon: "resourceTags" },
  { value: "auto", label: "Auto-Tagging", icon: "smartFilters" },
];

const resourceTagColorPresets = [
  "#1e88e5",
  "#43a047",
  "#fb8c00",
  "#8e24aa",
  "#00acc1",
  "#e53935",
  "#3949ab",
  "#7cb342",
  "#f4511e",
  "#6d4c41",
  "#00897b",
  "#5e35b1",
  "#c0ca33",
  "#d81b60",
  "#546e7a",
  "#039be5",
];

const headerRowSx = { display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" } as const;
const settingsStackSx = { display: "flex", flexDirection: "column", gap: 1.25 } as const;
const settingsPanelChromeSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 2,
  p: 1.5,
} as const;
const settingsItemCardSx = { ...settingsPanelChromeSx, display: "flex", flexDirection: "column", gap: 1 } as const;
const settingsSubsectionHeaderSx = { ...headerRowSx, mt: 0.5, minHeight: 32 } as const;
const settingsSummaryPanelSx = { ...settingsPanelChromeSx, display: "grid", gap: 0.75 } as const;
const settingsTabsSx = {
  minHeight: 40,
  borderBottom: "1px solid",
  borderColor: "divider",
  "& .MuiTabs-flexContainer": {
    alignItems: "stretch",
  },
  "& .MuiTab-root": {
    minHeight: 40,
    py: 0,
    px: 1.5,
    alignItems: "center",
    flexDirection: "row",
    gap: 1.25,
    lineHeight: 1.2,
    textTransform: "none",
    whiteSpace: "nowrap",
  },
  "& .MuiTab-root.Mui-selected": {
    fontWeight: 600,
  },
  "& .MuiTab-root.MuiTab-labelIcon": {
    minHeight: 40,
    pt: 0,
    pb: 0,
  },
  "& .MuiTab-root .MuiTab-iconWrapper": {
    mr: 0,
    mb: 0,
  },
};
const denseSelectMenuProps = {
  slotProps: {
    paper: {
      sx: {
        "& .MuiMenuItem-root": {
          minHeight: 30,
          py: 0.25,
          fontSize: "0.875rem",
        },
        "& .MuiCheckbox-root": {
          py: 0.25,
        },
        "& .MuiListItemText-root": {
          my: 0,
        },
      },
    },
  },
};

const settingsShellSx = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  overflow: "hidden",
  backgroundColor: "var(--bg-primary)",
};

const settingsMainSurfaceSx = {
  flex: 1,
  minWidth: 0,
  overflow: "auto",
  p: 1.25,
  backgroundColor: "background.paper",
  backgroundImage: (theme: Theme) =>
    theme.palette.mode === "dark" ? "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))" : "none",
  "& .MuiPaper-root": {
    backgroundColor: "background.paper",
    backgroundImage: (theme: Theme) =>
      theme.palette.mode === "dark" ? "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))" : "none",
  },
};

function isSettingsEscapeBlocked(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest([
    ".MuiAutocomplete-popper",
    ".MuiMenu-root",
    ".MuiPopover-root",
    ".MuiDialog-root",
    "[role='menu']",
    "[role='listbox']",
  ].join(","));
}

function ReorderButtons({
  label,
  index,
  lastIndex,
  onUp,
  onDown,
  onRemove,
}: {
  label: string;
  index: number;
  lastIndex: number;
  onUp: () => void;
  onDown: () => void;
  onRemove?: () => void;
}) {
  return (
    <Box sx={{ display: "flex", gap: 0.25 }}>
      <AppIconButton tooltip={`Move ${label} up`} label={`Move ${label} up`} onClick={onUp} disabled={index === 0}>
        <ArrowUpwardIcon fontSize="inherit" />
      </AppIconButton>
      <AppIconButton tooltip={`Move ${label} down`} label={`Move ${label} down`} onClick={onDown} disabled={index === lastIndex}>
        <ArrowDownwardIcon fontSize="inherit" />
      </AppIconButton>
      {onRemove ? (
        <AppIconButton tooltip={`Remove ${label}`} label={`Remove ${label}`} intent="destructive" onClick={onRemove}>
          <DeleteOutlineIcon fontSize="inherit" />
        </AppIconButton>
      ) : null}
    </Box>
  );
}

function resourceMultiSelectOptions(keys: readonly ListResourceKey[]): Array<SettingsMultiSelectOption<ListResourceKey>> {
  return keys.map((key) => ({ value: key, label: getResourceLabel(key) }));
}

function updateAppearance(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["appearance"]>,
): KviewUserSettingsV2 {
  return {
    ...settings,
    appearance: { ...settings.appearance, ...patch },
  };
}

function updateSmartFilters(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["smartFilters"]>,
): KviewUserSettingsV2 {
  return {
    ...settings,
    smartFilters: { ...settings.smartFilters, ...patch },
  };
}

function updateResourceTags(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["resourceTags"]>,
): KviewUserSettingsV2 {
  return {
    ...settings,
    resourceTags: { ...settings.resourceTags, ...patch },
  };
}

function updateResourceMacros(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["resourceMacros"]>,
): KviewUserSettingsV2 {
  return {
    ...settings,
    resourceMacros: { ...settings.resourceMacros, ...patch },
  };
}

function updateDynamicLinks(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["dynamicLinks"]>,
): KviewUserSettingsV2 {
  return {
    ...settings,
    dynamicLinks: { ...settings.dynamicLinks, ...patch },
  };
}

function updateKeyboard(
  settings: KviewUserSettingsV2,
  patch: Partial<KeyboardSettings>,
): KviewUserSettingsV2 {
  return {
    ...settings,
    keyboard: { ...settings.keyboard, ...patch },
  };
}

function updateCustomCommands(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["customCommands"]>,
): KviewUserSettingsV2 {
  return {
    ...settings,
    customCommands: { ...settings.customCommands, ...patch },
  };
}

function updateCustomActions(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["customActions"]>,
): KviewUserSettingsV2 {
  return {
    ...settings,
    customActions: { ...settings.customActions, ...patch },
  };
}

function updateDataplane(settings: KviewUserSettingsV2, patch: Partial<DataplaneSettings>): KviewUserSettingsV2 {
  return {
    ...settings,
    dataplane: { ...settings.dataplane, global: { ...settings.dataplane.global, ...patch } },
  };
}

function suggestedResourceTagColor(usedColors: readonly string[]): string {
  const used = new Set(usedColors.map((color) => color.toLowerCase()));
  return resourceTagColorPresets.find((color) => !used.has(color.toLowerCase())) || resourceTagColorPresets[used.size % resourceTagColorPresets.length];
}

function newResourceTagDefinition(usedColors: readonly string[]): ResourceTagDefinition {
  return {
    id: `tag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: "New tag",
    color: suggestedResourceTagColor(usedColors),
  };
}

function newResourceAutoTagRule(tagIds: string[]): ResourceAutoTagRuleDefinition {
  return {
    id: `auto-tag-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    enabled: true,
    tagIds: tagIds.slice(0, 1),
    context: "",
    resources: [],
    source: "name",
    key: "",
    pattern: "",
    flags: "",
  };
}

function ResourceTagColorPicker({
  color,
  definitions,
  index,
  onChange,
  compact = false,
}: {
  color: string;
  definitions: ResourceTagDefinition[];
  index: number;
  onChange: (color: string) => void;
  compact?: boolean;
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const normalizedColor = /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#607d8b";
  const open = Boolean(anchorEl);

  return (
    <>
      {compact ? (
        <AppIconButton
          tooltip={`Edit tag color ${normalizedColor}`}
          label={`Edit tag color ${normalizedColor}`}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{
            width: 32,
            height: 32,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            flex: "0 0 auto",
          }}
        >
          <Box
            aria-hidden
            sx={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              bgcolor: normalizedColor,
              border: "1px solid",
              borderColor: "divider",
            }}
          />
        </AppIconButton>
      ) : (
        <AppButton
          startIcon={
            <Box
              aria-hidden
              sx={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                bgcolor: normalizedColor,
                border: "1px solid",
                borderColor: "divider",
              }}
            />
          }
          endIcon={<PaletteOutlinedIcon fontSize="small" />}
          onClick={(event) => setAnchorEl(event.currentTarget)}
          sx={{ justifyContent: "space-between", minWidth: 132 }}
        >
          {color}
        </AppButton>
      )}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: {
              p: 1.25,
              width: 276,
              display: "flex",
              flexDirection: "column",
              gap: 1.25,
            },
          },
        }}
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", gap: 1 }}>
          <TextField
            type="color"
            size="small"
            label="Pick"
            value={normalizedColor}
            onChange={(event) => onChange(event.target.value)}
            sx={{ "& input": { cursor: "pointer" } }}
          />
          <TextField
            size="small"
            label="Hex"
            value={color}
            onChange={(event) => onChange(event.target.value)}
          />
        </Box>
        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
            Suggested colors
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 0.5 }}>
            {resourceTagColorPresets.map((presetColor) => {
              const selected = color.toLowerCase() === presetColor.toLowerCase();
              const usedByOther = definitions.some((other, otherIndex) =>
                otherIndex !== index && other.color.toLowerCase() === presetColor.toLowerCase(),
              );
              return (
                <AppIconButton
                  key={presetColor}
                  tooltip={usedByOther ? `${presetColor} already used` : presetColor}
                  label={`Use tag color ${presetColor}`}
                  onClick={() => {
                    onChange(presetColor);
                    setAnchorEl(null);
                  }}
                  sx={{
                    width: 26,
                    height: 26,
                    border: "1px solid",
                    borderColor: selected ? "primary.main" : "divider",
                    opacity: usedByOther && !selected ? 0.45 : 1,
                  }}
                >
                  <Box
                    aria-hidden
                    sx={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      bgcolor: presetColor,
                      boxShadow: selected ? "0 0 0 2px var(--bg-primary), 0 0 0 4px currentColor" : "none",
                    }}
                  />
                </AppIconButton>
              );
            })}
          </Box>
        </Box>
      </Popover>
    </>
  );
}

function newResourceMacroDefinition(): ResourceMacroDefinition {
  return {
    id: `macro-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    enabled: true,
    macroName: "JIRA_URL",
    value: "https://jira.example.com",
    scope: { scope: "global", context: "", namespace: "", node: "", resource: "", name: "" },
  };
}

function newResourceMacroExtractor(): ResourceMacroExtractorDefinition {
  return {
    id: `extractor-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    enabled: true,
    macroName: "JIRA_ISSUE",
    resources: [],
    source: "name",
    key: "",
    pattern: "([A-Z]+-[0-9]+)",
    flags: "",
    valueTemplate: "$1",
    transform: "none",
  };
}

function newDynamicLinkDefinition(): DynamicLinkDefinition {
  return {
    id: `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    enabled: true,
    label: "External link",
    urlTemplate: "$JIRA_URL/browse/$JIRA_ISSUE",
  };
}

function parseResourceList(value: string): ListResourceKey[] {
  const allowed = new Set(smartFilterResourceKeysForScope("all"));
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter((item): item is ListResourceKey =>
    allowed.has(item as ListResourceKey),
  )));
}

function selectValues(primary: string, values: readonly string[]): string[] {
  return Array.from(new Set([primary, ...values].map((value) => value.trim()).filter(Boolean)));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch as T) ?? base;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const prev = out[key];
    if (isPlainObject(prev) && isPlainObject(value)) out[key] = deepMerge(prev, value);
    else out[key] = value;
  }
  return out as T;
}

function stripUndefinedDeep<T>(value: T): T | undefined {
  if (Array.isArray(value)) return value as T;
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const normalized = stripUndefinedDeep(child);
    if (normalized === undefined) continue;
    if (isPlainObject(normalized) && Object.keys(normalized).length === 0) continue;
    next[key] = normalized;
  }
  return Object.keys(next).length > 0 ? (next as T) : undefined;
}

function settingsValueEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => settingsValueEqual(item, right[index]));
  }
  if (isPlainObject(left) || isPlainObject(right)) {
    if (!isPlainObject(left) || !isPlainObject(right)) return false;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      if (!settingsValueEqual(left[key], right[key])) return false;
    }
    return true;
  }
  return left === right;
}

function pruneContextOverrideValue(value: unknown, globalValue: unknown): unknown {
  if (Array.isArray(value)) return settingsValueEqual(value, globalValue) ? undefined : value;
  if (!isPlainObject(value)) return settingsValueEqual(value, globalValue) ? undefined : value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const pruned = pruneContextOverrideValue(child, isPlainObject(globalValue) ? globalValue[key] : undefined);
    if (pruned === undefined) continue;
    if (isPlainObject(pruned) && Object.keys(pruned).length === 0) continue;
    out[key] = pruned;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function pruneContextOverride(
  override: DataplaneContextOverrideSettings,
  global: DataplaneSettings,
): DataplaneContextOverrideSettings | undefined {
  return pruneContextOverrideValue(override, global) as DataplaneContextOverrideSettings | undefined;
}

function rulePatternError(rule: SmartFilterRule): string | null {
  if (!rule.pattern.trim()) return "Pattern is required.";
  try {
    new RegExp(rule.pattern, rule.flags);
    return null;
  } catch (err) {
    return (err as Error).message || "Invalid regex.";
  }
}

function commandPatternError(command: CustomCommandDefinition): string | null {
  if (!command.containerPattern.trim()) return null;
  try {
    new RegExp(command.containerPattern);
    return null;
  } catch (err) {
    return (err as Error).message || "Invalid regex.";
  }
}

function actionPatternError(action: CustomActionDefinition): string | null {
  if (!action.containerPattern.trim()) return null;
  try {
    new RegExp(action.containerPattern);
    return null;
  } catch (err) {
    return (err as Error).message || "Invalid regex.";
  }
}

function actionPatchError(action: CustomActionDefinition): string | null {
  if (action.action !== "patch") return null;
  if (!action.patchBody.trim()) return "Patch body is required.";
  try {
    JSON.parse(action.patchBody);
    return null;
  } catch (err) {
    return (err as Error).message || "Invalid JSON patch body.";
  }
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = items.slice();
  const current = next[index];
  next[index] = next[nextIndex];
  next[nextIndex] = current;
  return next;
}

function smartFilterResourceHelperText(scope: SettingsScopeMode): string {
  switch (scope) {
    case "cluster":
      return "Cluster-scoped resources only.";
    case "namespace":
      return "Namespace-scoped resources only.";
    case "all":
    default:
      return "All list resources.";
  }
}

function transferSectionLabel(sectionID: SettingsTransferSection): string {
  return settingsTransferSections.find((section) => section.id === sectionID)?.label || sectionID;
}

function transferSectionSummary(bundle: SettingsTransferBundleV1, sectionID: SettingsTransferSection): string {
  const section = bundle.sections[sectionID];
  switch (sectionID) {
    case "resourceTags": {
      const tags = bundle.sections.resourceTags;
      if (!tags) return "No resource tags";
      const assignments = Object.keys(tags.assignments).length;
      return `${tags.definitions.length} tag${tags.definitions.length === 1 ? "" : "s"}, ${assignments} assignment${assignments === 1 ? "" : "s"}`;
    }
    case "favourites": {
      const favourites = bundle.sections.favourites?.favouriteNamespacesByContext || {};
      const contexts = Object.keys(favourites).length;
      const namespaces = Object.values(favourites).reduce((sum, items) => sum + items.length, 0);
      return `${namespaces} namespace${namespaces === 1 ? "" : "s"} across ${contexts} context${contexts === 1 ? "" : "s"}`;
    }
    case "smartFilters": {
      const count = bundle.sections.smartFilters?.rules.length || 0;
      return `${count} rule${count === 1 ? "" : "s"}`;
    }
    case "customCommands": {
      const count = bundle.sections.customCommands?.commands.length || 0;
      return `${count} command${count === 1 ? "" : "s"}`;
    }
    case "customActions": {
      const count = bundle.sections.customActions?.actions.length || 0;
      return `${count} action${count === 1 ? "" : "s"}`;
    }
    case "signalSettings": {
      const signalSettings = bundle.sections.signalSettings;
      if (!signalSettings) return "No signal settings";
      const globalOverrides = Object.keys(signalSettings.global.overrides || {}).length;
      const contextOverrides = Object.keys(signalSettings.contextOverrides || {}).length;
      return `${globalOverrides} global override${globalOverrides === 1 ? "" : "s"}, ${contextOverrides} context override${contextOverrides === 1 ? "" : "s"}`;
    }
    case "signalAcknowledgements": {
      const contexts = bundle.sections.signalAcknowledgements || {};
      const contextCount = Object.keys(contexts).length;
      const ackCount = Object.values(contexts).reduce((sum, records) => sum + Object.keys(records).length, 0);
      return `${ackCount} acknowledgement${ackCount === 1 ? "" : "s"} across ${contextCount} context${contextCount === 1 ? "" : "s"}`;
    }
    default:
      return section ? "Included" : "Not included";
  }
}

function HighlightedJsonTextArea({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const theme = useTheme();
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const prismTheme = theme.palette.mode === "dark" ? oneDark : oneLight;
  const code = value || " ";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      <Typography variant="subtitle2">Paste JSON</Typography>
      <Box
        sx={{
          position: "relative",
          height: 220,
          minHeight: 140,
          maxHeight: 520,
          resize: "vertical",
          overflow: "hidden",
          border: "1px solid var(--code-border)",
          borderRadius: 1,
          backgroundColor: "var(--code-bg)",
          "&:focus-within": {
            borderColor: "primary.main",
            boxShadow: (activeTheme) => `0 0 0 1px ${activeTheme.palette.primary.main}`,
          },
        }}
      >
        <Box
          ref={highlightRef}
          aria-hidden="true"
          sx={{
            position: "absolute",
            inset: 0,
            overflow: "auto",
            pointerEvents: "none",
            "& pre, & code, & .token": {
              textShadow: "none !important",
            },
            "& pre": {
              minHeight: "100%",
            },
          }}
        >
          <SyntaxHighlighter
            language="json"
            style={prismTheme}
            customStyle={{
              margin: 0,
              minHeight: "100%",
              background: "transparent",
              color: "var(--code-text)",
              textShadow: "none",
              fontSize: "0.82rem",
              lineHeight: 1.5,
              padding: "12px",
            }}
            codeTagProps={{
              style: { color: "var(--code-text)", textShadow: "none" },
            }}
          >
            {code}
          </SyntaxHighlighter>
        </Box>
        <Box
          component="textarea"
          aria-label="Paste JSON"
          spellCheck={false}
          value={value}
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
          onScroll={(event: React.UIEvent<HTMLTextAreaElement>) => {
            if (!highlightRef.current) return;
            highlightRef.current.scrollTop = event.currentTarget.scrollTop;
            highlightRef.current.scrollLeft = event.currentTarget.scrollLeft;
          }}
          sx={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            m: 0,
            p: "12px",
            border: 0,
            outline: 0,
            resize: "none",
            overflow: "auto",
            boxSizing: "border-box",
            backgroundColor: "transparent",
            color: "transparent",
            caretColor: "var(--text-primary)",
            fontFamily: "monospace",
            fontSize: "0.82rem",
            lineHeight: 1.5,
            whiteSpace: "pre",
            tabSize: 2,
            "&::selection": {
              backgroundColor: "rgba(25, 118, 210, 0.28)",
              color: "transparent",
            },
          }}
        />
      </Box>
    </Box>
  );
}

export default function SettingsView({
  token,
  contexts,
  namespaces,
  activeContext,
  activeNamespace,
  appState,
  setAppState,
  onClose,
}: Props) {
  const { settings, setSettings, replaceSettings, resetSettings } = useUserSettings();
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [dataplaneTab, setDataplaneTab] = useState<DataplaneTab>("overview");
  const [linksMacrosTab, setLinksMacrosTab] = useState<LinksMacrosTab>("manual");
  const [resourceTagsTab, setResourceTagsTab] = useState<ResourceTagsTab>("manual");
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState<{ severity: "success" | "error"; text: string } | null>(null);
  const [transferSections, setTransferSections] = useState<SettingsTransferSection[]>(["resourceTags", "favourites"]);
  const [transferImportSections, setTransferImportSections] = useState<SettingsTransferSection[]>([]);
  const [transferStrategy, setTransferStrategy] = useState<SettingsTransferMergeStrategy>("useImported");
  const [transferReviewOpen, setTransferReviewOpen] = useState(false);
  const [pendingTransferBundle, setPendingTransferBundle] = useState<SettingsTransferBundleV1 | null>(null);
  const [pendingTransferText, setPendingTransferText] = useState("");
  const [transferDialogMessage, setTransferDialogMessage] = useState<{ severity: "success" | "error"; text: string } | null>(null);
  const [transferImportBusy, setTransferImportBusy] = useState(false);
  const [performanceSnapshot, setPerformanceSnapshot] = useState("");
  const [performanceSnapshotError, setPerformanceSnapshotError] = useState("");
  const [performanceSnapshotLoading, setPerformanceSnapshotLoading] = useState(false);
  const [signalCatalog, setSignalCatalog] = useState<DataplaneSignalCatalogItem[]>([]);
  const [signalCatalogError, setSignalCatalogError] = useState<string | null>(null);
  const [dataplaneEditScope, setDataplaneEditScope] = useState<"global" | "context">("global");
  const [signalCatalogQuery, setSignalCatalogQuery] = useState("");

  const contextOptions = useMemo(
    () => Array.from(new Set([activeContext, ...contexts.map((c) => c.name)].filter(Boolean))),
    [activeContext, contexts],
  );
  const namespaceOptions = useMemo(
    () => Array.from(new Set([activeNamespace, ...namespaces].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [activeNamespace, namespaces],
  );

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || isSettingsEscapeBlocked(event.target)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  useEffect(() => {
    if (section !== "dataplane" || dataplaneTab !== "signals") return;
    let cancelled = false;
    apiGetWithContext<ApiDataplaneSignalCatalogResponse>("/api/dataplane/signals/catalog", token, activeContext)
      .then((res) => {
        if (cancelled) return;
        setSignalCatalog(res.items || []);
        setSignalCatalogError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setSignalCatalogError((err as Error).message || "Failed to load signal catalog.");
      });
    return () => {
      cancelled = true;
    };
  }, [activeContext, dataplaneTab, section, settings.dataplane.global.signals.overrides, settings.dataplane.contextOverrides, token]);

  const setRule = (index: number, patch: Partial<SmartFilterRule>) => {
    setSettings((prev) => {
      const rules = prev.smartFilters.rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule));
      return updateSmartFilters(prev, { rules });
    });
  };

  const setCommand = (index: number, patch: Partial<CustomCommandDefinition>) => {
    setSettings((prev) => {
      const commands = prev.customCommands.commands.map((command, i) =>
        i === index ? { ...command, ...patch } : command,
      );
      return updateCustomCommands(prev, { commands });
    });
  };

  const setAction = (index: number, patch: Partial<CustomActionDefinition>) => {
    setSettings((prev) => {
      const actions = prev.customActions.actions.map((action, i) =>
        i === index ? { ...action, ...patch } : action,
      );
      return updateCustomActions(prev, { actions });
    });
  };

  const updateContextDataplaneOverride = (
    prev: KviewUserSettingsV2,
    updater: (current: DataplaneContextOverrideSettings) => DataplaneContextOverrideSettings,
  ): KviewUserSettingsV2 => {
    const contextName = activeContext.trim();
    if (!contextName) return prev;
    const contextOverrides = { ...prev.dataplane.contextOverrides };
    const current = contextOverrides[contextName] || {};
    const next = stripUndefinedDeep(pruneContextOverride(updater(current), prev.dataplane.global));
    if (next) contextOverrides[contextName] = next;
    else delete contextOverrides[contextName];
    return { ...prev, dataplane: { ...prev.dataplane, contextOverrides } };
  };

  const patchDataplaneSection = <K extends keyof DataplaneSettings>(
    key: K,
    patch: Partial<DataplaneSettings[K]>,
  ) => {
    setSettings((prev) => {
      if (dataplaneEditScope === "global") {
        return updateDataplane(prev, {
          [key]: deepMerge(prev.dataplane.global[key], patch),
        } as Partial<DataplaneSettings>);
      }
      return updateContextDataplaneOverride(prev, (current) => ({
        ...current,
        [key]: deepMerge((current[key] || {}) as DataplaneSettings[K], patch),
      }));
    });
  };

  const setDataplanePrimitive = <K extends keyof DataplaneSettings>(key: K, value: DataplaneSettings[K]) => {
    setSettings((prev) => {
      if (dataplaneEditScope === "global") return updateDataplane(prev, { [key]: value } as Partial<DataplaneSettings>);
      return updateContextDataplaneOverride(prev, (current) => ({ ...current, [key]: value }));
    });
  };

  const setNamespaceEnrichment = (patch: Partial<DataplaneSettings["namespaceEnrichment"]>) => {
    patchDataplaneSection("namespaceEnrichment", patch);
  };

  const setNamespaceSweep = (patch: Partial<DataplaneSettings["namespaceEnrichment"]["sweep"]>) => {
    patchDataplaneSection("namespaceEnrichment", {
      sweep: patch as DataplaneSettings["namespaceEnrichment"]["sweep"],
    });
  };

  const setAllContextEnrichment = (patch: Partial<DataplaneSettings["allContextEnrichment"]>) => {
    patchDataplaneSection("allContextEnrichment", patch);
  };

  const setDataplaneSnapshots = (patch: Partial<DataplaneSettings["snapshots"]>) => {
    patchDataplaneSection("snapshots", patch);
  };

  const setDataplanePersistence = (patch: Partial<DataplaneSettings["persistence"]>) => {
    patchDataplaneSection("persistence", patch);
  };

  const setDataplaneObservers = (patch: Partial<DataplaneSettings["observers"]>) => {
    patchDataplaneSection("observers", patch);
  };

  const setDataplaneBudget = (patch: Partial<DataplaneSettings["backgroundBudget"]>) => {
    patchDataplaneSection("backgroundBudget", patch);
  };

  const setDataplaneDashboard = (patch: Partial<DataplaneSettings["dashboard"]>) => {
    patchDataplaneSection("dashboard", patch);
  };
  const setDataplaneMetrics = (patch: Partial<DataplaneSettings["metrics"]>) => {
    patchDataplaneSection("metrics", patch);
  };

  const setContextMetricsEnabled = (enabled: boolean) => {
    setDataplaneMetrics({ enabled });
  };

  const resetContextMetricsOverride = () => {
    setSettings((prev) => {
      if (dataplaneEditScope !== "context") return prev;
      return updateContextDataplaneOverride(prev, (current) => ({ ...current, metrics: undefined }));
    });
  };
  const setDataplaneSignals = (patch: Partial<DataplaneSettings["signals"]>) => {
    setSettings((prev) => {
      const sanitizeSignals = (next: DataplaneSettings["signals"]) => {
        if (next.quotaCriticalPercent <= next.quotaWarnPercent) {
          const defaults = defaultDataplaneSettings().signals;
          next.quotaWarnPercent = defaults.quotaWarnPercent;
          next.quotaCriticalPercent = defaults.quotaCriticalPercent;
        }
        if (next.detectors.resource_quota_pressure.criticalPercent <= next.detectors.resource_quota_pressure.warnPercent) {
          const defaults = defaultDataplaneSettings().signals;
          next.detectors.resource_quota_pressure.warnPercent = defaults.detectors.resource_quota_pressure.warnPercent;
          next.detectors.resource_quota_pressure.criticalPercent = defaults.detectors.resource_quota_pressure.criticalPercent;
        }
        return next;
      };
      if (dataplaneEditScope === "global") {
        return updateDataplane(prev, {
          signals: sanitizeSignals(deepMerge(prev.dataplane.global.signals, patch)),
        });
      }
      const contextSignals = dataplaneSettingsForContext(prev.dataplane, activeContext).signals;
      return updateContextDataplaneOverride(prev, (current) => ({
        ...current,
        signals: sanitizeSignals(
          deepMerge(contextSignals, patch),
        ),
      }));
    });
  };

  const setSignalOverride = (
    signalType: string,
    scope: "global" | "context",
    patch: Partial<SignalOverride>,
    inherited: Partial<SignalOverride> = {},
  ) => {
    if (!signalType) return;
    setSettings((prev) => {
      const signals = prev.dataplane.global.signals;
      const cleanOverride = (override: SignalOverride): SignalOverride | null => {
        const next: SignalOverride = { ...override, ...patch };
        if (next.enabled === undefined) delete next.enabled;
        if (next.severity === undefined) delete next.severity;
        if (next.priority === undefined) delete next.priority;
        if (next.enabled !== undefined && next.enabled === inherited.enabled) delete next.enabled;
        if (next.severity !== undefined && next.severity === inherited.severity) delete next.severity;
        if (next.priority !== undefined && next.priority === inherited.priority) delete next.priority;
        return Object.keys(next).length > 0 ? next : null;
      };
      if (scope === "global") {
        const overrides = { ...signals.overrides };
        const next = cleanOverride(overrides[signalType] || {});
        if (next) overrides[signalType] = next;
        else delete overrides[signalType];
        return updateDataplane(prev, { signals: { ...signals, overrides } });
      }
      const contextName = activeContext.trim();
      if (!contextName) return prev;
      const contextOverrides = { ...prev.dataplane.contextOverrides };
      const current = { ...(contextOverrides[contextName]?.signals?.overrides || {}) };
      const next = cleanOverride(current[signalType] || {});
      if (next) current[signalType] = next;
      else delete current[signalType];
      const existing = contextOverrides[contextName] || {};
      const nextOverride: DataplaneContextOverrideSettings = {
        ...existing,
        signals: Object.keys(current).length > 0
          ? { ...(existing.signals || {}), overrides: current }
          : undefined,
      };
      const cleaned = stripUndefinedDeep(nextOverride);
      if (cleaned) contextOverrides[contextName] = cleaned;
      else delete contextOverrides[contextName];
      return { ...prev, dataplane: { ...prev.dataplane, contextOverrides } };
    });
  };

  const resetSignalOverride = (signalType: string, scope: "global" | "context") => {
    setSettings((prev) => {
      const signals = prev.dataplane.global.signals;
      if (scope === "global") {
        const overrides = { ...signals.overrides };
        delete overrides[signalType];
        return updateDataplane(prev, { signals: { ...signals, overrides } });
      }
      const contextName = activeContext.trim();
      if (!contextName) return prev;
      const contextOverrides = { ...prev.dataplane.contextOverrides };
      const current = { ...(contextOverrides[contextName]?.signals?.overrides || {}) };
      delete current[signalType];
      const existing = contextOverrides[contextName] || {};
      const nextOverride: DataplaneContextOverrideSettings = {
        ...existing,
        signals: Object.keys(current).length > 0
          ? { ...(existing.signals || {}), overrides: current }
          : undefined,
      };
      const cleaned = stripUndefinedDeep(nextOverride);
      if (cleaned) contextOverrides[contextName] = cleaned;
      else delete contextOverrides[contextName];
      return { ...prev, dataplane: { ...prev.dataplane, contextOverrides } };
    });
  };

  const transferBundle = useMemo(() => {
    if (!importText.trim()) return null;
    try {
      return parseSettingsTransferJSON(importText);
    } catch {
      return null;
    }
  }, [importText]);

  useEffect(() => {
    if (!transferBundle) return;
    setTransferImportSections(settingsTransferSectionIds(transferBundle));
  }, [transferBundle]);

  const toggleTransferSection = (
    sectionID: SettingsTransferSection,
    value: boolean,
    setter: React.Dispatch<React.SetStateAction<SettingsTransferSection[]>>,
  ) => {
    setter((prev) => {
      const exists = prev.includes(sectionID);
      if (value && !exists) return [...prev, sectionID];
      if (!value && exists) return prev.filter((id) => id !== sectionID);
      return prev;
    });
  };

  const openTransferReview = (text: string, bundle: SettingsTransferBundleV1) => {
    const available = settingsTransferSectionIds(bundle);
    setImportText(text);
    setPendingTransferText(text);
    setPendingTransferBundle(bundle);
    setTransferImportSections(available);
    setTransferDialogMessage(null);
    setTransferReviewOpen(true);
    setImportMessage(null);
  };

  const exportTransferSettings = async () => {
    if (transferSections.length === 0) {
      setImportMessage({ severity: "error", text: "Select at least one section to export." });
      return;
    }
    try {
      let signalAcknowledgements: Record<string, Record<string, {
        acknowledgedAt: number;
        acknowledgedBy?: string;
        comment?: string;
        updatedAt: number;
      }>> | undefined;
      if (transferSections.includes("signalAcknowledgements") && activeContext) {
        const res = await apiGet<{ active: string; items: Record<string, {
          acknowledgedAt: number;
          acknowledgedBy?: string;
          comment?: string;
          updatedAt: number;
        }> }>("/api/dataplane/signals/ack/export", token);
        signalAcknowledgements = res.active ? { [res.active]: res.items || {} } : {};
      }
      const blob = new Blob([
        exportSettingsTransferJSON({ settings, appState, sections: transferSections, signalAcknowledgements }),
      ], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "kview-settings-transfer.json";
      a.click();
      URL.revokeObjectURL(url);
      setImportMessage({ severity: "success", text: "Transfer bundle exported." });
    } catch (err) {
      setImportMessage({ severity: "error", text: (err as Error).message || "Export failed." });
    }
  };

  const applyTransferImport = async (bundle: SettingsTransferBundleV1, text: string) => {
    const available = settingsTransferSectionIds(bundle);
    const selected = transferImportSections.filter((id) => available.includes(id));
    if (selected.length === 0) {
      setTransferDialogMessage({ severity: "error", text: "Select at least one transfer section to import." });
      return;
    }
    setTransferImportBusy(true);
    setTransferDialogMessage(null);
    try {
      const applied = applySettingsTransferBundle({
        settings,
        appState,
        bundle,
        sections: selected,
        strategy: transferStrategy,
      });
      if (selected.includes("signalAcknowledgements") && bundle.sections.signalAcknowledgements) {
        await apiPost("/api/dataplane/signals/ack/import", token, {
          strategy: transferStrategy,
          contexts: bundle.sections.signalAcknowledgements,
        });
      }
      replaceSettings(applied.settings);
      setAppState(applied.appState);
      setImportText(text);
      setTransferDialogMessage({
        severity: "success",
        text: `${selected.length} section${selected.length === 1 ? "" : "s"} imported with "${settingsTransferMergeStrategies.find((item) => item.id === transferStrategy)?.label || transferStrategy}".`,
      });
      setImportMessage({ severity: "success", text: "Transfer bundle imported." });
    } catch (err) {
      const message = (err as Error).message || "Import failed.";
      setTransferDialogMessage({ severity: "error", text: message });
      setImportMessage({ severity: "error", text: message });
    } finally {
      setTransferImportBusy(false);
    }
  };

  const importSettingsText = (text: string) => {
    let transfer: ReturnType<typeof parseSettingsTransferJSON> | null = null;
    try {
      transfer = parseSettingsTransferJSON(text);
    } catch {
      // Not a transfer bundle; try the legacy full-profile importer below.
    }
    if (transfer) {
      openTransferReview(text, transfer);
      return;
    }
    try {
      const imported = parseUserSettingsJSON(text);
      if (!window.confirm("Import settings and overwrite the current settings profile?")) return;
      replaceSettings(imported);
      setImportText(text);
      setImportMessage({ severity: "success", text: "Settings imported." });
    } catch (err) {
      setImportMessage({ severity: "error", text: (err as Error).message || "Import failed." });
    }
  };

  const importSettingsFile = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      importSettingsText(text);
    } catch (err) {
      setImportMessage({ severity: "error", text: (err as Error).message || "Failed to read settings file." });
    }
  };

  const capturePerformanceSnapshot = async () => {
    setPerformanceSnapshotLoading(true);
    setPerformanceSnapshotError("");
    try {
      let backend: unknown;
      let backendError = "";
      try {
        backend = await apiGet<unknown>("/api/performance/snapshot", token, { useDefaultContext: false });
      } catch (err) {
        backendError = (err as Error | undefined)?.message || "Backend snapshot failed.";
      }
      setPerformanceSnapshot(JSON.stringify(buildPerformanceDiagnosticsReport(backend, backendError), null, 2));
    } catch (err) {
      setPerformanceSnapshotError((err as Error | undefined)?.message || "Failed to capture performance snapshot.");
    } finally {
      setPerformanceSnapshotLoading(false);
    }
  };

  const copyPerformanceSnapshot = async () => {
    if (!performanceSnapshot) return;
    try {
      await window.navigator.clipboard.writeText(performanceSnapshot);
    } catch (err) {
      setPerformanceSnapshotError((err as Error | undefined)?.message || "Failed to copy performance snapshot.");
    }
  };

  const renderAppearance = () => (
    <Box sx={settingsStackSx}>
      <SettingSection title="Appearance" icon={<SettingsIcon name="appearance" />}>
        <SettingRow
          label="Check for kview updates"
          checked={settings.appearance.releaseChecksEnabled}
          onChange={(v) => setSettings((prev) => updateAppearance(prev, { releaseChecksEnabled: v }))}
        />
        <SettingRow
          label="Smart YAML collapse"
          hint="Auto-collapses noisy sections (e.g. managedFields) in resource YAML panels and enables per-block fold toggles"
          checked={settings.appearance.yamlSmartCollapse}
          onChange={(v) => setSettings((prev) => updateAppearance(prev, { yamlSmartCollapse: v }))}
        />
        <SettingRow
          label="Smart namespace sorting"
          hint="Prioritizes recently used favourites, then other favourites, recent namespaces, and the remaining namespaces."
          checked={settings.appearance.smartNamespaceSorting}
          onChange={(v) => setSettings((prev) => updateAppearance(prev, { smartNamespaceSorting: v }))}
        />
        <SettingRow
          label="Combined dashboard signal filters"
          hint="Allows multiple cluster dashboard signal chips to be selected at once and narrows the remaining chip choices to matching signals."
          checked={settings.appearance.dashboardCombinedSignalFilters}
          onChange={(v) => setSettings((prev) => updateAppearance(prev, { dashboardCombinedSignalFilters: v }))}
        />
        <SettingRow
          label="Dashboard favourite namespace filters"
          hint="Shows cluster dashboard signal filter chips for favourited namespaces in the active context."
          checked={settings.appearance.dashboardFavouriteNamespaceFilters}
          onChange={(v) => setSettings((prev) => updateAppearance(prev, { dashboardFavouriteNamespaceFilters: v }))}
        />
        <SettingRow
          label="Dashboard recent namespace filters"
          hint="Shows cluster dashboard signal filter chips for recently visited namespaces in the active context."
          checked={settings.appearance.dashboardRecentNamespaceFilters}
          onChange={(v) => setSettings((prev) => updateAppearance(prev, { dashboardRecentNamespaceFilters: v }))}
        />
        <SettingRow
          label="Recent menu"
          hint="Shows a Recent section at the top of the side navigation with recently opened resource sections."
          checked={settings.appearance.recentMenuEnabled}
          onChange={(v) => setSettings((prev) => updateAppearance(prev, { recentMenuEnabled: v }))}
        />
        <SettingGrid>
          <SettingField
            label="Recent menu limit"
            hint="Maximum resource sections shown in the side navigation Recent section."
            type="number"
            min={1}
            max={20}
            value={settings.appearance.recentMenuLimit}
            onChange={(v) =>
              setSettings((prev) => updateAppearance(prev, { recentMenuLimit: Number(v) || 1 }))
            }
          />
        </SettingGrid>
      </SettingSection>

      <SettingSection
        title="Performance Diagnostics"
        icon={<QueryStatsIcon fontSize="small" />}
        hint="Optional diagnostics for feedback builds. Long-task collection runs only while enabled; backend memory and goroutine data is captured only when requested."
      >
        <SettingRow
          label="Enable diagnostics"
          hint="Collects browser long-task samples while this browser profile is active."
          checked={settings.appearance.performanceDiagnosticsEnabled}
          onChange={(v) => setSettings((prev) => updateAppearance(prev, { performanceDiagnosticsEnabled: v }))}
        />
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          <AppButton
            startIcon={<QueryStatsIcon />}
            disabled={!settings.appearance.performanceDiagnosticsEnabled || performanceSnapshotLoading}
            onClick={capturePerformanceSnapshot}
          >
            {performanceSnapshotLoading ? "Capturing..." : "Capture snapshot"}
          </AppButton>
          <AppButton
            startIcon={<ContentCopyIcon />}
            disabled={!performanceSnapshot}
            onClick={copyPerformanceSnapshot}
          >
            Copy JSON
          </AppButton>
        </Box>
        {performanceSnapshotError ? <Alert severity="warning">{performanceSnapshotError}</Alert> : null}
        {performanceSnapshot ? (
          <TextField
            value={performanceSnapshot}
            multiline
            minRows={8}
            maxRows={14}
            fullWidth
            size="small"
            slotProps={{ htmlInput: { readOnly: true } }}
          />
        ) : null}
      </SettingSection>
    </Box>
  );

  const renderKeyboard = () => {
    const summaryRows = [
      {
        label: "Always on",
        keys: ["?", ":", "Ctrl+K", "/", "t", "Enter", "g sequences", "[", "]"],
      },
      {
        label: "Table movement",
        keys: [
          "Arrow keys",
          ...(settings.keyboard.vimTableNavigation ? ["h/j/k/l"] : []),
          ...(settings.keyboard.homeRowTableNavigation ? ["a/s/d/f"] : []),
        ],
      },
      {
        label: "Header search",
        keys: [
          "Ctrl+K",
          ...(settings.keyboard.singleLetterGlobalSearch ? ["s"] : []),
        ],
      },
    ];
    return (
      <SettingSection
        title="Keyboard"
        icon={<SettingsIcon name="keyboard" />}
        hint="Command mode and core browser-safe shortcuts stay enabled; these options tune the extra convenience bindings."
      >
        <Box sx={settingsSummaryPanelSx}>
          {summaryRows.map((row) => (
            <Box
              key={row.label}
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "150px minmax(0, 1fr)" },
                gap: 0.75,
                alignItems: "center",
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {row.label}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap", minWidth: 0 }}>
                {row.keys.map((key) => (
                  <Chip
                    key={key}
                    size="small"
                    variant="outlined"
                    label={key}
                    sx={{
                      height: 22,
                      borderRadius: 1,
                      fontFamily: "monospace",
                      fontSize: "0.72rem",
                      "& .MuiChip-label": { px: 0.75 },
                    }}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
        <SettingRow
          label="Vim table navigation"
          hint="Enables h/j/k/l for focused resource tables."
          checked={settings.keyboard.vimTableNavigation}
          onChange={(v) => setSettings((prev) => updateKeyboard(prev, { vimTableNavigation: v }))}
        />
        <SettingRow
          label="Home-row table navigation"
          hint="Enables a/s/d/f for focused resource tables."
          checked={settings.keyboard.homeRowTableNavigation}
          onChange={(v) => setSettings((prev) => updateKeyboard(prev, { homeRowTableNavigation: v }))}
        />
        <SettingRow
          label="Single-letter global search"
          hint="Lets s focus the header search and command input when you are not typing. Ctrl+K always remains enabled."
          checked={settings.keyboard.singleLetterGlobalSearch}
          onChange={(v) => setSettings((prev) => updateKeyboard(prev, { singleLetterGlobalSearch: v }))}
        />
      </SettingSection>
    );
  };

  const renderRule = (rule: SmartFilterRule, index: number) => {
    const error = rulePatternError(rule);
    const resourceOptions = smartFilterResourceKeysForScope(rule.scope);
    return (
      <Box key={rule.id} sx={settingsItemCardSx}>
        <Box sx={headerRowSx}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            Rule {index + 1}
          </Typography>
          <ReorderButtons
            label={`rule ${index + 1}`}
            index={index}
            lastIndex={settings.smartFilters.rules.length - 1}
            onUp={() => setSettings((prev) => updateSmartFilters(prev, { rules: moveItem(prev.smartFilters.rules, index, -1) }))}
            onDown={() => setSettings((prev) => updateSmartFilters(prev, { rules: moveItem(prev.smartFilters.rules, index, 1) }))}
            onRemove={() =>
              setSettings((prev) =>
                updateSmartFilters(prev, { rules: prev.smartFilters.rules.filter((_, i) => i !== index) }),
              )
            }
          />
        </Box>
        <SettingRow
          label="Enabled"
          checked={rule.enabled}
          onChange={(v) => setRule(index, { enabled: v })}
        />
        <SettingGrid variant="auto">
          <SettingField label="Context scope">
            <TextField
              select
              size="small"
              fullWidth
              value={rule.context || "__all"}
              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
              onChange={(e) => setRule(index, { context: e.target.value === "__all" ? "" : e.target.value })}
            >
              <MenuItem value="__all">All contexts</MenuItem>
              {contextOptions.map((ctx) => (
                <MenuItem key={ctx} value={ctx}>
                  {ctx}
                </MenuItem>
              ))}
            </TextField>
          </SettingField>
          <SettingField label="Cluster scope">
            <TextField
              select
              size="small"
              fullWidth
              value={rule.scope}
              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
              onChange={(e) => {
                const scope = e.target.value as SettingsScopeMode;
                const allowed = new Set(smartFilterResourceKeysForScope(scope));
                setRule(index, {
                  scope,
                  resources: rule.resources.filter((key) => allowed.has(key)),
                });
              }}
            >
              <MenuItem value="all">All</MenuItem>
              <MenuItem value="cluster">Cluster-scoped lists</MenuItem>
              <MenuItem value="namespace">Namespace-scoped lists</MenuItem>
            </TextField>
          </SettingField>
          <SettingField
            label="Namespace"
            hint={rule.scope === "namespace" ? "Leave as Any namespace for all namespace-scoped lists." : "Only used for namespace-scoped rules."}
          >
            <TextField
              select
              size="small"
              fullWidth
              value={rule.namespace || "__any"}
              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
              onChange={(e) => setRule(index, { namespace: e.target.value === "__any" ? "" : e.target.value })}
              disabled={rule.scope !== "namespace"}
            >
              <MenuItem value="__any">Any namespace</MenuItem>
              {namespaceOptions.map((ns) => (
                <MenuItem key={ns} value={ns}>
                  {ns}
                </MenuItem>
              ))}
            </TextField>
          </SettingField>
          <SettingField label="Resource scope">
            <TextField
              select
              size="small"
              fullWidth
              value={rule.resourceScope}
              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
              onChange={(e) => setRule(index, { resourceScope: e.target.value as SettingsResourceScopeMode })}
            >
              <MenuItem value="any">Any resource</MenuItem>
              <MenuItem value="selected">Selected resources</MenuItem>
            </TextField>
          </SettingField>
        </SettingGrid>
        {rule.resourceScope === "selected" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
            <SettingsMultiSelect<ListResourceKey>
              id={`resources-${rule.id}`}
              label={(
                <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                  Resources
                  <InfoHint title={smartFilterResourceHelperText(rule.scope)} />
                </Box>
              )}
              value={rule.resources}
              options={resourceMultiSelectOptions(resourceOptions)}
              onChange={(resources) => setRule(index, { resources })}
              emptyLabel="No resources selected"
              menuProps={denseSelectMenuProps}
            />
          </Box>
        ) : null}
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "minmax(260px, 2fr) minmax(120px, 0.6fr) minmax(180px, 1fr)" }}>
          <SettingField
            label="Regex match pattern"
            required
            value={rule.pattern}
            onChange={(v) => setRule(index, { pattern: v })}
            error={error ?? undefined}
            hint="Matched against the row name."
          />
          <SettingField
            label="Flags"
            value={rule.flags}
            onChange={(v) => setRule(index, { flags: sanitizeRegexFlags(v) })}
            hint="Allowed: d g i m s u v y"
          />
          <SettingField
            label="Display template"
            value={rule.display}
            onChange={(v) => setRule(index, { display: v })}
            hint="JavaScript replacement syntax, e.g. $1."
          />
        </Box>
      </Box>
    );
  };

  const renderSmartFilters = () => (
    <SettingSection
      title="Smart Filters"
      icon={<SettingsIcon name="smartFilters" />}
      hint="Rules are evaluated in order; each row stops at the first matching rule. Current quick filter chips are generated from these rules when smart filters are enabled."
      actions={
        <AppButton
          intent="primary"
          onClick={() =>
            setSettings((prev) =>
              updateSmartFilters(prev, { rules: [...prev.smartFilters.rules, newSmartFilterRule()] }),
            )
          }
        >
          Add rule
        </AppButton>
      }
    >
      <SettingRow
        label="Enable smart filters"
        checked={settings.appearance.smartFiltersEnabled}
        onChange={(v) => setSettings((prev) => updateAppearance(prev, { smartFiltersEnabled: v }))}
      />
      <Box sx={{ maxWidth: 240 }}>
        <SettingField
          label="Minimum rows per chip"
          type="number"
          value={settings.smartFilters.minCount}
          onChange={(v) =>
            setSettings((prev) =>
              updateSmartFilters(prev, {
                minCount: Math.max(1, Math.min(50, Math.round(Number(v) || 1))),
              }),
            )
          }
          hint="Range: 1-50"
          min={1}
          max={50}
        />
      </Box>
      {settings.smartFilters.rules.map(renderRule)}
    </SettingSection>
  );

  const setResourceTag = (index: number, patch: Partial<ResourceTagDefinition>) => {
    setSettings((prev) => {
      const definitions = prev.resourceTags.definitions.map((definition, i) =>
        i === index ? { ...definition, ...patch } : definition,
      );
      return updateResourceTags(prev, { definitions });
    });
  };

  const setResourceAutoTagRule = (index: number, patch: Partial<ResourceAutoTagRuleDefinition>) => {
    setSettings((prev) => {
      const autoTagRules = prev.resourceTags.autoTagRules.map((rule, i) =>
        i === index ? { ...rule, ...patch } : rule,
      );
      return updateResourceTags(prev, { autoTagRules });
    });
  };

  const removeResourceTag = (index: number) => {
    setSettings((prev) => {
      const removed = prev.resourceTags.definitions[index];
      if (!removed) return prev;
      const definitions = prev.resourceTags.definitions.filter((_, i) => i !== index);
      const assignments = Object.fromEntries(
        Object.entries(prev.resourceTags.assignments)
          .map(([key, tagIds]) => [key, tagIds.filter((id) => id !== removed.id)] as const)
          .filter(([, tagIds]) => tagIds.length > 0),
      );
      const autoTagRules = prev.resourceTags.autoTagRules
        .map((rule) => ({
          ...rule,
          tagIds: rule.tagIds.filter((id) => id !== removed.id),
        }))
        .filter((rule) => rule.tagIds.length > 0);
      return updateResourceTags(prev, { definitions, assignments, autoTagRules });
    });
  };

  const resourceTagAssignmentCount = (tagId: string): number =>
    Object.values(settings.resourceTags.assignments).filter((tagIds) => tagIds.includes(tagId)).length;

  const addResourceTag = () =>
    setSettings((prev) =>
      updateResourceTags(prev, {
        definitions: [
          ...prev.resourceTags.definitions,
          newResourceTagDefinition(prev.resourceTags.definitions.map((tag) => tag.color)),
        ],
      }),
    );

  const addResourceAutoTagRule = () =>
    setSettings((prev) =>
      updateResourceTags(prev, {
        autoTagRules: [
          ...prev.resourceTags.autoTagRules,
          newResourceAutoTagRule(prev.resourceTags.definitions.map((tag) => tag.id)),
        ],
      }),
    );

  const renderResourceTags = () => (
    <SettingSection
      title="Resource Tags"
      icon={<SettingsIcon name="resourceTags" />}
      hint="Personal tags are stored in kview settings and never written to Kubernetes resources."
      actions={
        <AppButton
          intent="primary"
          onClick={resourceTagsTab === "auto" ? addResourceAutoTagRule : addResourceTag}
          disabled={resourceTagsTab === "auto" && settings.resourceTags.definitions.length === 0}
        >
          {resourceTagsTab === "auto" ? "Add rule" : "Add tag"}
        </AppButton>
      }
    >
      <SettingRow
        label="Enable resource tags"
        hint="Shows tag columns in resource lists and tag controls in supported drawer headers."
        checked={settings.resourceTags.enabled}
        onChange={(v) => setSettings((prev) => updateResourceTags(prev, { enabled: v }))}
      />
      <SettingRow
        label="Inherit namespace tags"
        hint="Namespace-scoped resources automatically show tags assigned to their namespace."
        checked={settings.resourceTags.inheritNamespaceTags}
        onChange={(v) => setSettings((prev) => updateResourceTags(prev, { inheritNamespaceTags: v }))}
      />
      <SettingRow
        label="Show tag quick filters"
        hint="Adds tag chips to resource list quick filters when Resource Tags and Smart Filters are enabled."
        checked={settings.resourceTags.quickFiltersEnabled}
        onChange={(v) => setSettings((prev) => updateResourceTags(prev, { quickFiltersEnabled: v }))}
      />
      <SettingRow
        label="Cleanup missing resource assignments"
        hint="When an authoritative fresh resource list confirms a non-namespace resource is gone, direct tag assignments in that visible scope are removed."
        checked={settings.resourceTags.cleanupMissingAssignments}
        onChange={(v) => setSettings((prev) => updateResourceTags(prev, { cleanupMissingAssignments: v }))}
      />
      <Tabs
        value={resourceTagsTab}
        onChange={(_, value) => setResourceTagsTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={settingsTabsSx}
      >
        {resourceTagsTabs.map((item) => (
          <Tab
            key={item.value}
            value={item.value}
            icon={<SettingsIcon name={item.icon} size={16} />}
            iconPosition="start"
            label={item.label}
          />
        ))}
      </Tabs>
      {resourceTagsTab === "manual" ? (
        <>
      {settings.resourceTags.definitions.length === 0 ? (
        <Alert severity="info" variant="outlined">
          Define at least one tag to start tagging resources.
        </Alert>
      ) : null}
      {settings.resourceTags.definitions.map((tag, index) => (
        <Box key={tag.id} sx={{ ...settingsItemCardSx, p: 1, gap: 0.5 }}>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "auto minmax(160px, 1fr) auto",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <ResourceTagColorPicker
              color={tag.color}
              definitions={settings.resourceTags.definitions}
              index={index}
              onChange={(color) => setResourceTag(index, { color })}
              compact
            />
            <TextField
              size="small"
              value={tag.name}
              onChange={(event) => setResourceTag(index, { name: event.target.value.slice(0, 32) })}
              placeholder="Tag name"
              fullWidth
              slotProps={{ htmlInput: { "aria-label": `Tag ${index + 1} name` } }}
            />
            <ReorderButtons
              label={`tag ${index + 1}`}
              index={index}
              lastIndex={settings.resourceTags.definitions.length - 1}
              onUp={() => setSettings((prev) => updateResourceTags(prev, { definitions: moveItem(prev.resourceTags.definitions, index, -1) }))}
              onDown={() => setSettings((prev) => updateResourceTags(prev, { definitions: moveItem(prev.resourceTags.definitions, index, 1) }))}
              onRemove={() => removeResourceTag(index)}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ pl: 5 }}>
            {resourceTagAssignmentCount(tag.id)} direct resource assignment{resourceTagAssignmentCount(tag.id) === 1 ? "" : "s"}
          </Typography>
        </Box>
      ))}
        </>
      ) : null}
      {resourceTagsTab === "auto" ? (
        <>
          {settings.resourceTags.definitions.length === 0 ? (
            <Alert severity="info" variant="outlined">
              Create at least one tag before adding auto-tagging rules.
            </Alert>
          ) : null}
          {settings.resourceTags.autoTagRules.length === 0 ? (
            <Alert severity="info" variant="outlined">
              Add rules to assign existing tags from resource names, labels, or annotations.
            </Alert>
          ) : null}
          {settings.resourceTags.autoTagRules.map((rule, index) => (
            <Box key={rule.id} sx={settingsItemCardSx}>
              <Box sx={headerRowSx}>
                <Chip
                  size="small"
                  label={rule.tagIds
                    .map((tagId) => settings.resourceTags.definitions.find((tag) => tag.id === tagId)?.name || tagId)
                    .join(", ") || "No tags"}
                />
                <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                  {rule.source}{rule.key ? `:${rule.key}` : ""} / {rule.pattern || "no pattern"}
                </Typography>
                <ReorderButtons
                  label={`auto-tag rule ${index + 1}`}
                  index={index}
                  lastIndex={settings.resourceTags.autoTagRules.length - 1}
                  onUp={() => setSettings((prev) => updateResourceTags(prev, { autoTagRules: moveItem(prev.resourceTags.autoTagRules, index, -1) }))}
                  onDown={() => setSettings((prev) => updateResourceTags(prev, { autoTagRules: moveItem(prev.resourceTags.autoTagRules, index, 1) }))}
                  onRemove={() => setSettings((prev) => updateResourceTags(prev, { autoTagRules: prev.resourceTags.autoTagRules.filter((_, i) => i !== index) }))}
                />
              </Box>
              <SettingRow
                label="Enabled"
                checked={rule.enabled}
                onChange={(value) => setResourceAutoTagRule(index, { enabled: value })}
              />
              <SettingGrid variant="auto">
                <SettingField label="Tags">
                  <SettingsMultiSelect<string>
                    id={`auto-tag-tags-${rule.id}`}
                    label="Tags"
                    value={rule.tagIds}
                    options={settings.resourceTags.definitions.map((tag) => ({ value: tag.id, label: tag.name }))}
                    onChange={(tagIds) => setResourceAutoTagRule(index, { tagIds })}
                    emptyLabel="No tags selected"
                    menuProps={denseSelectMenuProps}
                  />
                </SettingField>
                <SettingField label="Context">
                  <TextField
                    select
                    size="small"
                    value={rule.context || "__any"}
                    onChange={(event) => setResourceAutoTagRule(index, { context: event.target.value === "__any" ? "" : event.target.value })}
                    fullWidth
                    slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
                  >
                    <MenuItem value="__any">Any context</MenuItem>
                    {contextOptions.map((contextName) => <MenuItem key={contextName} value={contextName}>{contextName}</MenuItem>)}
                  </TextField>
                </SettingField>
                <SettingField label="Resources">
                  <SettingsMultiSelect<ListResourceKey>
                    id={`auto-tag-resources-${rule.id}`}
                    label="Resources"
                    value={rule.resources}
                    options={resourceMultiSelectOptions(resourceOptions)}
                    onChange={(resources) => setResourceAutoTagRule(index, { resources })}
                    emptyLabel="Any resource"
                    menuProps={denseSelectMenuProps}
                  />
                </SettingField>
                <SettingField label="Source">
                  <TextField
                    select
                    size="small"
                    value={rule.source}
                    onChange={(event) => setResourceAutoTagRule(index, {
                      source: event.target.value as ResourceAutoTagRuleDefinition["source"],
                      key: event.target.value === "name" ? "" : rule.key,
                    })}
                    fullWidth
                  >
                    <MenuItem value="name">name</MenuItem>
                    <MenuItem value="label">label</MenuItem>
                    <MenuItem value="annotation">annotation</MenuItem>
                  </TextField>
                </SettingField>
                <SettingField label="Key" value={rule.key} onChange={(value) => setResourceAutoTagRule(index, { key: value })} disabled={rule.source === "name"} />
                <SettingField label="Pattern" value={rule.pattern} onChange={(value) => setResourceAutoTagRule(index, { pattern: value })} />
                <SettingField label="Flags" value={rule.flags} onChange={(value) => setResourceAutoTagRule(index, { flags: sanitizeRegexFlags(value) })} />
              </SettingGrid>
            </Box>
          ))}
        </>
      ) : null}
    </SettingSection>
  );

  const setMacroDefinition = (index: number, patch: Partial<ResourceMacroDefinition>) => {
    setSettings((prev) => {
      const definitions = prev.resourceMacros.definitions.map((definition, i) =>
        i === index ? { ...definition, ...patch } : definition,
      );
      return updateResourceMacros(prev, { definitions });
    });
  };

  const setMacroExtractor = (index: number, patch: Partial<ResourceMacroExtractorDefinition>) => {
    setSettings((prev) => {
      const extractors = prev.resourceMacros.extractors.map((extractor, i) =>
        i === index ? { ...extractor, ...patch } : extractor,
      );
      return updateResourceMacros(prev, { extractors });
    });
  };

  const setDynamicLink = (index: number, patch: Partial<DynamicLinkDefinition>) => {
    setSettings((prev) => {
      const definitions = prev.dynamicLinks.definitions.map((definition, i) =>
        i === index ? { ...definition, ...patch } : definition,
      );
      return updateDynamicLinks(prev, { definitions });
    });
  };
  const macroContextOptions = useMemo(() => selectValues(activeContext, contexts.map((ctx) => ctx.name)), [activeContext, contexts]);
  const macroNamespaceOptions = useMemo(() => selectValues(activeNamespace, namespaces), [activeNamespace, namespaces]);
  const resourceOptions = useMemo(() => smartFilterResourceKeysForScope("all"), []);

  const renderLinksMacros = () => (
    <SettingSection
      title="Links & Macros"
      icon={<SettingsIcon name="linksMacros" />}
      hint="Resource macros and dynamic links are local settings. They are resolved in resource drawers from names, labels, annotations, and scoped manual values."
    >
      <SettingRow
        label="Enable resource macros"
        hint="Allows manual and extracted macros to be resolved for resource drawers."
        checked={settings.resourceMacros.enabled}
        onChange={(v) => setSettings((prev) => updateResourceMacros(prev, { enabled: v }))}
      />
      <SettingRow
        label="Enable dynamic links"
        hint="Shows resolved external links in supported resource drawer headers."
        checked={settings.dynamicLinks.enabled}
        onChange={(v) => setSettings((prev) => updateDynamicLinks(prev, { enabled: v }))}
      />
      <Tabs
        value={linksMacrosTab}
        onChange={(_, value) => setLinksMacrosTab(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={settingsTabsSx}
      >
        {linksMacrosTabs.map((item) => (
          <Tab
            key={item.value}
            value={item.value}
            icon={<SettingsIcon name={item.icon} size={16} />}
            iconPosition="start"
            label={item.label}
          />
        ))}
      </Tabs>
      {linksMacrosTab === "manual" ? (
        <>
          <Box sx={{ ...settingsSubsectionHeaderSx, justifyContent: "flex-end" }}>
            <AppButton intent="primary" onClick={() => setSettings((prev) => updateResourceMacros(prev, { definitions: [...prev.resourceMacros.definitions, newResourceMacroDefinition()] }))}>
              Add macro
            </AppButton>
          </Box>
        {settings.resourceMacros.definitions.length === 0 ? (
          <Alert severity="info" variant="outlined">Define shared values such as JIRA_URL or GITLAB_URL.</Alert>
        ) : null}
        {settings.resourceMacros.definitions.map((definition, index) => (
          <Box key={definition.id} sx={settingsItemCardSx}>
            <Box sx={headerRowSx}>
              <Chip size="small" label={`$${definition.macroName}`} />
              <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                {definition.scope.scope}
              </Typography>
              <ReorderButtons
                label={`macro ${index + 1}`}
                index={index}
                lastIndex={settings.resourceMacros.definitions.length - 1}
                onUp={() => setSettings((prev) => updateResourceMacros(prev, { definitions: moveItem(prev.resourceMacros.definitions, index, -1) }))}
                onDown={() => setSettings((prev) => updateResourceMacros(prev, { definitions: moveItem(prev.resourceMacros.definitions, index, 1) }))}
                onRemove={() => setSettings((prev) => updateResourceMacros(prev, { definitions: prev.resourceMacros.definitions.filter((_, i) => i !== index) }))}
              />
            </Box>
            <SettingRow
              label="Enabled"
              checked={definition.enabled}
              onChange={(v) => setMacroDefinition(index, { enabled: v })}
            />
            <SettingGrid variant="auto">
              <SettingField label="Macro" value={definition.macroName} onChange={(value) => setMacroDefinition(index, { macroName: value.replace(/^\$/, "").toUpperCase() })} />
              <SettingField label="Value" value={definition.value} onChange={(value) => setMacroDefinition(index, { value })} />
              <SettingField label="Scope">
                <TextField select size="small" value={definition.scope.scope} onChange={(event) => setMacroDefinition(index, { scope: { ...definition.scope, scope: event.target.value as ResourceMacroDefinition["scope"]["scope"] } })} fullWidth>
                  {["global", "context", "namespace", "node", "resource"].map((scope) => <MenuItem key={scope} value={scope}>{scope}</MenuItem>)}
                </TextField>
              </SettingField>
              {definition.scope.scope !== "global" ? (
                <SettingField label="Context">
                  <TextField select size="small" value={definition.scope.context} onChange={(event) => setMacroDefinition(index, { scope: { ...definition.scope, context: event.target.value } })} fullWidth>
                    <MenuItem value="">Any context</MenuItem>
                    {macroContextOptions.map((contextName) => <MenuItem key={contextName} value={contextName}>{contextName}</MenuItem>)}
                  </TextField>
                </SettingField>
              ) : null}
              {definition.scope.scope === "namespace" || definition.scope.scope === "resource" ? (
                <SettingField label="Namespace">
                  <TextField select size="small" value={definition.scope.namespace} onChange={(event) => setMacroDefinition(index, { scope: { ...definition.scope, namespace: event.target.value } })} fullWidth>
                    <MenuItem value="">Any namespace</MenuItem>
                    {macroNamespaceOptions.map((namespaceName) => <MenuItem key={namespaceName} value={namespaceName}>{namespaceName}</MenuItem>)}
                  </TextField>
                </SettingField>
              ) : null}
              {definition.scope.scope === "node" ? (
                <SettingField label="Node" value={definition.scope.node} onChange={(value) => setMacroDefinition(index, { scope: { ...definition.scope, node: value } })} placeholder="Any node" />
              ) : null}
              {definition.scope.scope === "resource" ? (
                <>
                  <SettingField label="Resource">
                    <TextField select size="small" value={definition.scope.resource} onChange={(event) => setMacroDefinition(index, { scope: { ...definition.scope, resource: event.target.value as ListResourceKey | "" } })} fullWidth>
                      <MenuItem value="">Any resource type</MenuItem>
                      {resourceOptions.map((resource) => <MenuItem key={resource} value={resource}>{getResourceLabel(resource)}</MenuItem>)}
                    </TextField>
                  </SettingField>
                  <SettingField label="Name" value={definition.scope.name} onChange={(value) => setMacroDefinition(index, { scope: { ...definition.scope, name: value } })} placeholder="Any resource name" />
                </>
              ) : null}
            </SettingGrid>
          </Box>
        ))}
        </>
      ) : null}

      {linksMacrosTab === "extractors" ? (
        <>
          <Box sx={{ ...settingsSubsectionHeaderSx, justifyContent: "flex-end" }}>
            <AppButton intent="primary" onClick={() => setSettings((prev) => updateResourceMacros(prev, { extractors: [...prev.resourceMacros.extractors, newResourceMacroExtractor()] }))}>Add extractor</AppButton>
          </Box>
        {settings.resourceMacros.extractors.length === 0 ? (
          <Alert severity="info" variant="outlined">Add an extractor to derive macros from names, labels, or annotations.</Alert>
        ) : null}
        {settings.resourceMacros.extractors.map((extractor, index) => (
          <Box key={extractor.id} sx={settingsItemCardSx}>
            <Box sx={headerRowSx}>
              <Chip size="small" label={`$${extractor.macroName}`} />
              <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                {extractor.source}
              </Typography>
              <ReorderButtons
                label={`extractor ${index + 1}`}
                index={index}
                lastIndex={settings.resourceMacros.extractors.length - 1}
                onUp={() => setSettings((prev) => updateResourceMacros(prev, { extractors: moveItem(prev.resourceMacros.extractors, index, -1) }))}
                onDown={() => setSettings((prev) => updateResourceMacros(prev, { extractors: moveItem(prev.resourceMacros.extractors, index, 1) }))}
                onRemove={() => setSettings((prev) => updateResourceMacros(prev, { extractors: prev.resourceMacros.extractors.filter((_, i) => i !== index) }))}
              />
            </Box>
            <SettingRow label="Enabled" checked={extractor.enabled} onChange={(v) => setMacroExtractor(index, { enabled: v })} />
            <SettingGrid variant="auto">
              <SettingField label="Macro" value={extractor.macroName} onChange={(value) => setMacroExtractor(index, { macroName: value.replace(/^\$/, "").toUpperCase() })} />
              <SettingField label="Resources">
                <SettingsMultiSelect<ListResourceKey>
                  id={`macro-extractor-resources-${extractor.id}`}
                  label="Resources"
                  value={extractor.resources}
                  options={resourceMultiSelectOptions(resourceOptions)}
                  onChange={(resources) => setMacroExtractor(index, { resources })}
                  emptyLabel="Any resource"
                  menuProps={denseSelectMenuProps}
                />
              </SettingField>
              <SettingField label="Source">
                <TextField select size="small" value={extractor.source} onChange={(event) => setMacroExtractor(index, { source: event.target.value as ResourceMacroExtractorDefinition["source"] })} fullWidth>
                  {["name", "label", "annotation"].map((source) => <MenuItem key={source} value={source}>{source}</MenuItem>)}
                </TextField>
              </SettingField>
              <SettingField label="Key" value={extractor.key} onChange={(value) => setMacroExtractor(index, { key: value })} disabled={extractor.source === "name"} />
              <SettingField label="Pattern" value={extractor.pattern} onChange={(value) => setMacroExtractor(index, { pattern: value })} />
              <SettingField label="Flags" value={extractor.flags} onChange={(value) => setMacroExtractor(index, { flags: sanitizeRegexFlags(value) })} />
              <SettingField label="Value template" value={extractor.valueTemplate} onChange={(value) => setMacroExtractor(index, { valueTemplate: value })} />
              <SettingField label="Transform">
                <TextField select size="small" value={extractor.transform} onChange={(event) => setMacroExtractor(index, { transform: event.target.value as ResourceMacroExtractorDefinition["transform"] })} fullWidth>
                  <MenuItem value="none">None</MenuItem>
                  <MenuItem value="uppercase">Uppercase</MenuItem>
                  <MenuItem value="lowercase">Lowercase</MenuItem>
                  <MenuItem value="ucfirst">Uppercase first letter</MenuItem>
                </TextField>
              </SettingField>
            </SettingGrid>
          </Box>
        ))}
        </>
      ) : null}

      {linksMacrosTab === "links" ? (
        <>
          <Box sx={{ ...settingsSubsectionHeaderSx, justifyContent: "flex-end" }}>
            <AppButton intent="primary" onClick={() => setSettings((prev) => updateDynamicLinks(prev, { definitions: [...prev.dynamicLinks.definitions, newDynamicLinkDefinition()] }))}>Add link</AppButton>
          </Box>
        {settings.dynamicLinks.definitions.length === 0 ? (
          <Alert severity="info" variant="outlined">Add a link template such as $GITLAB_URL/$GITLAB_PROJECT.</Alert>
        ) : null}
        {settings.dynamicLinks.definitions.map((link, index) => (
          <Box key={link.id} sx={settingsItemCardSx}>
            <Box sx={headerRowSx}>
              <Chip size="small" label={link.label || "Link"} />
              <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" }}>
                {link.urlTemplate}
              </Typography>
              <ReorderButtons
                label={`dynamic link ${index + 1}`}
                index={index}
                lastIndex={settings.dynamicLinks.definitions.length - 1}
                onUp={() => setSettings((prev) => updateDynamicLinks(prev, { definitions: moveItem(prev.dynamicLinks.definitions, index, -1) }))}
                onDown={() => setSettings((prev) => updateDynamicLinks(prev, { definitions: moveItem(prev.dynamicLinks.definitions, index, 1) }))}
                onRemove={() => setSettings((prev) => updateDynamicLinks(prev, { definitions: prev.dynamicLinks.definitions.filter((_, i) => i !== index) }))}
              />
            </Box>
            <SettingRow label="Enabled" checked={link.enabled} onChange={(v) => setDynamicLink(index, { enabled: v })} />
            <SettingGrid variant="auto">
              <SettingField label="Label" value={link.label} onChange={(value) => setDynamicLink(index, { label: value })} />
              <SettingField label="URL template" value={link.urlTemplate} onChange={(value) => setDynamicLink(index, { urlTemplate: value })} />
            </SettingGrid>
          </Box>
        ))}
        </>
      ) : null}
    </SettingSection>
  );

  const renderCommand = (command: CustomCommandDefinition, index: number) => {
    const patternError = commandPatternError(command);
    return (
      <Box key={command.id} sx={settingsItemCardSx}>
        <Box sx={headerRowSx}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            Command {index + 1}
          </Typography>
          <ReorderButtons
            label={`command ${index + 1}`}
            index={index}
            lastIndex={settings.customCommands.commands.length - 1}
            onUp={() =>
              setSettings((prev) =>
                updateCustomCommands(prev, {
                  commands: moveItem(prev.customCommands.commands, index, -1),
                }),
              )
            }
            onDown={() =>
              setSettings((prev) =>
                updateCustomCommands(prev, {
                  commands: moveItem(prev.customCommands.commands, index, 1),
                }),
              )
            }
            onRemove={() =>
              setSettings((prev) =>
                updateCustomCommands(prev, {
                  commands: prev.customCommands.commands.filter((_, i) => i !== index),
                }),
              )
            }
          />
        </Box>
        <SettingRow
          label="Enabled"
          checked={command.enabled}
          onChange={(v) => setCommand(index, { enabled: v })}
        />
        <SettingGrid variant="auto">
          <SettingField
            label="Name"
            value={command.name}
            onChange={(v) => setCommand(index, { name: v })}
            hint="Shown in the container command menu."
          />
          <SettingField
            label="Container pattern"
            value={command.containerPattern}
            onChange={(v) => setCommand(index, { containerPattern: v })}
            error={patternError ?? undefined}
            hint="Optional regex matched against the container name."
          />
          <SettingField
            label="Workdir"
            value={command.workdir}
            onChange={(v) => setCommand(index, { workdir: v })}
            hint="Optional. Leave blank to use the container default."
          />
        </SettingGrid>
        <SettingField
          label="Command"
          required
          value={command.command}
          onChange={(v) => setCommand(index, { command: v })}
          error={!command.command.trim() ? "Required." : undefined}
          hint="Executed with /bin/sh -lc inside the selected container."
        />
        <SettingGrid variant="auto">
          <SettingField label="Output type">
            <TextField
              select
              size="small"
              fullWidth
              value={command.outputType}
              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
              onChange={(e) => setCommand(index, { outputType: e.target.value as CustomCommandOutputType })}
            >
              <MenuItem value="text">Free text</MenuItem>
              <MenuItem value="keyValue">Key-value</MenuItem>
              <MenuItem value="csv">CSV / delimited table</MenuItem>
              <MenuItem value="code">Code / JSON / YAML</MenuItem>
              <MenuItem value="file">File download</MenuItem>
            </TextField>
          </SettingField>
          <SettingField
            label="Safety"
            hint="Dangerous commands require typed confirmation before execution."
          >
            <TextField
              select
              size="small"
              fullWidth
              value={command.safety}
              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
              onChange={(e) => setCommand(index, { safety: e.target.value as CustomCommandSafety })}
            >
              <MenuItem value="safe">Safe: simple confirmation</MenuItem>
              <MenuItem value="dangerous">Dangerous: typed confirmation</MenuItem>
            </TextField>
          </SettingField>
        </SettingGrid>
        {command.outputType === "code" && (
          <FieldGroup label="Code settings">
            <SettingField
              label="Code language"
              value={command.codeLanguage}
              onChange={(v) => setCommand(index, { codeLanguage: v })}
              hint="Examples: json, yaml, php, shell. Leave blank to auto-detect."
            />
          </FieldGroup>
        )}
        {command.outputType === "file" && (
          <FieldGroup label="File settings">
            <SettingField
              label="File name"
              value={command.fileName}
              onChange={(v) => setCommand(index, { fileName: v })}
              hint="Used for the downloaded output."
            />
            <SettingRow
              label="Compress with gzip"
              checked={command.compress}
              onChange={(v) => setCommand(index, { compress: v })}
            />
          </FieldGroup>
        )}
      </Box>
    );
  };

  const renderCustomCommands = () => (
    <SettingSection
      title="Custom Commands"
      icon={<SettingsIcon name="commands" />}
      hint="Commands are stored in this browser profile and become available on matching Pod containers."
      actions={
        <AppButton
          intent="primary"
          onClick={() =>
            setSettings((prev) =>
              updateCustomCommands(prev, {
                commands: [...prev.customCommands.commands, newCustomCommandDefinition()],
              }),
            )
          }
        >
          Add command
        </AppButton>
      }
    >
      {settings.customCommands.commands.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No custom commands are defined.
        </Typography>
      ) : (
        settings.customCommands.commands.map(renderCommand)
      )}
    </SettingSection>
  );

  const renderAction = (action: CustomActionDefinition, index: number) => {
    const patternError = actionPatternError(action);
    const patchError = actionPatchError(action);
    return (
      <Box key={action.id} sx={settingsItemCardSx}>
        <Box sx={headerRowSx}>
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            Action {index + 1}
          </Typography>
          <ReorderButtons
            label={`action ${index + 1}`}
            index={index}
            lastIndex={settings.customActions.actions.length - 1}
            onUp={() => setSettings((prev) => updateCustomActions(prev, { actions: moveItem(prev.customActions.actions, index, -1) }))}
            onDown={() => setSettings((prev) => updateCustomActions(prev, { actions: moveItem(prev.customActions.actions, index, 1) }))}
            onRemove={() => setSettings((prev) => updateCustomActions(prev, { actions: prev.customActions.actions.filter((_, i) => i !== index) }))}
          />
        </Box>
        <SettingRow
          label="Enabled"
          checked={action.enabled}
          onChange={(v) => setAction(index, { enabled: v })}
        />
        <SettingGrid variant="auto">
          <SettingField
            label="Name"
            value={action.name}
            onChange={(v) => setAction(index, { name: v })}
          />
          <SettingField label="Action">
            <TextField
              select
              size="small"
              fullWidth
              value={action.action}
              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
              onChange={(e) => {
                const nextAction = e.target.value as CustomActionKind;
                setAction(index, {
                  action: nextAction,
                  ...(nextAction === "unset" && action.target === "image" ? { target: "env" as const } : {}),
                });
              }}
            >
              <MenuItem value="set">Set</MenuItem>
              <MenuItem value="unset">Unset</MenuItem>
              <MenuItem value="patch">Patch</MenuItem>
            </TextField>
          </SettingField>
          <SettingField label="Safety" hint="Dangerous actions require typed confirmation before execution.">
            <TextField
              select
              size="small"
              fullWidth
              value={action.safety}
              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
              onChange={(e) => setAction(index, { safety: e.target.value as CustomCommandSafety })}
            >
              <MenuItem value="safe">Safe: simple confirmation</MenuItem>
              <MenuItem value="dangerous">Dangerous: typed confirmation</MenuItem>
            </TextField>
          </SettingField>
        </SettingGrid>
        <SettingsMultiSelect<ListResourceKey>
          id={`action-resources-${action.id}`}
          label="Resources"
          value={action.resources}
          options={resourceMultiSelectOptions(customActionResourceKeys)}
          onChange={(resources) => setAction(index, { resources })}
          emptyLabel="No resources selected"
          menuProps={denseSelectMenuProps}
        />
        {action.action === "patch" ? (
          <FieldGroup label="Patch settings">
            <Box sx={{ maxWidth: 240 }}>
              <SettingField label="Patch type">
                <TextField
                  select
                  size="small"
                  fullWidth
                  value={action.patchType}
                  slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
                  onChange={(e) => setAction(index, { patchType: e.target.value as CustomActionPatchType })}
                >
                  <MenuItem value="merge">Merge patch</MenuItem>
                  <MenuItem value="json">JSON patch</MenuItem>
                </TextField>
              </SettingField>
            </Box>
            <SettingField
              label="Patch body JSON"
              error={patchError ?? undefined}
              hint="Use JSON. JSON patch expects an array of operations; merge patch expects an object."
            >
              <TextField
                size="small"
                value={action.patchBody}
                onChange={(e) => setAction(index, { patchBody: e.target.value })}
                error={Boolean(patchError)}
                multiline
                minRows={8}
                fullWidth
                slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: "0.85rem" } } }}
              />
            </SettingField>
          </FieldGroup>
        ) : (
          <FieldGroup label="Target settings">
            <SettingGrid variant="auto">
              <SettingField label="Target">
                <TextField
                  select
                  size="small"
                  fullWidth
                  value={action.target}
                  slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
                  onChange={(e) => setAction(index, { target: e.target.value as CustomActionTarget })}
                >
                  <MenuItem value="env">Environment variable</MenuItem>
                  <MenuItem value="image" disabled={action.action === "unset"}>Container image</MenuItem>
                </TextField>
              </SettingField>
              {action.target === "env" && (
                <SettingField
                  label="Env key"
                  value={action.key}
                  onChange={(v) => setAction(index, { key: v })}
                />
              )}
              <SettingField
                label="Container pattern"
                value={action.containerPattern}
                onChange={(v) => setAction(index, { containerPattern: v })}
                error={patternError ?? undefined}
                hint="Optional regex. Leave blank for all containers."
              />
            </SettingGrid>
            {action.action === "set" && (
              <>
                <SettingField
                  label={action.target === "image" ? "Image" : "Value"}
                  value={action.value}
                  onChange={(v) => setAction(index, { value: v })}
                  disabled={action.runtimeValue}
                />
                <SettingRow
                  label="Ask at runtime"
                  hint="If enabled, the user is prompted for the actual value during action execution."
                  checked={action.runtimeValue}
                  onChange={(v) => setAction(index, { runtimeValue: v })}
                />
              </>
            )}
          </FieldGroup>
        )}
      </Box>
    );
  };

  const renderCustomActions = () => (
    <SettingSection
      title="Custom Actions"
      icon={<SettingsIcon name="actions" />}
      hint="Custom actions are browser-local presets for patch-capable workload resources."
      actions={
        <AppButton
          intent="primary"
          onClick={() => setSettings((prev) => updateCustomActions(prev, { actions: [...prev.customActions.actions, newCustomActionDefinition()] }))}
        >
          Add action
        </AppButton>
      }
    >
      {settings.customActions.actions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No custom actions are defined.
        </Typography>
      ) : (
        settings.customActions.actions.map(renderAction)
      )}
    </SettingSection>
  );

  const currentContextOverride = settings.dataplane.contextOverrides[activeContext.trim()] || {};
  const isContextEditing = dataplaneEditScope === "context" && Boolean(activeContext.trim());
  const getOverrideAtPath = (path: string[]): unknown => {
    let cursor: unknown = currentContextOverride;
    for (const key of path) {
      if (!isPlainObject(cursor) || !(key in cursor)) return undefined;
      cursor = (cursor as Record<string, unknown>)[key];
    }
    return cursor;
  };
  const hasOverrideAtPath = (path: string[]): boolean => getOverrideAtPath(path) !== undefined;
  const resetOverridePath = (path: string[]) => {
    if (!isContextEditing) return;
    setSettings((prev) =>
      updateContextDataplaneOverride(prev, (current) => {
        const next = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
        let cursor: Record<string, unknown> = next;
        for (let i = 0; i < path.length - 1; i += 1) {
          const key = path[i];
          if (!isPlainObject(cursor[key])) return current;
          cursor = cursor[key] as Record<string, unknown>;
        }
        delete cursor[path[path.length - 1]];
        return next as DataplaneContextOverrideSettings;
      }),
    );
  };
  const resetOverrideSection = (sectionKey: keyof DataplaneContextOverrideSettings) => resetOverridePath([sectionKey]);


  const renderDataplane = () => {
    const contextName = activeContext.trim();
    const activeContextOverride = contextName ? (settings.dataplane.contextOverrides[contextName] || {}) : {};
    const contextSignals = activeContextOverride.signals?.overrides || {};
    const dp = dataplaneEditScope === "context"
      ? dataplaneSettingsForContext(settings.dataplane, contextName)
      : settings.dataplane.global;
    const ne = dp.namespaceEnrichment;
    const sweep = ne.sweep;
    const allContext = dp.allContextEnrichment;
    const signalDefaults = defaultDataplaneSettings().signals;
    const signalDetectors = {
      pod_restarts: {
        ...signalDefaults.detectors.pod_restarts,
        ...(dp.signals.detectors?.pod_restarts || {}),
      },
      container_near_limit: {
        ...signalDefaults.detectors.container_near_limit,
        ...(dp.signals.detectors?.container_near_limit || {}),
      },
      node_resource_pressure: {
        ...signalDefaults.detectors.node_resource_pressure,
        ...(dp.signals.detectors?.node_resource_pressure || {}),
      },
      resource_quota_pressure: {
        ...signalDefaults.detectors.resource_quota_pressure,
        ...(dp.signals.detectors?.resource_quota_pressure || {}),
      },
    };
    const profileLabel = dataplaneProfileLabel(dp.profile);
    const profileEnrichmentText = dataplaneProfileEnrichmentText(dp.profile);
    const estimatedSweepHours = sweep.maxNamespacesPerHour > 0 && namespaces.length > 0
      ? Math.ceil(namespaces.length / sweep.maxNamespacesPerHour)
      : 0;
    const activeContextSignalOverrides = contextSignals;
    const signalThresholdPaths = (signalType: string): string[][] => {
      switch (signalType) {
        case "pod_restarts":
          return [["signals", "detectors", "pod_restarts", "restartCount"]];
        case "container_near_limit":
          return [["signals", "detectors", "container_near_limit", "percent"]];
        case "node_resource_pressure":
          return [["signals", "detectors", "node_resource_pressure", "percent"]];
        case "resource_quota_pressure":
          return [
            ["signals", "detectors", "resource_quota_pressure", "warnPercent"],
            ["signals", "detectors", "resource_quota_pressure", "criticalPercent"],
          ];
        case "long_running_job":
          return [["signals", "longRunningJobSec"]];
        case "cronjob_no_recent_success":
          return [["signals", "cronJobNoRecentSuccessSec"]];
        case "stale_transitional_helm_release":
          return [["signals", "staleHelmReleaseSec"]];
        case "potentially_unused_pvc":
        case "potentially_unused_serviceaccount":
          return [["signals", "unusedResourceAgeSec"]];
        case "pod_young_frequent_restarts":
          return [["signals", "podYoungRestartWindowSec"]];
        case "deployment_unavailable":
          return [["signals", "deploymentUnavailableSec"]];
        default:
          return [];
      }
    };
    const signalThresholdCustomized = (signalType: string): boolean => {
      if (dataplaneEditScope === "context" && isContextEditing) {
        return signalThresholdPaths(signalType).some((path) => hasOverrideAtPath(path));
      }
      switch (signalType) {
        case "pod_restarts":
          return signalDetectors.pod_restarts.restartCount !== signalDefaults.detectors.pod_restarts.restartCount;
        case "container_near_limit":
          return signalDetectors.container_near_limit.percent !== signalDefaults.detectors.container_near_limit.percent;
        case "node_resource_pressure":
          return signalDetectors.node_resource_pressure.percent !== signalDefaults.detectors.node_resource_pressure.percent;
        case "resource_quota_pressure":
          return signalDetectors.resource_quota_pressure.warnPercent !== signalDefaults.detectors.resource_quota_pressure.warnPercent ||
            signalDetectors.resource_quota_pressure.criticalPercent !== signalDefaults.detectors.resource_quota_pressure.criticalPercent;
        case "long_running_job":
          return dp.signals.longRunningJobSec !== signalDefaults.longRunningJobSec;
        case "cronjob_no_recent_success":
          return dp.signals.cronJobNoRecentSuccessSec !== signalDefaults.cronJobNoRecentSuccessSec;
        case "stale_transitional_helm_release":
          return dp.signals.staleHelmReleaseSec !== signalDefaults.staleHelmReleaseSec;
        case "potentially_unused_pvc":
        case "potentially_unused_serviceaccount":
          return dp.signals.unusedResourceAgeSec !== signalDefaults.unusedResourceAgeSec;
        case "pod_young_frequent_restarts":
          return dp.signals.podYoungRestartWindowSec !== signalDefaults.podYoungRestartWindowSec;
        case "deployment_unavailable":
          return dp.signals.deploymentUnavailableSec !== signalDefaults.deploymentUnavailableSec;
        default:
          return false;
      }
    };
    const resetSignalCard = (signalType: string) => {
      if (dataplaneEditScope === "context") {
        resetSignalOverride(signalType, "context");
        signalThresholdPaths(signalType).forEach((path) => resetOverridePath(path));
        return;
      }
      resetSignalOverride(signalType, "global");
      switch (signalType) {
        case "pod_restarts":
          setDataplaneSignals({ detectors: { ...signalDetectors, pod_restarts: { ...signalDefaults.detectors.pod_restarts } } });
          break;
        case "container_near_limit":
          setDataplaneSignals({ detectors: { ...signalDetectors, container_near_limit: { ...signalDefaults.detectors.container_near_limit } } });
          break;
        case "node_resource_pressure":
          setDataplaneSignals({ detectors: { ...signalDetectors, node_resource_pressure: { ...signalDefaults.detectors.node_resource_pressure } } });
          break;
        case "resource_quota_pressure":
          setDataplaneSignals({ detectors: { ...signalDetectors, resource_quota_pressure: { ...signalDefaults.detectors.resource_quota_pressure } } });
          break;
        case "long_running_job":
          setDataplaneSignals({ longRunningJobSec: signalDefaults.longRunningJobSec });
          break;
        case "cronjob_no_recent_success":
          setDataplaneSignals({ cronJobNoRecentSuccessSec: signalDefaults.cronJobNoRecentSuccessSec });
          break;
        case "stale_transitional_helm_release":
          setDataplaneSignals({ staleHelmReleaseSec: signalDefaults.staleHelmReleaseSec });
          break;
        case "potentially_unused_pvc":
        case "potentially_unused_serviceaccount":
          setDataplaneSignals({ unusedResourceAgeSec: signalDefaults.unusedResourceAgeSec });
          break;
        case "pod_young_frequent_restarts":
          setDataplaneSignals({ podYoungRestartWindowSec: signalDefaults.podYoungRestartWindowSec });
          break;
        case "deployment_unavailable":
          setDataplaneSignals({ deploymentUnavailableSec: signalDefaults.deploymentUnavailableSec });
          break;
        default:
          break;
      }
    };
    const signalPriorityFor = (item: DataplaneSignalCatalogItem): number => {
      const globalOverride = settings.dataplane.global.signals.overrides[item.type] || {};
      const contextOverride = activeContextSignalOverrides[item.type] || {};
      if (dataplaneEditScope === "context") {
        return contextOverride.priority ?? globalOverride.priority ?? item.defaultPriority;
      }
      return globalOverride.priority ?? item.defaultPriority;
    };
    const orderedSignalCatalog = [...signalCatalog].sort((a, b) => {
      const priorityDelta = signalPriorityFor(a) - signalPriorityFor(b);
      if (priorityDelta !== 0) return priorityDelta;
      return a.label.localeCompare(b.label);
    });
    const orderedSignalIndex = new Map(orderedSignalCatalog.map((item, index) => [item.type, index]));
    const inheritedSignalPriority = (item: DataplaneSignalCatalogItem): number => {
      if (dataplaneEditScope === "context") {
        return settings.dataplane.global.signals.overrides[item.type]?.priority ?? item.defaultPriority;
      }
      return item.defaultPriority;
    };
    const moveSignalPriority = (signalType: string, direction: -1 | 1) => {
      const index = orderedSignalIndex.get(signalType);
      if (index === undefined) return;
      const neighbor = orderedSignalCatalog[index + direction];
      const item = orderedSignalCatalog[index];
      if (!item || !neighbor) return;
      const neighborPriority = signalPriorityFor(neighbor);
      const nextPriority = direction < 0 ? neighborPriority - 1 : neighborPriority + 1;
      const globalOverride = settings.dataplane.global.signals.overrides[item.type] || {};
      const inheritedEnabled = dataplaneEditScope === "context" ? (globalOverride.enabled ?? item.defaultEnabled) : item.defaultEnabled;
      const inheritedSeverity = dataplaneEditScope === "context" ? (globalOverride.severity || item.defaultSeverity || "low") : (item.defaultSeverity || "low");
      setSignalOverride(item.type, dataplaneEditScope, { priority: nextPriority }, {
        enabled: inheritedEnabled,
        severity: inheritedSeverity as SignalOverride["severity"],
        priority: inheritedSignalPriority(item),
      });
    };
    const filteredSignalCatalog = orderedSignalCatalog.filter((item) => {
      const q = signalCatalogQuery.trim().toLowerCase();
      if (!q) return true;
      return [
        item.type,
        item.label,
        item.defaultSeverity,
        item.effectiveSeverity,
        item.likelyCause,
        item.suggestedAction,
      ].some((value) => String(value || "").toLowerCase().includes(q));
    });
    const gbl = settings.dataplane.global;
    const getGblAt = (path: string[]): unknown => {
      let cur: unknown = gbl;
      for (const key of path) {
        if (!isPlainObject(cur) || !(key in (cur as Record<string, unknown>))) return undefined;
        cur = (cur as Record<string, unknown>)[key];
      }
      return cur;
    };
    const os = (path: string[]): "inherited" | "overridden" | undefined =>
      isContextEditing ? (hasOverrideAtPath(path) ? "overridden" : "inherited") : undefined;
    // numChange: for fields that don't track a global path (signal thresholds)
    const numChange = (fn: (n: number) => void) => (v: string) => fn(Math.round(Number(v) || 0));
    // autoNum / autoToggle: like numChange/direct but auto-clear the override when value matches global
    const autoNum = (fn: (n: number) => void, path: string[]) => (v: string) => {
      const n = Math.round(Number(v) || 0);
      fn(n);
      if (isContextEditing && n === getGblAt(path)) resetOverridePath(path);
    };
    const autoToggle = (fn: (v: boolean) => void, path: string[]) => (v: boolean) => {
      fn(v);
      if (isContextEditing && v === getGblAt(path)) resetOverridePath(path);
    };

    return (
      <Box data-testid="settings-section-dataplane" sx={[settingsStackSx, { maxWidth: 900 }]}>
        <SettingSection
          title="Dataplane"
          icon={<SettingsIcon name="dataplane" />}
          hint={
            dataplaneEditScope === "context" && activeContext
              ? `Dataplane controls cached Kubernetes snapshots, namespace enrichment, metrics sampling cadence, and derived signals. Editing sparse overrides for ${activeContext}; unchanged fields inherit from global defaults.`
              : "Dataplane controls cached Kubernetes snapshots, namespace enrichment, metrics sampling cadence, and derived signals. Editing global defaults shared by all contexts without local overrides."
          }
        >
          <Box>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={dataplaneEditScope}
              onChange={(_, value: "global" | "context" | null) => {
                if (!value) return;
                setDataplaneEditScope(value);
              }}
            >
              <ToggleButton value="global">Global defaults</ToggleButton>
              <ToggleButton value="context" disabled={!activeContext}>This context</ToggleButton>
            </ToggleButtonGroup>
          </Box>
          <Tabs
            value={dataplaneTab}
            onChange={(_, value: DataplaneTab) => setDataplaneTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            aria-label="Dataplane settings groups"
            sx={settingsTabsSx}
          >
            {dataplaneTabs.map((item) => (
              <Tab
                key={item.value}
                data-testid={`settings-dataplane-tab-${item.value}`}
                value={item.value}
                icon={<SettingsIcon name={item.icon} size={16} />}
                iconPosition="start"
                label={item.label}
              />
            ))}
          </Tabs>
        </SettingSection>

        {dataplaneTab === "overview" && (
          <>
            <SettingSection
              title="Profile and Scheduler"
              icon={<SettingsIcon name="profile" />}
              hint="Profiles tune observers, enrichment scope, sweep behavior, and scheduler limits together. Manual keeps cached dataplane reads but turns off automatic background work."
              actions={isContextEditing ? (
                <AppIconButton
                  tooltip="Reset section to global"
                  label="Reset section to global"
                  disabled={!hasOverrideAtPath(["profile"]) && !hasOverrideAtPath(["backgroundBudget"])}
                  onClick={() => { resetOverridePath(["profile"]); resetOverrideSection("backgroundBudget"); }}
                >
                  <RestartAltIcon fontSize="inherit" />
                </AppIconButton>
              ) : null}
            >
              <SettingGrid variant="auto">
                <SettingField
                  label="Dataplane profile"
                  hint="Choose the overall dataplane behavior. Profile changes preserve operator-tuned metrics, signals, and persistence settings."
                  overrideState={os(["profile"])}
                  onReset={() => resetOverridePath(["profile"])}
                >
                  <TextField
                    select
                    size="small"
                    fullWidth
                    value={dp.profile}
                    slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
                    onChange={(e) => {
                      const nextProfile = e.target.value as DataplaneProfile;
                      if (dataplaneEditScope === "global") {
                        setSettings((prev) => updateDataplane(prev, applyDataplaneProfile(prev.dataplane.global, nextProfile)));
                        return;
                      }
                      setDataplanePrimitive("profile", nextProfile);
                      if (isContextEditing && nextProfile === gbl.profile) resetOverridePath(["profile"]);
                    }}
                  >
                    <MenuItem value="manual">Manual: user interaction only</MenuItem>
                    <MenuItem value="focused">Focused: current, recent, favourites</MenuItem>
                    <MenuItem value="balanced">Balanced</MenuItem>
                    <MenuItem value="wide">Wide</MenuItem>
                    <MenuItem value="diagnostic">Diagnostic</MenuItem>
                  </TextField>
                </SettingField>
                <SettingField
                  label="Scheduler concurrency"
                  hint="Upper bound for all dataplane snapshot work running at once per cluster."
                  type="number"
                  value={dp.backgroundBudget.maxConcurrentPerCluster}
                  onChange={autoNum((v) => setDataplaneBudget({ maxConcurrentPerCluster: v }), ["backgroundBudget", "maxConcurrentPerCluster"])}
                  overrideState={os(["backgroundBudget", "maxConcurrentPerCluster"])}
                  onReset={() => resetOverridePath(["backgroundBudget", "maxConcurrentPerCluster"])}
                />
                <SettingField
                  label="Background concurrency"
                  hint="Upper bound for non-interactive enrichment and sweep work per cluster."
                  type="number"
                  value={dp.backgroundBudget.maxBackgroundConcurrentPerCluster}
                  onChange={autoNum((v) => setDataplaneBudget({ maxBackgroundConcurrentPerCluster: v }), ["backgroundBudget", "maxBackgroundConcurrentPerCluster"])}
                  overrideState={os(["backgroundBudget", "maxBackgroundConcurrentPerCluster"])}
                  onReset={() => resetOverridePath(["backgroundBudget", "maxBackgroundConcurrentPerCluster"])}
                />
                <SettingField
                  label="Long-run notice"
                  hint="How long snapshot work can run before the activity panel calls attention to it. 0 disables long-running snapshot activity notices."
                  type="number"
                  unit="s"
                  value={dp.backgroundBudget.longRunNoticeSec}
                  onChange={autoNum((v) => setDataplaneBudget({ longRunNoticeSec: v }), ["backgroundBudget", "longRunNoticeSec"])}
                  overrideState={os(["backgroundBudget", "longRunNoticeSec"])}
                  onReset={() => resetOverridePath(["backgroundBudget", "longRunNoticeSec"])}
                />
                <SettingField
                  label="Transient retries"
                  hint="Retry budget for transient dataplane list failures before surfacing the error."
                  type="number"
                  value={dp.backgroundBudget.transientRetries}
                  onChange={autoNum((v) => setDataplaneBudget({ transientRetries: v }), ["backgroundBudget", "transientRetries"])}
                  overrideState={os(["backgroundBudget", "transientRetries"])}
                  onReset={() => resetOverridePath(["backgroundBudget", "transientRetries"])}
                />
              </SettingGrid>
            </SettingSection>

            <SettingSection
              title="Observers and Dashboard"
              icon={<SettingsIcon name="observers" />}
              hint="Observers keep cluster-wide namespace and node snapshots reasonably fresh. Dashboard controls decide how cached dataplane data is summarized."
            >
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <SettingRow label="Observers" hint="Master switch for passive namespace and node observers." checked={dp.observers.enabled} onChange={autoToggle((v) => setDataplaneObservers({ enabled: v }), ["observers", "enabled"])} overrideState={os(["observers", "enabled"])} onReset={() => resetOverridePath(["observers", "enabled"])} />
                <SettingRow label="Namespace observer" hint="Periodically refreshes the namespace list snapshot for the active cluster." checked={dp.observers.namespacesEnabled} onChange={autoToggle((v) => setDataplaneObservers({ namespacesEnabled: v }), ["observers", "namespacesEnabled"])} overrideState={os(["observers", "namespacesEnabled"])} onReset={() => resetOverridePath(["observers", "namespacesEnabled"])} />
                <SettingRow label="Node observer" hint="Periodically refreshes node snapshots when node list access is available." checked={dp.observers.nodesEnabled} onChange={autoToggle((v) => setDataplaneObservers({ nodesEnabled: v }), ["observers", "nodesEnabled"])} overrideState={os(["observers", "nodesEnabled"])} onReset={() => resetOverridePath(["observers", "nodesEnabled"])} />
                <SettingRow label="Use cached dashboard totals" hint="Uses only cached namespace list snapshots for dashboard resource totals instead of triggering broader reads." checked={dp.dashboard.useCachedTotalsOnly} onChange={autoToggle((v) => setDataplaneDashboard({ useCachedTotalsOnly: v }), ["dashboard", "useCachedTotalsOnly"])} overrideState={os(["dashboard", "useCachedTotalsOnly"])} onReset={() => resetOverridePath(["dashboard", "useCachedTotalsOnly"])} />
              </Box>
              <SettingGrid variant="auto">
                <SettingField label="Namespace observer" hint="Seconds between passive namespace list refreshes." type="number" unit="s" value={dp.observers.namespacesIntervalSec} onChange={autoNum((v) => setDataplaneObservers({ namespacesIntervalSec: v }), ["observers", "namespacesIntervalSec"])} overrideState={os(["observers", "namespacesIntervalSec"])} onReset={() => resetOverridePath(["observers", "namespacesIntervalSec"])} />
                <SettingField label="Node observer" hint="Seconds between passive node list refreshes." type="number" unit="s" value={dp.observers.nodesIntervalSec} onChange={autoNum((v) => setDataplaneObservers({ nodesIntervalSec: v }), ["observers", "nodesIntervalSec"])} overrideState={os(["observers", "nodesIntervalSec"])} onReset={() => resetOverridePath(["observers", "nodesIntervalSec"])} />
                <SettingField label="Node backoff max" hint="Maximum node observer backoff after access or connectivity failures." type="number" unit="s" value={dp.observers.nodesBackoffMaxSec} onChange={autoNum((v) => setDataplaneObservers({ nodesBackoffMaxSec: v }), ["observers", "nodesBackoffMaxSec"])} overrideState={os(["observers", "nodesBackoffMaxSec"])} onReset={() => resetOverridePath(["observers", "nodesBackoffMaxSec"])} />
                <SettingField label="Dashboard refresh" hint="Dataplane dashboard refresh interval in seconds." type="number" unit="s" value={dp.dashboard.refreshSec} onChange={autoNum((v) => setDataplaneDashboard({ refreshSec: v }), ["dashboard", "refreshSec"])} overrideState={os(["dashboard", "refreshSec"])} onReset={() => resetOverridePath(["dashboard", "refreshSec"])} />
                <SettingField label="Signal limit" hint="Maximum number of top dashboard signals shown by default." type="number" value={dp.dashboard.signalLimit} onChange={autoNum((v) => setDataplaneDashboard({ signalLimit: v }), ["dashboard", "signalLimit"])} overrideState={os(["dashboard", "signalLimit"])} onReset={() => resetOverridePath(["dashboard", "signalLimit"])} />
                <SettingField label="Newest signal limit" hint="Maximum number of newest dashboard signals shown by the Newest filter." type="number" value={dp.dashboard.newestSignalLimit} onChange={autoNum((v) => setDataplaneDashboard({ newestSignalLimit: v }), ["dashboard", "newestSignalLimit"])} overrideState={os(["dashboard", "newestSignalLimit"])} onReset={() => resetOverridePath(["dashboard", "newestSignalLimit"])} />
              </SettingGrid>
            </SettingSection>

            <SettingSection
              title="All Context Background"
              icon={<SettingsIcon name="allContexts" />}
              hint="Optionally cycles through kube contexts with low-priority background work. Each context still follows its own effective dataplane profile, so manual contexts stay quiet and wide/diagnostic contexts may run their configured namespace sweep."
            >
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <SettingRow label="Enable all contexts" hint="Keeps non-current contexts warm enough that switching contexts can reuse recent dataplane snapshots." checked={allContext.enabled} onChange={autoToggle((v) => setAllContextEnrichment({ enabled: v }), ["allContextEnrichment", "enabled"])} overrideState={os(["allContextEnrichment", "enabled"])} onReset={() => resetOverridePath(["allContextEnrichment", "enabled"])} />
                <SettingRow label="Pause on activity" hint="Waits for the UI to be idle before touching non-current contexts." checked={allContext.pauseOnUserActivity} onChange={autoToggle((v) => setAllContextEnrichment({ pauseOnUserActivity: v }), ["allContextEnrichment", "pauseOnUserActivity"])} overrideState={os(["allContextEnrichment", "pauseOnUserActivity"])} onReset={() => resetOverridePath(["allContextEnrichment", "pauseOnUserActivity"])} />
                <SettingRow label="Pause when busy" hint="Skips a context when its dataplane scheduler already has queued or running work." checked={allContext.pauseWhenSchedulerBusy} onChange={autoToggle((v) => setAllContextEnrichment({ pauseWhenSchedulerBusy: v }), ["allContextEnrichment", "pauseWhenSchedulerBusy"])} overrideState={os(["allContextEnrichment", "pauseWhenSchedulerBusy"])} onReset={() => resetOverridePath(["allContextEnrichment", "pauseWhenSchedulerBusy"])} />
              </Box>
              <SettingGrid variant="auto">
                <SettingField label="Cycle interval" hint="Seconds between all-context background cycles." type="number" unit="s" value={allContext.intervalSec} onChange={autoNum((v) => setAllContextEnrichment({ intervalSec: v }), ["allContextEnrichment", "intervalSec"])} overrideState={os(["allContextEnrichment", "intervalSec"])} onReset={() => resetOverridePath(["allContextEnrichment", "intervalSec"])} />
                <SettingField label="Contexts / cycle" hint="Maximum kube contexts touched per cycle. Keep this low when contexts point at separate API servers." type="number" value={allContext.maxContextsPerCycle} onChange={autoNum((v) => setAllContextEnrichment({ maxContextsPerCycle: v }), ["allContextEnrichment", "maxContextsPerCycle"])} overrideState={os(["allContextEnrichment", "maxContextsPerCycle"])} onReset={() => resetOverridePath(["allContextEnrichment", "maxContextsPerCycle"])} />
                <SettingField label="Idle quiet" hint="How long the app should be quiet before all-context background work starts." type="number" unit="ms" value={allContext.idleQuietMs} onChange={autoNum((v) => setAllContextEnrichment({ idleQuietMs: v }), ["allContextEnrichment", "idleQuietMs"])} overrideState={os(["allContextEnrichment", "idleQuietMs"])} onReset={() => resetOverridePath(["allContextEnrichment", "idleQuietMs"])} />
              </SettingGrid>
            </SettingSection>
          </>
        )}

        {dataplaneTab === "enrichment" && (
          <>
            <SettingSection
              title={`${profileLabel} Namespace Enrichment`}
              icon={<SettingsIcon name="namespaceEnrichment" />}
              hint={`Enrichment warms namespace snapshots ahead of direct navigation. Profile defaults set the breadth; these controls let you tune the current browser profile. ${profileEnrichmentText}`}
            >
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <SettingRow label="Enabled" hint="Allows automatic namespace enrichment for selected targets. Manual profile disables this by default." checked={ne.enabled} onChange={autoToggle((v) => setNamespaceEnrichment({ enabled: v }), ["namespaceEnrichment", "enabled"])} overrideState={os(["namespaceEnrichment", "enabled"])} onReset={() => resetOverridePath(["namespaceEnrichment", "enabled"])} />
                <SettingRow label="Current namespace" hint="Keep the active namespace at the front of the enrichment queue." checked={ne.includeFocus} onChange={autoToggle((v) => setNamespaceEnrichment({ includeFocus: v }), ["namespaceEnrichment", "includeFocus"])} overrideState={os(["namespaceEnrichment", "includeFocus"])} onReset={() => resetOverridePath(["namespaceEnrichment", "includeFocus"])} />
                <SettingRow label="Recent" hint="Include recently visited namespaces as enrichment targets." checked={ne.includeRecent} onChange={autoToggle((v) => setNamespaceEnrichment({ includeRecent: v }), ["namespaceEnrichment", "includeRecent"])} overrideState={os(["namespaceEnrichment", "includeRecent"])} onReset={() => resetOverridePath(["namespaceEnrichment", "includeRecent"])} />
                <SettingRow label="Favourites" hint="Include favourited namespaces as enrichment targets." checked={ne.includeFavourites} onChange={autoToggle((v) => setNamespaceEnrichment({ includeFavourites: v }), ["namespaceEnrichment", "includeFavourites"])} overrideState={os(["namespaceEnrichment", "includeFavourites"])} onReset={() => resetOverridePath(["namespaceEnrichment", "includeFavourites"])} />
              </Box>
              <SettingGrid variant="auto">
                <SettingField label="Max targets" hint="Maximum namespaces considered for focused enrichment in one planning pass." type="number" value={ne.maxTargets} onChange={autoNum((v) => setNamespaceEnrichment({ maxTargets: v }), ["namespaceEnrichment", "maxTargets"])} overrideState={os(["namespaceEnrichment", "maxTargets"])} onReset={() => resetOverridePath(["namespaceEnrichment", "maxTargets"])} />
                <SettingField label="Max parallel" hint="Maximum focused enrichment workers running at once." type="number" value={ne.maxParallel} onChange={autoNum((v) => setNamespaceEnrichment({ maxParallel: v }), ["namespaceEnrichment", "maxParallel"])} overrideState={os(["namespaceEnrichment", "maxParallel"])} onReset={() => resetOverridePath(["namespaceEnrichment", "maxParallel"])} />
                <SettingField label="Idle quiet" hint="How long the UI should be quiet before background enrichment starts." type="number" unit="ms" value={ne.idleQuietMs} onChange={autoNum((v) => setNamespaceEnrichment({ idleQuietMs: v }), ["namespaceEnrichment", "idleQuietMs"])} overrideState={os(["namespaceEnrichment", "idleQuietMs"])} onReset={() => resetOverridePath(["namespaceEnrichment", "idleQuietMs"])} />
                <SettingField label="Poll interval" hint="How often the UI polls enrichment progress while work is active." type="number" unit="ms" value={ne.pollMs} onChange={autoNum((v) => setNamespaceEnrichment({ pollMs: v }), ["namespaceEnrichment", "pollMs"])} overrideState={os(["namespaceEnrichment", "pollMs"])} onReset={() => resetOverridePath(["namespaceEnrichment", "pollMs"])} />
                <SettingField label="Recent hint limit" hint="Maximum recent namespaces eligible for focused enrichment." type="number" value={ne.recentLimit} onChange={autoNum((v) => setNamespaceEnrichment({ recentLimit: v }), ["namespaceEnrichment", "recentLimit"])} overrideState={os(["namespaceEnrichment", "recentLimit"])} onReset={() => resetOverridePath(["namespaceEnrichment", "recentLimit"])} />
                <SettingField label="Favourite hint limit" hint="Maximum favourite namespaces eligible for focused enrichment." type="number" value={ne.favouriteLimit} onChange={autoNum((v) => setNamespaceEnrichment({ favouriteLimit: v }), ["namespaceEnrichment", "favouriteLimit"])} overrideState={os(["namespaceEnrichment", "favouriteLimit"])} onReset={() => resetOverridePath(["namespaceEnrichment", "favouriteLimit"])} />
              </SettingGrid>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <SettingRow label="Namespace details" hint="Warm namespace detail snapshots used by summaries and navigation hints." checked={ne.enrichDetails} onChange={autoToggle((v) => setNamespaceEnrichment({ enrichDetails: v }), ["namespaceEnrichment", "enrichDetails"])} overrideState={os(["namespaceEnrichment", "enrichDetails"])} onReset={() => resetOverridePath(["namespaceEnrichment", "enrichDetails"])} />
                <SettingRow label="Pods" hint="Warm pod snapshots for namespace summaries, workload projections, and pod-derived signals." checked={ne.enrichPods} onChange={autoToggle((v) => setNamespaceEnrichment({ enrichPods: v }), ["namespaceEnrichment", "enrichPods"])} overrideState={os(["namespaceEnrichment", "enrichPods"])} onReset={() => resetOverridePath(["namespaceEnrichment", "enrichPods"])} />
                <SettingRow label="Deployments" hint="Warm deployment snapshots for rollout projections and namespace workload summaries." checked={ne.enrichDeployments} onChange={autoToggle((v) => setNamespaceEnrichment({ enrichDeployments: v }), ["namespaceEnrichment", "enrichDeployments"])} overrideState={os(["namespaceEnrichment", "enrichDeployments"])} onReset={() => resetOverridePath(["namespaceEnrichment", "enrichDeployments"])} />
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                {isContextEditing && (
                  <ScopeTag
                    state={hasOverrideAtPath(["namespaceEnrichment", "warmResourceKinds"]) ? "overridden" : "inherited"}
                    onReset={() => resetOverridePath(["namespaceEnrichment", "warmResourceKinds"])}
                  />
                )}
                <SettingsMultiSelect<string>
                  id="namespace-warm-kinds"
                  label={(
                    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                      Resource snapshots warmed by enrichment
                      <InfoHint title="Namespaced list kinds that enrichment will keep warm for selected namespace targets. Wide and diagnostic profiles warm every namespaced dataplane list kind slowly within the same target and sweep caps." />
                    </Box>
                  )}
                  value={ne.warmResourceKinds}
                  options={dataplaneNamespaceWarmResourceKeys.map((kind) => ({ value: kind, label: dataplaneWarmResourceLabel(kind) }))}
                  onChange={(warmResourceKinds) => setNamespaceEnrichment({ warmResourceKinds })}
                  emptyLabel="No resources selected"
                  menuProps={denseSelectMenuProps}
                />
              </Box>
            </SettingSection>

            <SettingSection
              title="Background Namespace Sweep"
              icon={<SettingsIcon name="sweep" />}
              hint={`Sweep slowly enriches namespaces outside the focused set while the app is idle. On this context, ${namespaces.length || "unknown"} namespaces would take about ${estimatedSweepHours || "?"} idle hour(s) at the current hourly cap.`}
            >
              <SettingRow label="Enable background sweep" hint="Allows slow idle discovery across namespaces that are not current, recent, or favourites." checked={sweep.enabled} onChange={autoToggle((v) => setNamespaceSweep({ enabled: v }), ["namespaceEnrichment", "sweep", "enabled"])} overrideState={os(["namespaceEnrichment", "sweep", "enabled"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "enabled"])} />
              <SettingGrid variant="auto">
                <SettingField label="Idle quiet" hint="How long the app should be idle before sweep work starts." type="number" unit="ms" value={sweep.idleQuietMs} onChange={autoNum((v) => setNamespaceSweep({ idleQuietMs: v }), ["namespaceEnrichment", "sweep", "idleQuietMs"])} overrideState={os(["namespaceEnrichment", "sweep", "idleQuietMs"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "idleQuietMs"])} />
                <SettingField label="Namespaces / cycle" hint="Maximum namespaces selected for each sweep planning cycle." type="number" value={sweep.maxNamespacesPerCycle} onChange={autoNum((v) => setNamespaceSweep({ maxNamespacesPerCycle: v }), ["namespaceEnrichment", "sweep", "maxNamespacesPerCycle"])} overrideState={os(["namespaceEnrichment", "sweep", "maxNamespacesPerCycle"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "maxNamespacesPerCycle"])} />
                <SettingField label="Namespaces / hour" hint="Hourly cap that keeps sweep work gentle on large clusters." type="number" value={sweep.maxNamespacesPerHour} onChange={autoNum((v) => setNamespaceSweep({ maxNamespacesPerHour: v }), ["namespaceEnrichment", "sweep", "maxNamespacesPerHour"])} overrideState={os(["namespaceEnrichment", "sweep", "maxNamespacesPerHour"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "maxNamespacesPerHour"])} />
                <SettingField label="Re-enrich after" hint="Minimum age before a namespace is eligible for sweep enrichment again." type="number" unit="min" value={sweep.minReenrichIntervalMinutes} onChange={autoNum((v) => setNamespaceSweep({ minReenrichIntervalMinutes: v }), ["namespaceEnrichment", "sweep", "minReenrichIntervalMinutes"])} overrideState={os(["namespaceEnrichment", "sweep", "minReenrichIntervalMinutes"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "minReenrichIntervalMinutes"])} />
                <SettingField label="Max parallel" hint="Maximum sweep workers running at once." type="number" value={sweep.maxParallel} onChange={autoNum((v) => setNamespaceSweep({ maxParallel: v }), ["namespaceEnrichment", "sweep", "maxParallel"])} overrideState={os(["namespaceEnrichment", "sweep", "maxParallel"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "maxParallel"])} />
              </SettingGrid>
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <SettingRow label="Pause on activity" hint="Stop sweep work while the operator is actively navigating or filtering." checked={sweep.pauseOnUserActivity} onChange={autoToggle((v) => setNamespaceSweep({ pauseOnUserActivity: v }), ["namespaceEnrichment", "sweep", "pauseOnUserActivity"])} overrideState={os(["namespaceEnrichment", "sweep", "pauseOnUserActivity"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "pauseOnUserActivity"])} />
                <SettingRow label="Pause when busy" hint="Stop sweep work while the dataplane scheduler is already occupied." checked={sweep.pauseWhenSchedulerBusy} onChange={autoToggle((v) => setNamespaceSweep({ pauseWhenSchedulerBusy: v }), ["namespaceEnrichment", "sweep", "pauseWhenSchedulerBusy"])} overrideState={os(["namespaceEnrichment", "sweep", "pauseWhenSchedulerBusy"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "pauseWhenSchedulerBusy"])} />
                <SettingRow label="Pause on rate limits" hint="Stop sweep work when recent requests suggest rate limiting or connectivity trouble." checked={sweep.pauseOnRateLimitOrConnectivityIssues} onChange={autoToggle((v) => setNamespaceSweep({ pauseOnRateLimitOrConnectivityIssues: v }), ["namespaceEnrichment", "sweep", "pauseOnRateLimitOrConnectivityIssues"])} overrideState={os(["namespaceEnrichment", "sweep", "pauseOnRateLimitOrConnectivityIssues"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "pauseOnRateLimitOrConnectivityIssues"])} />
                <SettingRow label="Include system namespaces" hint="Allows sweep to include kube-system and other system namespaces." checked={sweep.includeSystemNamespaces} onChange={autoToggle((v) => setNamespaceSweep({ includeSystemNamespaces: v }), ["namespaceEnrichment", "sweep", "includeSystemNamespaces"])} overrideState={os(["namespaceEnrichment", "sweep", "includeSystemNamespaces"])} onReset={() => resetOverridePath(["namespaceEnrichment", "sweep", "includeSystemNamespaces"])} />
              </Box>
            </SettingSection>
          </>
        )}

        {dataplaneTab === "metrics" && (
          <SettingSection
            title="Metrics (metrics.k8s.io)"
            icon={<SettingsIcon name="metrics" />}
            hint="Real-time pod and node usage from metrics-server. This section controls metrics sampling only. Disabled automatically when the API is missing or RBAC denies it; this toggle adds a soft gate on top of capability detection."
          >
            <SettingRow
              label="Enable metrics integration"
              hint="Allows dataplane to request metrics.k8s.io snapshots when the cluster and RBAC permit it."
              checked={dp.metrics.enabled}
              onChange={autoToggle((v) => {
                if (dataplaneEditScope === "context") setContextMetricsEnabled(v);
                else setDataplaneMetrics({ enabled: v });
              }, ["metrics", "enabled"])}
              overrideState={os(["metrics", "enabled"])}
              onReset={() => resetContextMetricsOverride()}
            />
            <SettingGrid variant="auto">
              <SettingField label="Pod metrics TTL" hint="Minimum age before pod metrics snapshots are refreshed." type="number" unit="s" value={dp.metrics.podMetricsTtlSec} onChange={autoNum((v) => setDataplaneMetrics({ podMetricsTtlSec: v }), ["metrics", "podMetricsTtlSec"])} overrideState={os(["metrics", "podMetricsTtlSec"])} onReset={() => resetOverridePath(["metrics", "podMetricsTtlSec"])} />
              <SettingField label="Node metrics TTL" hint="Minimum age before node metrics snapshots are refreshed." type="number" unit="s" value={dp.metrics.nodeMetricsTtlSec} onChange={autoNum((v) => setDataplaneMetrics({ nodeMetricsTtlSec: v }), ["metrics", "nodeMetricsTtlSec"])} overrideState={os(["metrics", "nodeMetricsTtlSec"])} onReset={() => resetOverridePath(["metrics", "nodeMetricsTtlSec"])} />
            </SettingGrid>
          </SettingSection>
        )}

        {dataplaneTab === "cache" && (
          <>
            <SettingSection
              title="Persisted Dataplane Cache"
              icon={<SettingsIcon name="persistence" />}
              hint="Persisted snapshots keep the last observed list data on this device for restart recovery and cached quick access search. Results are stale until refreshed by the cluster."
            >
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <SettingRow label="Persist dataplane snapshots" hint="Stores eligible dataplane list snapshots on disk so kview can hydrate the cache on restart." checked={dp.persistence.enabled} onChange={autoToggle((v) => setDataplanePersistence({ enabled: v }), ["persistence", "enabled"])} overrideState={os(["persistence", "enabled"])} onReset={() => resetOverridePath(["persistence", "enabled"])} />
                <SettingRow label="Manual refresh bypasses TTL" hint="A user-triggered refresh fetches live data even when the cached snapshot is still inside its TTL." checked={dp.snapshots.manualRefreshBypassesTtl} onChange={autoToggle((v) => setDataplaneSnapshots({ manualRefreshBypassesTtl: v }), ["snapshots", "manualRefreshBypassesTtl"])} overrideState={os(["snapshots", "manualRefreshBypassesTtl"])} onReset={() => resetOverridePath(["snapshots", "manualRefreshBypassesTtl"])} />
                <SettingRow label="Invalidate after known mutations" hint="Drops affected cached snapshots after kview performs a known mutating action." checked={dp.snapshots.invalidateAfterKnownMutations} onChange={autoToggle((v) => setDataplaneSnapshots({ invalidateAfterKnownMutations: v }), ["snapshots", "invalidateAfterKnownMutations"])} overrideState={os(["snapshots", "invalidateAfterKnownMutations"])} onReset={() => resetOverridePath(["snapshots", "invalidateAfterKnownMutations"])} />
              </Box>
              <Box sx={{ maxWidth: 240 }}>
                <SettingField
                  label="Max persisted age"
                  hint="Snapshots older than this age are not hydrated on restart and are removed from the bbolt cache during persistence cleanup."
                  type="number"
                  unit="h"
                  value={dp.persistence.maxAgeHours}
                  onChange={autoNum((v) => setDataplanePersistence({ maxAgeHours: v }), ["persistence", "maxAgeHours"])}
                  overrideState={os(["persistence", "maxAgeHours"])}
                  onReset={() => resetOverridePath(["persistence", "maxAgeHours"])}
                />
              </Box>
            </SettingSection>

            <SettingSection
              title="Snapshot TTLs"
              icon={<SettingsIcon name="ttl" />}
              hint="TTL values control how long cached list snapshots are treated as fresh before dataplane schedules a live refresh. They do not override manual refresh when bypass is enabled."
            >
              <SettingGrid variant="three">
                {dataplaneTTLResourceKeys.map((key) => (
                  <SettingField
                    key={key}
                    label={`${getResourceLabel(key as ListResourceKey)} TTL`}
                    type="number"
                    unit="s"
                    value={dp.snapshots.ttlSec[key]}
                    onChange={autoNum((v) => setDataplaneSnapshots({ ttlSec: { ...dp.snapshots.ttlSec, [key]: v } }), ["snapshots", "ttlSec", key])}
                    overrideState={os(["snapshots", "ttlSec", key])}
                    onReset={() => resetOverridePath(["snapshots", "ttlSec", key])}
                  />
                ))}
              </SettingGrid>
            </SettingSection>
          </>
        )}

        {dataplaneTab === "signals" && (
          <SettingSection
            title="Signal Catalog"
            icon={<SettingsIcon name="signals" />}
            hint="Signal cards define enable/severity/priority plus detector-specific emission thresholds. Scope follows the Dataplane context switch above."
            actions={
              <AppIconButton
                tooltip={dataplaneEditScope === "context" ? "Reset context signal overrides and thresholds" : "Reset all signal defaults and thresholds"}
                label="Reset signals"
                onClick={() => {
                  if (dataplaneEditScope === "context") resetOverrideSection("signals");
                  else setDataplaneSignals(signalDefaults);
                }}
              >
                <RestartAltIcon fontSize="inherit" />
              </AppIconButton>
            }
          >
            <SettingField
              label="Filter signals"
              value={signalCatalogQuery}
              onChange={(v) => setSignalCatalogQuery(v)}
              hint={dataplaneEditScope === "context" && activeContext ? `Editing context overrides for ${activeContext}.` : "Editing global defaults."}
            />
            {signalCatalogError ? <Alert severity="warning">{signalCatalogError}</Alert> : null}
            {filteredSignalCatalog.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No signal definitions match the current filter.
              </Typography>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {filteredSignalCatalog.map((item) => {
                  const globalOverride = settings.dataplane.global.signals.overrides[item.type] || {};
                  const contextOverride = activeContextSignalOverrides[item.type] || {};
                  const override = dataplaneEditScope === "global" ? globalOverride : contextOverride;
                  const inheritedEnabled = dataplaneEditScope === "context" ? (globalOverride.enabled ?? item.defaultEnabled) : item.defaultEnabled;
                  const inheritedSeverity = dataplaneEditScope === "context" ? (globalOverride.severity || item.defaultSeverity || "low") : (item.defaultSeverity || "low");
                  const inheritedPriority = dataplaneEditScope === "context" ? (globalOverride.priority ?? item.defaultPriority) : item.defaultPriority;
                  const enabledChecked = override.enabled ?? inheritedEnabled;
                  const severityValue = override.severity || inheritedSeverity;
                  const priorityValue = signalPriorityFor(item);
                  const changed = Object.keys(override).length > 0 || signalThresholdCustomized(item.type);
                  const inheritedSignalOverride: Partial<SignalOverride> = {
                    enabled: inheritedEnabled,
                    severity: inheritedSeverity as SignalOverride["severity"],
                    priority: inheritedPriority,
                  };
                  const signalThresholdChangedLabels = (): string[] => {
                    const contextPathChanged = (path: string[]) => dataplaneEditScope === "context" && isContextEditing && hasOverrideAtPath(path);
                    switch (item.type) {
                      case "pod_restarts":
                        return contextPathChanged(["signals", "detectors", "pod_restarts", "restartCount"]) ||
                          (dataplaneEditScope === "global" && signalDetectors.pod_restarts.restartCount !== signalDefaults.detectors.pod_restarts.restartCount)
                          ? ["restart count"]
                          : [];
                      case "container_near_limit":
                        return contextPathChanged(["signals", "detectors", "container_near_limit", "percent"]) ||
                          (dataplaneEditScope === "global" && signalDetectors.container_near_limit.percent !== signalDefaults.detectors.container_near_limit.percent)
                          ? ["container percent"]
                          : [];
                      case "node_resource_pressure":
                        return contextPathChanged(["signals", "detectors", "node_resource_pressure", "percent"]) ||
                          (dataplaneEditScope === "global" && signalDetectors.node_resource_pressure.percent !== signalDefaults.detectors.node_resource_pressure.percent)
                          ? ["node percent"]
                          : [];
                      case "resource_quota_pressure": {
                        const labels: string[] = [];
                        if (
                          contextPathChanged(["signals", "detectors", "resource_quota_pressure", "warnPercent"]) ||
                          (dataplaneEditScope === "global" && signalDetectors.resource_quota_pressure.warnPercent !== signalDefaults.detectors.resource_quota_pressure.warnPercent)
                        ) labels.push("warn percent");
                        if (
                          contextPathChanged(["signals", "detectors", "resource_quota_pressure", "criticalPercent"]) ||
                          (dataplaneEditScope === "global" && signalDetectors.resource_quota_pressure.criticalPercent !== signalDefaults.detectors.resource_quota_pressure.criticalPercent)
                        ) labels.push("critical percent");
                        return labels;
                      }
                      case "long_running_job":
                        return contextPathChanged(["signals", "longRunningJobSec"]) ||
                          (dataplaneEditScope === "global" && dp.signals.longRunningJobSec !== signalDefaults.longRunningJobSec)
                          ? ["long running job"]
                          : [];
                      case "cronjob_no_recent_success":
                        return contextPathChanged(["signals", "cronJobNoRecentSuccessSec"]) ||
                          (dataplaneEditScope === "global" && dp.signals.cronJobNoRecentSuccessSec !== signalDefaults.cronJobNoRecentSuccessSec)
                          ? ["no recent success"]
                          : [];
                      case "stale_transitional_helm_release":
                        return contextPathChanged(["signals", "staleHelmReleaseSec"]) ||
                          (dataplaneEditScope === "global" && dp.signals.staleHelmReleaseSec !== signalDefaults.staleHelmReleaseSec)
                          ? ["stale release"]
                          : [];
                      case "potentially_unused_pvc":
                      case "potentially_unused_serviceaccount":
                        return contextPathChanged(["signals", "unusedResourceAgeSec"]) ||
                          (dataplaneEditScope === "global" && dp.signals.unusedResourceAgeSec !== signalDefaults.unusedResourceAgeSec)
                          ? ["unused age"]
                          : [];
                      case "pod_young_frequent_restarts":
                        return contextPathChanged(["signals", "podYoungRestartWindowSec"]) ||
                          (dataplaneEditScope === "global" && dp.signals.podYoungRestartWindowSec !== signalDefaults.podYoungRestartWindowSec)
                          ? ["young restart window"]
                          : [];
                      case "deployment_unavailable":
                        return contextPathChanged(["signals", "deploymentUnavailableSec"]) ||
                          (dataplaneEditScope === "global" && dp.signals.deploymentUnavailableSec !== signalDefaults.deploymentUnavailableSec)
                          ? ["unavailable duration"]
                          : [];
                      default:
                        return [];
                    }
                  };
                  const changedControls = [
                    ...(override.enabled !== undefined ? ["enabled state"] : []),
                    ...(override.severity !== undefined ? ["severity"] : []),
                    ...(override.priority !== undefined ? ["display priority"] : []),
                    ...signalThresholdChangedLabels(),
                  ];
                  const customTooltip = `Custom settings: ${changedControls.join(", ")}. Reset returns this signal to ${dataplaneEditScope === "context" ? "global" : "default"} values.`;
                  const renderSignalThresholdControls = () => {
                    switch (item.type) {
                      case "pod_restarts":
                        return <SettingField label="Restart count" hint={`Default: ${signalDefaults.detectors.pod_restarts.restartCount}.`} type="number" value={signalDetectors.pod_restarts.restartCount} onChange={numChange((v) => setDataplaneSignals({ detectors: { ...signalDetectors, pod_restarts: { restartCount: v } } }))} />;
                      case "container_near_limit":
                        return <SettingField label="Percent" hint={`Default: ${signalDefaults.detectors.container_near_limit.percent}%.`} type="number" unit="%" value={signalDetectors.container_near_limit.percent} onChange={numChange((v) => setDataplaneSignals({ detectors: { ...signalDetectors, container_near_limit: { percent: v } } }))} />;
                      case "node_resource_pressure":
                        return <SettingField label="Percent" hint={`Default: ${signalDefaults.detectors.node_resource_pressure.percent}%.`} type="number" unit="%" value={signalDetectors.node_resource_pressure.percent} onChange={numChange((v) => setDataplaneSignals({ detectors: { ...signalDetectors, node_resource_pressure: { percent: v } } }))} />;
                      case "resource_quota_pressure":
                        return (
                          <SettingGrid variant="auto">
                            <SettingField label="Warn percent" hint={`Default: ${signalDefaults.detectors.resource_quota_pressure.warnPercent}%.`} type="number" unit="%" value={signalDetectors.resource_quota_pressure.warnPercent} onChange={numChange((v) => setDataplaneSignals({ detectors: { ...signalDetectors, resource_quota_pressure: { ...signalDetectors.resource_quota_pressure, warnPercent: v } } }))} />
                            <SettingField label="Critical percent" hint={`Default: ${signalDefaults.detectors.resource_quota_pressure.criticalPercent}%.`} type="number" unit="%" value={signalDetectors.resource_quota_pressure.criticalPercent} onChange={numChange((v) => setDataplaneSignals({ detectors: { ...signalDetectors, resource_quota_pressure: { ...signalDetectors.resource_quota_pressure, criticalPercent: v } } }))} />
                          </SettingGrid>
                        );
                      case "long_running_job":
                        return <SettingField label="Long running job" hint={`Default: ${signalDefaults.longRunningJobSec}s.`} type="number" unit="s" value={dp.signals.longRunningJobSec} onChange={numChange((v) => setDataplaneSignals({ longRunningJobSec: v }))} />;
                      case "cronjob_no_recent_success":
                        return <SettingField label="No recent success" hint={`Default: ${signalDefaults.cronJobNoRecentSuccessSec}s.`} type="number" unit="s" value={dp.signals.cronJobNoRecentSuccessSec} onChange={numChange((v) => setDataplaneSignals({ cronJobNoRecentSuccessSec: v }))} />;
                      case "stale_transitional_helm_release":
                        return <SettingField label="Stale release" hint={`Default: ${signalDefaults.staleHelmReleaseSec}s.`} type="number" unit="s" value={dp.signals.staleHelmReleaseSec} onChange={numChange((v) => setDataplaneSignals({ staleHelmReleaseSec: v }))} />;
                      case "potentially_unused_pvc":
                      case "potentially_unused_serviceaccount":
                        return <SettingField label="Unused age" hint={`Default: ${signalDefaults.unusedResourceAgeSec}s.`} type="number" unit="s" value={dp.signals.unusedResourceAgeSec} onChange={numChange((v) => setDataplaneSignals({ unusedResourceAgeSec: v }))} />;
                      case "pod_young_frequent_restarts":
                        return <SettingField label="Young restart window" hint={`Default: ${signalDefaults.podYoungRestartWindowSec}s.`} type="number" unit="s" value={dp.signals.podYoungRestartWindowSec} onChange={numChange((v) => setDataplaneSignals({ podYoungRestartWindowSec: v }))} />;
                      case "deployment_unavailable":
                        return <SettingField label="Unavailable duration" hint={`Default: ${signalDefaults.deploymentUnavailableSec}s.`} type="number" unit="s" value={dp.signals.deploymentUnavailableSec} onChange={numChange((v) => setDataplaneSignals({ deploymentUnavailableSec: v }))} />;
                      default:
                        return null;
                    }
                  };
                  return (
                    <Box key={item.type} sx={[settingsItemCardSx, { gap: 1.25 }]}>
                      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
                        <Box sx={{ minWidth: 0, display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                          <Typography variant="subtitle2">{item.label}</Typography>
                          <InfoHint title={`Signal type: ${item.type}. Reason: ${item.likelyCause || item.calculatedData || "Backend-defined dataplane signal."}`} />
                          {changed ? <ScopeTag state="overridden" onReset={() => resetSignalCard(item.type)} tooltip={customTooltip} /> : null}
                        </Box>
                        <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
                          <ReorderButtons
                            label={`${item.label} signal`}
                            index={orderedSignalIndex.get(item.type) ?? 0}
                            lastIndex={orderedSignalCatalog.length - 1}
                            onUp={() => moveSignalPriority(item.type, -1)}
                            onDown={() => moveSignalPriority(item.type, 1)}
                          />
                        </Box>
                      </Box>
                      <Box sx={{ pt: 0.25 }}>
                        <SettingGrid variant="auto">
                          <SettingRow
                            label="Enabled"
                            hint={`Default value: ${item.defaultEnabled ? "enabled" : "disabled"}. Inherited value: ${inheritedEnabled ? "enabled" : "disabled"}.`}
                            checked={enabledChecked}
                            onChange={(value) => setSignalOverride(item.type, dataplaneEditScope, { enabled: value }, inheritedSignalOverride)}
                          />
                          <SettingField
                            label="Severity"
                            hint={`Default value: ${item.defaultSeverity || "dynamic"}. Inherited value: ${inheritedSeverity}.`}
                          >
                            <TextField
                              select
                              size="small"
                              fullWidth
                              value={severityValue}
                              slotProps={{ select: { MenuProps: denseSelectMenuProps } }}
                              onChange={(e) => {
                                const value = e.target.value;
                                setSignalOverride(item.type, dataplaneEditScope, {
                                  severity: value as SignalOverride["severity"],
                                }, inheritedSignalOverride);
                              }}
                            >
                              <MenuItem value="low">Low</MenuItem>
                              <MenuItem value="medium">Medium</MenuItem>
                              <MenuItem value="high">High</MenuItem>
                            </TextField>
                          </SettingField>
                          <SettingField
                            label="Priority"
                            hint={`Move the card to change display priority. Default value: ${item.defaultPriority}. Inherited value: ${inheritedPriority}.`}
                          >
                            <TextField
                              size="small"
                              fullWidth
                              value={priorityValue}
                              slotProps={{ input: { readOnly: true } }}
                            />
                          </SettingField>
                        </SettingGrid>
                      </Box>
                      <Box sx={{ pt: 0.25 }}>
                        {renderSignalThresholdControls()}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            )}
          </SettingSection>
        )}
      </Box>
    );
  };

  const renderTransferImportDialog = () => {
    const bundle = pendingTransferBundle;
    const available = bundle ? settingsTransferSectionIds(bundle) : [];
    return (
      <Dialog open={transferReviewOpen && !!bundle} onClose={() => setTransferReviewOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Import Transfer Bundle</DialogTitle>
        <DialogContent>
          {bundle ? (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 0.5 }}>
              <Alert severity="info">
                Review the bundle contents and choose how conflicts should be handled before importing.
              </Alert>
              {transferDialogMessage ? (
                <Alert severity={transferDialogMessage.severity}>{transferDialogMessage.text}</Alert>
              ) : null}
              <FormControl size="small" fullWidth>
                <InputLabel id="settings-transfer-dialog-strategy-label">Merge strategy</InputLabel>
                <Select
                  labelId="settings-transfer-dialog-strategy-label"
                  label="Merge strategy"
                  value={transferStrategy}
                  onChange={(event: SelectChangeEvent) => setTransferStrategy(event.target.value as SettingsTransferMergeStrategy)}
                >
                  {settingsTransferMergeStrategies.map((item) => (
                    <MenuItem key={item.id} value={item.id}>{item.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <List dense disablePadding>
                {available.map((sectionID) => (
                  <ListItemButton
                    key={sectionID}
                    dense
                    onClick={() => toggleTransferSection(sectionID, !transferImportSections.includes(sectionID), setTransferImportSections)}
                    sx={{ borderRadius: 1 }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <Checkbox
                        edge="start"
                        size="small"
                        checked={transferImportSections.includes(sectionID)}
                        tabIndex={-1}
                        disableRipple
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={transferSectionLabel(sectionID)}
                      secondary={transferSectionSummary(bundle, sectionID)}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <AppButton variant="text" onClick={() => setTransferReviewOpen(false)}>
            {transferDialogMessage?.severity === "success" ? "Done" : "Cancel"}
          </AppButton>
          <AppButton
            intent="primary"
            disabled={!bundle || transferImportSections.length === 0 || transferImportBusy}
            onClick={() => {
              if (bundle) void applyTransferImport(bundle, pendingTransferText || importText);
            }}
          >
            {transferImportBusy ? "Importing..." : "Import Selected Sections"}
          </AppButton>
        </DialogActions>
      </Dialog>
    );
  };

  const renderImportExport = () => (
    <>
    <SettingSection
      title="Import / Export"
      icon={<SettingsIcon name="importExport" />}
      hint="Full profile export is for backup. Transfer bundles are section-based and safer for sharing with a team."
    >
      <Typography variant="subtitle2">Transfer bundle</Typography>
      <Typography variant="body2" color="text.secondary">
        Export only the sections another operator should import.
      </Typography>
      <List dense disablePadding sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 0.25 }}>
        {settingsTransferSections.map((item) => (
          <ListItemButton
            key={item.id}
            dense
            onClick={() => toggleTransferSection(item.id, !transferSections.includes(item.id), setTransferSections)}
            sx={{ borderRadius: 1 }}
          >
            <ListItemIcon sx={{ minWidth: 32 }}>
              <Checkbox
                edge="start"
                size="small"
                checked={transferSections.includes(item.id)}
                tabIndex={-1}
                disableRipple
              />
            </ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItemButton>
        ))}
      </List>
      <Box sx={actionRowSx}>
        <AppButton intent="primary" onClick={() => void exportTransferSettings()}>
          Export transfer bundle
        </AppButton>
      </Box>
      <Divider />
      <Typography variant="subtitle2">Full profile backup</Typography>
      <Box sx={actionRowSx}>
        <AppButton
          intent="secondary"
          onClick={() => {
            const blob = new Blob([exportUserSettingsJSON(settings)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "kview-user-settings.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export full profile
        </AppButton>
        <AppButton
          intent="warning"
          onClick={() => {
            if (!window.confirm("Reset settings to defaults? This will overwrite the current settings profile.")) return;
            resetSettings();
          }}
        >
          Reset to defaults
        </AppButton>
      </Box>
      <Divider />
      <Typography variant="subtitle2">Import</Typography>
      <AppButton component="label" sx={{ alignSelf: "flex-start" }}>
        Upload JSON file
        <input
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            void importSettingsFile(file);
            e.target.value = "";
          }}
        />
      </AppButton>
      <HighlightedJsonTextArea value={importText} onChange={setImportText} />
      {transferBundle ? (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Alert severity="info">
            Transfer bundle detected. Review the sections before importing.
          </Alert>
          <List dense disablePadding sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 0.25 }}>
            {settingsTransferSections
              .filter((item) => settingsTransferSectionIds(transferBundle).includes(item.id))
              .map((item) => (
                <Box key={item.id} sx={{ border: "1px solid var(--panel-border)", borderRadius: 1, px: 1, py: 0.75 }}>
                  <Typography variant="body2">{item.label}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {transferSectionSummary(transferBundle, item.id)}
                  </Typography>
                </Box>
              ))}
          </List>
        </Box>
      ) : null}
      <Box sx={actionRowSx}>
        <AppButton
          intent="primary"
          onClick={() => void importSettingsText(importText)}
          disabled={!importText.trim()}
        >
          Import JSON
        </AppButton>
        <AppButton variant="text" onClick={() => setImportText("")}>Clear</AppButton>
      </Box>
      {importMessage ? <Alert severity={importMessage.severity}>{importMessage.text}</Alert> : null}
    </SettingSection>
    {renderTransferImportDialog()}
    </>
  );

  return (
    <Box data-testid="settings-view" sx={settingsShellSx}>
      <Paper
        variant="outlined"
        sx={sideRailPaperSx}
      >
        <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
          Settings
        </Typography>
        <List dense disablePadding>
          {sections.map((item) => (
            <ListItemButton
              key={item.id}
              data-testid={`settings-nav-${item.id}`}
              selected={section === item.id}
              onClick={() => setSection(item.id)}
              sx={sideRailListItemSx}
            >
              <ListItemIcon sx={sideRailIconSx(section === item.id)}>
                <SettingsIcon name={item.icon} size={17} />
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                slotProps={{ primary: { variant: "body2" } }}
                sx={sideRailListTextSx}
              />
            </ListItemButton>
          ))}
        </List>
      </Paper>
      <Box sx={settingsMainSurfaceSx}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.25 }}>
          <AppIconButton tooltip="Close settings" label="Close settings" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </AppIconButton>
        </Box>
        {section === "appearance" ? renderAppearance() : null}
        {section === "keyboard" ? renderKeyboard() : null}
        {section === "smartFilters" ? renderSmartFilters() : null}
        {section === "resourceTags" ? renderResourceTags() : null}
        {section === "linksMacros" ? renderLinksMacros() : null}
        {section === "commands" ? renderCustomCommands() : null}
        {section === "actions" ? renderCustomActions() : null}
        {section === "dataplane" ? renderDataplane() : null}
        {section === "importExport" ? renderImportExport() : null}
      </Box>
    </Box>
  );
}
