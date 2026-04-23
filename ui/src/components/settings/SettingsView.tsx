import React, { useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import CloseIcon from "@mui/icons-material/Close";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import {
  applyDataplaneProfile,
  customActionResourceKeys,
  defaultDataplaneSettings,
  dataplaneNamespaceWarmResourceKeys,
  dataplaneTTLResourceKeys,
  exportUserSettingsJSON,
  newCustomActionDefinition,
  newCustomCommandDefinition,
  newSmartFilterRule,
  parseUserSettingsJSON,
  refreshIntervalOptions,
  sanitizeRegexFlags,
  smartFilterResourceKeysForScope,
  type CustomActionDefinition,
  type CustomActionKind,
  type CustomActionPatchType,
  type CustomActionTarget,
  type CustomCommandDefinition,
  type CustomCommandOutputType,
  type CustomCommandSafety,
  type DataplaneProfile,
  type DataplaneSettings,
  type KviewUserSettingsV1,
  type SettingsResourceScopeMode,
  type SettingsScopeMode,
  type SmartFilterRule,
} from "../../settings";
import { useUserSettings } from "../../settingsContext";
import { getResourceLabel, type ListResourceKey } from "../../utils/k8sResources";
import { actionRowSx, panelBoxSx } from "../../theme/sxTokens";

type SettingsSection = "appearance" | "smartFilters" | "commands" | "actions" | "nsEnrichment" | "importExport";

type Props = {
  contexts: Array<{ name: string }>;
  namespaces: string[];
  activeContext: string;
  activeNamespace: string;
  onClose: () => void;
};

function dataplaneWarmResourceLabel(kind: string): string {
  if (kind === "helmreleases") return "Helm Releases";
  return getResourceLabel(kind as ListResourceKey);
}

const sections: Array<{ id: SettingsSection; label: string }> = [
  { id: "appearance", label: "Appearance" },
  { id: "smartFilters", label: "Smart Filters" },
  { id: "commands", label: "Custom Commands" },
  { id: "actions", label: "Custom Actions" },
  { id: "nsEnrichment", label: "NS Enrichment" },
  { id: "importExport", label: "Import / Export" },
];

const headerRowSx = { display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" };

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
  onRemove: () => void;
}) {
  return (
    <Box sx={{ display: "flex", gap: 0.25 }}>
      <Tooltip title={`Move ${label} up`}>
        <span>
          <IconButton size="small" onClick={onUp} disabled={index === 0} aria-label={`Move ${label} up`}>
            <ArrowUpwardIcon fontSize="inherit" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={`Move ${label} down`}>
        <span>
          <IconButton size="small" onClick={onDown} disabled={index === lastIndex} aria-label={`Move ${label} down`}>
            <ArrowDownwardIcon fontSize="inherit" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={`Remove ${label}`}>
        <IconButton size="small" color="error" onClick={onRemove} aria-label={`Remove ${label}`}>
          <DeleteOutlineIcon fontSize="inherit" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

function updateAppearance(
  settings: KviewUserSettingsV1,
  patch: Partial<KviewUserSettingsV1["appearance"]>,
): KviewUserSettingsV1 {
  return {
    ...settings,
    appearance: { ...settings.appearance, ...patch },
  };
}

function updateSmartFilters(
  settings: KviewUserSettingsV1,
  patch: Partial<KviewUserSettingsV1["smartFilters"]>,
): KviewUserSettingsV1 {
  return {
    ...settings,
    smartFilters: { ...settings.smartFilters, ...patch },
  };
}

function updateCustomCommands(
  settings: KviewUserSettingsV1,
  patch: Partial<KviewUserSettingsV1["customCommands"]>,
): KviewUserSettingsV1 {
  return {
    ...settings,
    customCommands: { ...settings.customCommands, ...patch },
  };
}

function updateCustomActions(
  settings: KviewUserSettingsV1,
  patch: Partial<KviewUserSettingsV1["customActions"]>,
): KviewUserSettingsV1 {
  return {
    ...settings,
    customActions: { ...settings.customActions, ...patch },
  };
}

function updateDataplane(settings: KviewUserSettingsV1, patch: Partial<DataplaneSettings>): KviewUserSettingsV1 {
  return {
    ...settings,
    dataplane: { ...settings.dataplane, ...patch },
  };
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

export default function SettingsView({ contexts, namespaces, activeContext, activeNamespace, onClose }: Props) {
  const { settings, setSettings, replaceSettings, resetSettings } = useUserSettings();
  const [section, setSection] = useState<SettingsSection>("appearance");
  const [importText, setImportText] = useState("");
  const [importMessage, setImportMessage] = useState<{ severity: "success" | "error"; text: string } | null>(null);

  const contextOptions = useMemo(
    () => Array.from(new Set([activeContext, ...contexts.map((c) => c.name)].filter(Boolean))),
    [activeContext, contexts],
  );
  const namespaceOptions = useMemo(
    () => Array.from(new Set([activeNamespace, ...namespaces].filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [activeNamespace, namespaces],
  );

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

  const setNamespaceEnrichment = (patch: Partial<DataplaneSettings["namespaceEnrichment"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      namespaceEnrichment: { ...prev.dataplane.namespaceEnrichment, ...patch },
    }));
  };

  const setNamespaceSweep = (patch: Partial<DataplaneSettings["namespaceEnrichment"]["sweep"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      namespaceEnrichment: {
        ...prev.dataplane.namespaceEnrichment,
        sweep: { ...prev.dataplane.namespaceEnrichment.sweep, ...patch },
      },
    }));
  };

  const setDataplaneSnapshots = (patch: Partial<DataplaneSettings["snapshots"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      snapshots: { ...prev.dataplane.snapshots, ...patch },
    }));
  };

  const setDataplanePersistence = (patch: Partial<DataplaneSettings["persistence"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      persistence: { ...prev.dataplane.persistence, ...patch },
    }));
  };

  const setDataplaneObservers = (patch: Partial<DataplaneSettings["observers"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      observers: { ...prev.dataplane.observers, ...patch },
    }));
  };

  const setDataplaneBudget = (patch: Partial<DataplaneSettings["backgroundBudget"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      backgroundBudget: { ...prev.dataplane.backgroundBudget, ...patch },
    }));
  };

  const setDataplaneDashboard = (patch: Partial<DataplaneSettings["dashboard"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      dashboard: { ...prev.dataplane.dashboard, ...patch },
    }));
  };
  const setDataplaneMetrics = (patch: Partial<DataplaneSettings["metrics"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      metrics: { ...prev.dataplane.metrics, ...patch },
    }));
  };
  const setDataplaneSignals = (patch: Partial<DataplaneSettings["signals"]>) => {
    setSettings((prev) => updateDataplane(prev, {
      signals: (() => {
        const next = { ...prev.dataplane.signals, ...patch };
        if (next.quotaCriticalPercent <= next.quotaWarnPercent) {
          const defaults = defaultDataplaneSettings().signals;
          next.quotaWarnPercent = defaults.quotaWarnPercent;
          next.quotaCriticalPercent = defaults.quotaCriticalPercent;
        }
        return next;
      })(),
    }));
  };

  const importSettingsText = (text: string) => {
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

  const renderAppearance = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Typography variant="h6">Appearance</Typography>
      <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1.25 }}>
        <TextField
          select
          size="small"
          label="Dashboard refresh"
          value={settings.appearance.dashboardRefreshSec}
          onChange={(e) =>
            setSettings((prev) =>
              updateAppearance(prev, { dashboardRefreshSec: Number(e.target.value) }),
            )
          }
          helperText="Off loads the dashboard once and disables periodic dashboard polling."
          sx={{ maxWidth: 320 }}
        >
          {refreshIntervalOptions.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Switch
              checked={settings.appearance.smartFiltersEnabled}
              onChange={(e) =>
                setSettings((prev) =>
                  updateAppearance(prev, { smartFiltersEnabled: e.target.checked }),
                )
              }
            />
          }
          label="Smart filters"
        />
        <FormControlLabel
          control={
            <Switch
              checked={settings.appearance.releaseChecksEnabled}
              onChange={(e) =>
                setSettings((prev) =>
                  updateAppearance(prev, { releaseChecksEnabled: e.target.checked }),
                )
              }
            />
          }
          label="Check for kview updates"
        />
        <TextField
          select
          size="small"
          label="Initial activity panel state"
          value={settings.appearance.activityPanelInitiallyOpen ? "expanded" : "collapsed"}
          onChange={(e) =>
            setSettings((prev) =>
              updateAppearance(prev, { activityPanelInitiallyOpen: e.target.value === "expanded" }),
            )
          }
          helperText="Used when the app starts. The current panel can still be opened or collapsed manually."
          sx={{ maxWidth: 320 }}
        >
          <MenuItem value="expanded">Expanded</MenuItem>
          <MenuItem value="collapsed">Collapsed</MenuItem>
        </TextField>
      </Paper>
    </Box>
  );

  const renderRule = (rule: SmartFilterRule, index: number) => {
    const error = rulePatternError(rule);
    const resourceOptions = smartFilterResourceKeysForScope(rule.scope);
    return (
      <Paper key={rule.id} variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
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
        <FormControlLabel
          control={<Switch checked={rule.enabled} onChange={(e) => setRule(index, { enabled: e.target.checked })} />}
          label="Enabled"
        />
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <TextField
            select
            size="small"
            label="Context scope"
            value={rule.context || "__all"}
            onChange={(e) => setRule(index, { context: e.target.value === "__all" ? "" : e.target.value })}
          >
            <MenuItem value="__all">All contexts</MenuItem>
            {contextOptions.map((ctx) => (
              <MenuItem key={ctx} value={ctx}>
                {ctx}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Cluster scope"
            value={rule.scope}
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
          <TextField
            select
            size="small"
            label="Namespace"
            value={rule.namespace || "__any"}
            onChange={(e) => setRule(index, { namespace: e.target.value === "__any" ? "" : e.target.value })}
            disabled={rule.scope !== "namespace"}
            helperText={rule.scope === "namespace" ? "Leave as Any namespace for all namespace-scoped lists." : "Only used for namespace-scoped rules."}
          >
            <MenuItem value="__any">Any namespace</MenuItem>
            {namespaceOptions.map((ns) => (
              <MenuItem key={ns} value={ns}>
                {ns}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Resource scope"
            value={rule.resourceScope}
            onChange={(e) => setRule(index, { resourceScope: e.target.value as SettingsResourceScopeMode })}
          >
            <MenuItem value="any">Any resource</MenuItem>
            <MenuItem value="selected">Selected resources</MenuItem>
          </TextField>
        </Box>
        {rule.resourceScope === "selected" ? (
          <FormControl size="small">
            <InputLabel id={`resources-${rule.id}`}>Resources</InputLabel>
            <Select
              labelId={`resources-${rule.id}`}
              multiple
              label="Resources"
              value={rule.resources}
              onChange={(e: SelectChangeEvent<ListResourceKey[]>) => {
                const value = e.target.value;
                setRule(index, { resources: typeof value === "string" ? [value as ListResourceKey] : value });
              }}
              renderValue={(selected) => selected.map((key) => getResourceLabel(key)).join(", ")}
            >
              {resourceOptions.map((key) => (
                <MenuItem key={key} value={key}>
                  <Checkbox checked={rule.resources.includes(key)} />
                  <ListItemText primary={getResourceLabel(key)} />
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary">
              {smartFilterResourceHelperText(rule.scope)}
            </Typography>
          </FormControl>
        ) : null}
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "minmax(260px, 2fr) minmax(120px, 0.6fr) minmax(180px, 1fr)" }}>
          <TextField
            size="small"
            label="Regex match pattern"
            value={rule.pattern}
            onChange={(e) => setRule(index, { pattern: e.target.value })}
            error={Boolean(error)}
            helperText={error ?? "Matched against the row name."}
          />
          <TextField
            size="small"
            label="Flags"
            value={rule.flags}
            onChange={(e) => setRule(index, { flags: sanitizeRegexFlags(e.target.value) })}
            helperText="Allowed: d g i m s u v y"
          />
          <TextField
            size="small"
            label="Display template"
            value={rule.display}
            onChange={(e) => setRule(index, { display: e.target.value })}
            helperText="JavaScript replacement syntax, e.g. $1."
          />
        </Box>
      </Paper>
    );
  };

  const renderSmartFilters = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6">Smart Filters</Typography>
          <Typography variant="body2" color="text.secondary">
            Rules are evaluated in order. Each row stops at the first matching rule.
          </Typography>
        </Box>
        <Button
          variant="contained"
          onClick={() =>
            setSettings((prev) =>
              updateSmartFilters(prev, { rules: [...prev.smartFilters.rules, newSmartFilterRule()] }),
            )
          }
        >
          Add rule
        </Button>
      </Box>
      <Paper variant="outlined" sx={{ p: 1.25, display: "flex", gap: 1.25, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          size="small"
          type="number"
          label="Minimum rows per chip"
          value={settings.smartFilters.minCount}
          onChange={(e) =>
            setSettings((prev) =>
              updateSmartFilters(prev, {
                minCount: Math.max(1, Math.min(50, Math.round(Number(e.target.value) || 1))),
              }),
            )
          }
          sx={{ width: 220 }}
        />
        <Typography variant="body2" color="text.secondary">
          Current quick filter chips are generated from these rules when smart filters are enabled.
        </Typography>
      </Paper>
      {settings.smartFilters.rules.map(renderRule)}
    </Box>
  );

  const renderCommand = (command: CustomCommandDefinition, index: number) => {
    const patternError = commandPatternError(command);
    return (
      <Paper key={command.id} variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
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
        <FormControlLabel
          control={
            <Switch checked={command.enabled} onChange={(e) => setCommand(index, { enabled: e.target.checked })} />
          }
          label="Enabled"
        />
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <TextField
            size="small"
            label="Name"
            value={command.name}
            onChange={(e) => setCommand(index, { name: e.target.value })}
            helperText="Shown in the container command menu."
          />
          <TextField
            size="small"
            label="Container pattern"
            value={command.containerPattern}
            onChange={(e) => setCommand(index, { containerPattern: e.target.value })}
            error={Boolean(patternError)}
            helperText={patternError ?? "Optional regex matched against the container name."}
          />
          <TextField
            size="small"
            label="Workdir"
            value={command.workdir}
            onChange={(e) => setCommand(index, { workdir: e.target.value })}
            helperText="Optional. Leave blank to use the container default."
          />
        </Box>
        <TextField
          size="small"
          label="Command"
          value={command.command}
          onChange={(e) => setCommand(index, { command: e.target.value })}
          error={!command.command.trim()}
          helperText="Executed with /bin/sh -lc inside the selected container."
          fullWidth
        />
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <TextField
            select
            size="small"
            label="Output type"
            value={command.outputType}
            onChange={(e) => setCommand(index, { outputType: e.target.value as CustomCommandOutputType })}
          >
            <MenuItem value="text">Free text</MenuItem>
            <MenuItem value="keyValue">Key-value</MenuItem>
            <MenuItem value="csv">CSV / delimited table</MenuItem>
            <MenuItem value="code">Code / JSON / YAML</MenuItem>
            <MenuItem value="file">File download</MenuItem>
          </TextField>
          {command.outputType === "code" ? (
            <TextField
              size="small"
              label="Code language"
              value={command.codeLanguage}
              onChange={(e) => setCommand(index, { codeLanguage: e.target.value })}
              helperText="Examples: json, yaml, php, shell. Leave blank to auto-detect common formats."
            />
          ) : null}
          {command.outputType === "file" ? (
            <>
              <TextField
                size="small"
                label="File name"
                value={command.fileName}
                onChange={(e) => setCommand(index, { fileName: e.target.value })}
                helperText="Used for the downloaded output."
              />
              <FormControlLabel
                control={
                  <Switch checked={command.compress} onChange={(e) => setCommand(index, { compress: e.target.checked })} />
                }
                label="Compress with gzip"
              />
            </>
          ) : null}
          <TextField
            select
            size="small"
            label="Safety"
            value={command.safety}
            onChange={(e) => setCommand(index, { safety: e.target.value as CustomCommandSafety })}
            helperText="Dangerous commands require typed confirmation before execution."
          >
            <MenuItem value="safe">Safe: simple confirmation</MenuItem>
            <MenuItem value="dangerous">Dangerous: typed confirmation</MenuItem>
          </TextField>
        </Box>
      </Paper>
    );
  };

  const renderCustomCommands = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6">Custom Commands</Typography>
          <Typography variant="body2" color="text.secondary">
            Commands are stored in this browser profile and become available on matching Pod containers.
          </Typography>
        </Box>
        <Button
          variant="contained"
          onClick={() =>
            setSettings((prev) =>
              updateCustomCommands(prev, {
                commands: [...prev.customCommands.commands, newCustomCommandDefinition()],
              }),
            )
          }
        >
          Add command
        </Button>
      </Box>
      {settings.customCommands.commands.length === 0 ? (
        <Paper variant="outlined" sx={panelBoxSx}>
          <Typography variant="body2" color="text.secondary">
            No custom commands are defined.
          </Typography>
        </Paper>
      ) : (
        settings.customCommands.commands.map(renderCommand)
      )}
    </Box>
  );

  const renderAction = (action: CustomActionDefinition, index: number) => {
    const patternError = actionPatternError(action);
    const patchError = actionPatchError(action);
    return (
      <Paper key={action.id} variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
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
        <FormControlLabel
          control={<Switch checked={action.enabled} onChange={(e) => setAction(index, { enabled: e.target.checked })} />}
          label="Enabled"
        />
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <TextField size="small" label="Name" value={action.name} onChange={(e) => setAction(index, { name: e.target.value })} />
          <TextField
            select
            size="small"
            label="Action"
            value={action.action}
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
          <TextField
            select
            size="small"
            label="Safety"
            value={action.safety}
            onChange={(e) => setAction(index, { safety: e.target.value as CustomCommandSafety })}
          >
            <MenuItem value="safe">Safe: simple confirmation</MenuItem>
            <MenuItem value="dangerous">Dangerous: typed confirmation</MenuItem>
          </TextField>
        </Box>
        <FormControl size="small">
          <InputLabel id={`action-resources-${action.id}`}>Resources</InputLabel>
          <Select
            labelId={`action-resources-${action.id}`}
            multiple
            label="Resources"
            value={action.resources}
            onChange={(e: SelectChangeEvent<ListResourceKey[]>) => {
              const value = e.target.value;
              setAction(index, { resources: typeof value === "string" ? [value as ListResourceKey] : value });
            }}
            renderValue={(selected) => selected.map((key) => getResourceLabel(key)).join(", ")}
          >
            {customActionResourceKeys.map((key) => (
              <MenuItem key={key} value={key}>
                <Checkbox checked={action.resources.includes(key)} />
                <ListItemText primary={getResourceLabel(key)} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {action.action === "patch" ? (
          <>
            <TextField
              select
              size="small"
              label="Patch type"
              value={action.patchType}
              onChange={(e) => setAction(index, { patchType: e.target.value as CustomActionPatchType })}
              sx={{ maxWidth: 240 }}
            >
              <MenuItem value="merge">Merge patch</MenuItem>
              <MenuItem value="json">JSON patch</MenuItem>
            </TextField>
            <TextField
              size="small"
              label="Patch body JSON"
              value={action.patchBody}
              onChange={(e) => setAction(index, { patchBody: e.target.value })}
              error={Boolean(patchError)}
              helperText={patchError ?? "Use JSON. JSON patch expects an array of operations; merge patch expects an object."}
              multiline
              minRows={8}
              fullWidth
              InputProps={{ sx: { fontFamily: "monospace", fontSize: "0.85rem" } }}
            />
          </>
        ) : (
          <>
            <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              <TextField
                select
                size="small"
                label="Target"
                value={action.target}
                onChange={(e) => setAction(index, { target: e.target.value as CustomActionTarget })}
              >
                <MenuItem value="env">Environment variable</MenuItem>
                <MenuItem value="image" disabled={action.action === "unset"}>Container image</MenuItem>
              </TextField>
              {action.target === "env" ? (
                <TextField size="small" label="Env key" value={action.key} onChange={(e) => setAction(index, { key: e.target.value })} />
              ) : null}
              <TextField
                size="small"
                label="Container pattern"
                value={action.containerPattern}
                onChange={(e) => setAction(index, { containerPattern: e.target.value })}
                error={Boolean(patternError)}
                helperText={patternError ?? "Optional regex. Leave blank for all containers."}
              />
            </Box>
            {action.action === "set" ? (
              <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "minmax(220px, 1fr) auto" }}>
                <TextField
                  size="small"
                  label={action.target === "image" ? "Image" : "Value"}
                  value={action.value}
                  onChange={(e) => setAction(index, { value: e.target.value })}
                  disabled={action.runtimeValue}
                />
                <FormControlLabel
                  control={<Switch checked={action.runtimeValue} onChange={(e) => setAction(index, { runtimeValue: e.target.checked })} />}
                  label="Ask at runtime"
                />
              </Box>
            ) : null}
          </>
        )}
      </Paper>
    );
  };

  const renderCustomActions = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6">Custom Actions</Typography>
          <Typography variant="body2" color="text.secondary">
            Actions are browser-local presets for patch-capable workload resources.
          </Typography>
        </Box>
        <Button
          variant="contained"
          onClick={() => setSettings((prev) => updateCustomActions(prev, { actions: [...prev.customActions.actions, newCustomActionDefinition()] }))}
        >
          Add action
        </Button>
      </Box>
      {settings.customActions.actions.length === 0 ? (
        <Paper variant="outlined" sx={panelBoxSx}>
          <Typography variant="body2" color="text.secondary">
            No custom actions are defined.
          </Typography>
        </Paper>
      ) : (
        settings.customActions.actions.map(renderAction)
      )}
    </Box>
  );

  const numField = (
    label: string,
    value: number,
    onChange: (value: number) => void,
    helperText?: string,
  ) => (
    <TextField
      size="small"
      type="number"
      label={label}
      value={value}
      onChange={(e) => onChange(Math.round(Number(e.target.value) || 0))}
      helperText={helperText}
    />
  );

  const renderNsEnrichment = () => {
    const dp = settings.dataplane;
    const ne = dp.namespaceEnrichment;
    const sweep = ne.sweep;
    const signalDefaults = defaultDataplaneSettings().signals;
    const estimatedSweepHours = sweep.maxNamespacesPerHour > 0 && namespaces.length > 0
      ? Math.ceil(namespaces.length / sweep.maxNamespacesPerHour)
      : 0;

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
        <Box>
          <Typography variant="h6">NS Enrichment</Typography>
          <Typography variant="body2" color="text.secondary">
            Dataplane stays in front of all list reads. Focused enrichment covers current, recent, and favourite namespaces;
            the background sweep is opt-in for slow discovery across large clusters.
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle2">Profile</Typography>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <TextField
              select
              size="small"
              label="Dataplane profile"
              value={dp.profile}
              onChange={(e) =>
                setSettings((prev) =>
                  updateDataplane(prev, applyDataplaneProfile(prev.dataplane, e.target.value as DataplaneProfile)),
                )
              }
              helperText="Manual keeps dataplane snapshots but disables background enhancement."
            >
              <MenuItem value="manual">Manual: user interaction only</MenuItem>
              <MenuItem value="focused">Focused: current, recent, favourites</MenuItem>
              <MenuItem value="balanced">Balanced</MenuItem>
              <MenuItem value="wide">Wide</MenuItem>
              <MenuItem value="diagnostic">Diagnostic</MenuItem>
            </TextField>
            {numField("Scheduler concurrency", dp.backgroundBudget.maxConcurrentPerCluster, (value) =>
              setDataplaneBudget({ maxConcurrentPerCluster: value }),
              "Max snapshot workers per cluster.",
            )}
            {numField("Long-run notice (sec)", dp.backgroundBudget.longRunNoticeSec, (value) =>
              setDataplaneBudget({ longRunNoticeSec: value }),
              "0 disables long-running snapshot activity notices.",
            )}
            {numField("Transient retries", dp.backgroundBudget.transientRetries, (value) =>
              setDataplaneBudget({ transientRetries: value }),
            )}
          </Box>
          {dp.profile === "manual" ? (
            <Alert severity="info">
              Manual mode keeps the dataplane cache and metadata, but disables observers, focused enrichment, and sweep.
            </Alert>
          ) : null}
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle2">Focused Namespace Enrichment</Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <FormControlLabel
              control={<Switch checked={ne.enabled} onChange={(e) => setNamespaceEnrichment({ enabled: e.target.checked })} />}
              label="Enabled"
            />
            <FormControlLabel
              control={<Switch checked={ne.includeFocus} onChange={(e) => setNamespaceEnrichment({ includeFocus: e.target.checked })} />}
              label="Current namespace"
            />
            <FormControlLabel
              control={<Switch checked={ne.includeRecent} onChange={(e) => setNamespaceEnrichment({ includeRecent: e.target.checked })} />}
              label="Recent"
            />
            <FormControlLabel
              control={<Switch checked={ne.includeFavourites} onChange={(e) => setNamespaceEnrichment({ includeFavourites: e.target.checked })} />}
              label="Favourites"
            />
          </Box>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {numField("Max targets", ne.maxTargets, (value) => setNamespaceEnrichment({ maxTargets: value }))}
            {numField("Max parallel", ne.maxParallel, (value) => setNamespaceEnrichment({ maxParallel: value }))}
            {numField("Idle quiet (ms)", ne.idleQuietMs, (value) => setNamespaceEnrichment({ idleQuietMs: value }))}
            {numField("Poll interval (ms)", ne.pollMs, (value) => setNamespaceEnrichment({ pollMs: value }))}
            {numField("Recent hint limit", ne.recentLimit, (value) => setNamespaceEnrichment({ recentLimit: value }))}
            {numField("Favourite hint limit", ne.favouriteLimit, (value) => setNamespaceEnrichment({ favouriteLimit: value }))}
          </Box>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <FormControlLabel
              control={<Switch checked={ne.enrichDetails} onChange={(e) => setNamespaceEnrichment({ enrichDetails: e.target.checked })} />}
              label="Namespace details"
            />
            <FormControlLabel
              control={<Switch checked={ne.enrichPods} onChange={(e) => setNamespaceEnrichment({ enrichPods: e.target.checked })} />}
              label="Pods"
            />
            <FormControlLabel
              control={<Switch checked={ne.enrichDeployments} onChange={(e) => setNamespaceEnrichment({ enrichDeployments: e.target.checked })} />}
              label="Deployments"
            />
          </Box>
          <FormControl size="small" fullWidth>
            <InputLabel id="namespace-warm-kinds-label">Resource snapshots warmed by enrichment</InputLabel>
            <Select
              labelId="namespace-warm-kinds-label"
              multiple
              label="Resource snapshots warmed by enrichment"
              value={ne.warmResourceKinds}
              onChange={(e: SelectChangeEvent<string[]>) => {
                const value = e.target.value;
                setNamespaceEnrichment({
                  warmResourceKinds: typeof value === "string" ? value.split(",") : value,
                });
              }}
              renderValue={(selected) => selected.map(dataplaneWarmResourceLabel).join(", ")}
            >
              {dataplaneNamespaceWarmResourceKeys.map((kind) => (
                <MenuItem key={kind} value={kind}>
                  <Checkbox checked={ne.warmResourceKinds.includes(kind)} />
                  <ListItemText primary={dataplaneWarmResourceLabel(kind)} />
                </MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary">
              Focused defaults to pods and deployments. Wide and diagnostic warm every namespaced dataplane list kind slowly within the same target and sweep caps.
            </Typography>
          </FormControl>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle2">Background Namespace Sweep</Typography>
          <Alert severity={sweep.enabled ? "warning" : "info"}>
            Sweep slowly enriches namespaces outside the focused set while the app is idle. On this context,{" "}
            {namespaces.length || "unknown"} namespaces would take about {estimatedSweepHours || "?"} idle hour(s) at the current hourly cap.
          </Alert>
          <FormControlLabel
            control={<Switch checked={sweep.enabled} onChange={(e) => setNamespaceSweep({ enabled: e.target.checked })} />}
            label="Enable background sweep"
          />
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {numField("Idle quiet (ms)", sweep.idleQuietMs, (value) => setNamespaceSweep({ idleQuietMs: value }))}
            {numField("Namespaces / cycle", sweep.maxNamespacesPerCycle, (value) => setNamespaceSweep({ maxNamespacesPerCycle: value }))}
            {numField("Namespaces / hour", sweep.maxNamespacesPerHour, (value) => setNamespaceSweep({ maxNamespacesPerHour: value }))}
            {numField("Re-enrich after (min)", sweep.minReenrichIntervalMinutes, (value) => setNamespaceSweep({ minReenrichIntervalMinutes: value }))}
            {numField("Max parallel", sweep.maxParallel, (value) => setNamespaceSweep({ maxParallel: value }))}
          </Box>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <FormControlLabel
              control={<Switch checked={sweep.pauseOnUserActivity} onChange={(e) => setNamespaceSweep({ pauseOnUserActivity: e.target.checked })} />}
              label="Pause on activity"
            />
            <FormControlLabel
              control={<Switch checked={sweep.pauseWhenSchedulerBusy} onChange={(e) => setNamespaceSweep({ pauseWhenSchedulerBusy: e.target.checked })} />}
              label="Pause when busy"
            />
            <FormControlLabel
              control={<Switch checked={sweep.pauseOnRateLimitOrConnectivityIssues} onChange={(e) => setNamespaceSweep({ pauseOnRateLimitOrConnectivityIssues: e.target.checked })} />}
              label="Pause on rate limits"
            />
            <FormControlLabel
              control={<Switch checked={sweep.includeSystemNamespaces} onChange={(e) => setNamespaceSweep({ includeSystemNamespaces: e.target.checked })} />}
              label="Include system namespaces"
            />
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle2">Observers and Dashboard</Typography>
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            <FormControlLabel
              control={<Switch checked={dp.observers.enabled} onChange={(e) => setDataplaneObservers({ enabled: e.target.checked })} />}
              label="Observers"
            />
            <FormControlLabel
              control={<Switch checked={dp.observers.namespacesEnabled} onChange={(e) => setDataplaneObservers({ namespacesEnabled: e.target.checked })} />}
              label="Namespace observer"
            />
            <FormControlLabel
              control={<Switch checked={dp.observers.nodesEnabled} onChange={(e) => setDataplaneObservers({ nodesEnabled: e.target.checked })} />}
              label="Node observer"
            />
          </Box>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
            {numField("Namespace observer (sec)", dp.observers.namespacesIntervalSec, (value) => setDataplaneObservers({ namespacesIntervalSec: value }))}
            {numField("Node observer (sec)", dp.observers.nodesIntervalSec, (value) => setDataplaneObservers({ nodesIntervalSec: value }))}
            {numField("Node backoff max (sec)", dp.observers.nodesBackoffMaxSec, (value) => setDataplaneObservers({ nodesBackoffMaxSec: value }))}
            {numField("Restart threshold", dp.dashboard.restartElevatedThreshold, (value) => setDataplaneDashboard({ restartElevatedThreshold: value }))}
            {numField("Signal limit", dp.dashboard.signalLimit, (value) => setDataplaneDashboard({ signalLimit: value }))}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle2">Persisted Dataplane Cache</Typography>
          <Alert severity={dp.persistence.enabled ? "warning" : "info"}>
            Persisted snapshots keep the last observed list data on this device for restart recovery and cached quick access search. Results are stale until refreshed by the cluster.
          </Alert>
          <FormControlLabel
            control={<Switch checked={dp.persistence.enabled} onChange={(e) => setDataplanePersistence({ enabled: e.target.checked })} />}
            label="Persist dataplane snapshots"
          />
          {numField("Max persisted age (hours)", dp.persistence.maxAgeHours, (value) => setDataplanePersistence({ maxAgeHours: value }), "Older snapshots are ignored on restart.")}
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle2">Metrics (metrics.k8s.io)</Typography>
          <Alert severity="info" sx={{ py: 0 }}>
            Real-time pod and node usage from metrics-server. Disabled automatically when the API is missing or RBAC denies it; this toggle adds a soft gate on top of capability detection.
          </Alert>
          <FormControlLabel
            control={<Switch checked={dp.metrics.enabled} onChange={(e) => setDataplaneMetrics({ enabled: e.target.checked })} />}
            label="Enable metrics integration"
          />
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            {numField(
              "Pod metrics TTL (sec)",
              dp.metrics.podMetricsTtlSec,
              (value) => setDataplaneMetrics({ podMetricsTtlSec: value }),
              "How often pod usage is sampled per cluster.",
            )}
            {numField(
              "Node metrics TTL (sec)",
              dp.metrics.nodeMetricsTtlSec,
              (value) => setDataplaneMetrics({ nodeMetricsTtlSec: value }),
              "How often node usage is sampled per cluster.",
            )}
            {numField(
              "Container near-limit (%)",
              dp.metrics.containerNearLimitPct,
              (value) => setDataplaneMetrics({ containerNearLimitPct: value }),
              "Threshold above which containers raise a usage signal.",
            )}
            {numField(
              "Node pressure (%)",
              dp.metrics.nodePressurePct,
              (value) => setDataplaneMetrics({ nodePressurePct: value }),
              "Threshold above which nodes raise a resource-pressure signal.",
            )}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
            <Typography variant="subtitle2">Signals Thresholds</Typography>
            <Button
              size="small"
              onClick={() => {
                setDataplaneSignals(signalDefaults);
              }}
            >
              Reset signal thresholds
            </Button>
          </Box>
          <Alert severity="info" sx={{ py: 0 }}>
            These values control when dataplane signals trigger. Defaults are applied automatically on first startup; use reset to return to system defaults.
          </Alert>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
            {numField(
              "Long-running job (sec)",
              dp.signals.longRunningJobSec,
              (value) => setDataplaneSignals({ longRunningJobSec: value }),
              `Default: ${signalDefaults.longRunningJobSec}`,
            )}
            {numField(
              "CronJob no recent success (sec)",
              dp.signals.cronJobNoRecentSuccessSec,
              (value) => setDataplaneSignals({ cronJobNoRecentSuccessSec: value }),
              `Default: ${signalDefaults.cronJobNoRecentSuccessSec}`,
            )}
            {numField(
              "Stale Helm release (sec)",
              dp.signals.staleHelmReleaseSec,
              (value) => setDataplaneSignals({ staleHelmReleaseSec: value }),
              `Default: ${signalDefaults.staleHelmReleaseSec}`,
            )}
            {numField(
              "Unused resource age (sec)",
              dp.signals.unusedResourceAgeSec,
              (value) => setDataplaneSignals({ unusedResourceAgeSec: value }),
              `Default: ${signalDefaults.unusedResourceAgeSec}`,
            )}
            {numField(
              "Young pod restart window (sec)",
              dp.signals.podYoungRestartWindowSec,
              (value) => setDataplaneSignals({ podYoungRestartWindowSec: value }),
              `Default: ${signalDefaults.podYoungRestartWindowSec}`,
            )}
            {numField(
              "Deployment unavailable (sec)",
              dp.signals.deploymentUnavailableSec,
              (value) => setDataplaneSignals({ deploymentUnavailableSec: value }),
              `Default: ${signalDefaults.deploymentUnavailableSec}`,
            )}
            {numField(
              "Quota warn (%)",
              dp.signals.quotaWarnPercent,
              (value) => setDataplaneSignals({ quotaWarnPercent: value }),
              `Default: ${signalDefaults.quotaWarnPercent}`,
            )}
            {numField(
              "Quota critical (%)",
              dp.signals.quotaCriticalPercent,
              (value) => setDataplaneSignals({ quotaCriticalPercent: value }),
              `Default: ${signalDefaults.quotaCriticalPercent}`,
            )}
          </Box>
        </Paper>

        <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
          <Typography variant="subtitle2">Snapshot TTLs</Typography>
          <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
            {dataplaneTTLResourceKeys.map((key) => (
              <TextField
                key={key}
                size="small"
                type="number"
                label={`${getResourceLabel(key as ListResourceKey)} TTL`}
                value={dp.snapshots.ttlSec[key]}
                onChange={(e) =>
                  setDataplaneSnapshots({
                    ttlSec: {
                      ...dp.snapshots.ttlSec,
                      [key]: Math.round(Number(e.target.value) || 0),
                    },
                  })
                }
                helperText="seconds"
              />
            ))}
          </Box>
        </Paper>
      </Box>
    );
  };

  const renderImportExport = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
      <Typography variant="h6">Import / Export</Typography>
      <Paper variant="outlined" sx={{ p: 1.25, display: "flex", flexDirection: "column", gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          This exports user settings only. Active context, namespace history, favourites, and theme are not included.
        </Typography>
        <Box sx={actionRowSx}>
          <Button
            variant="contained"
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
            Export JSON
          </Button>
          <Button
            color="warning"
            onClick={() => {
              if (!window.confirm("Reset settings to defaults? This will overwrite the current settings profile.")) return;
              resetSettings();
            }}
          >
            Reset to defaults
          </Button>
        </Box>
        <Divider />
        <Button variant="outlined" component="label" sx={{ alignSelf: "flex-start" }}>
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
        </Button>
        <TextField
          label="Import settings JSON"
          multiline
          minRows={10}
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          fullWidth
        />
        <Box sx={actionRowSx}>
          <Button
            variant="contained"
            onClick={() => {
              importSettingsText(importText);
            }}
            disabled={!importText.trim()}
          >
            Import JSON
          </Button>
          <Button onClick={() => setImportText("")}>Clear</Button>
        </Box>
        {importMessage ? <Alert severity={importMessage.severity}>{importMessage.text}</Alert> : null}
      </Paper>
    </Box>
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", overflow: "hidden", backgroundColor: "var(--bg-primary)" }}>
      <Paper
        variant="outlined"
        sx={{
          width: 240,
          flexShrink: 0,
          borderRadius: 0,
          borderTop: 0,
          borderBottom: 0,
          p: 1.5,
          overflowY: "auto",
        }}
      >
        <Typography variant="overline" color="text.secondary">
          Settings
        </Typography>
        <List dense disablePadding>
          {sections.map((item) => (
            <ListItemButton key={item.id} selected={section === item.id} onClick={() => setSection(item.id)}>
              <ListItemText primary={item.label} primaryTypographyProps={{ variant: "body2" }} />
            </ListItemButton>
          ))}
        </List>
      </Paper>
      <Box sx={{ flex: 1, minWidth: 0, overflow: "auto", p: 1.25 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.25, mb: 1.25 }}>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Changes are saved automatically in this browser profile.
            </Typography>
          </Box>
          <Tooltip title="Close settings">
            <IconButton aria-label="Close settings" onClick={onClose} size="small">
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {section === "appearance" ? renderAppearance() : null}
        {section === "smartFilters" ? renderSmartFilters() : null}
        {section === "commands" ? renderCustomCommands() : null}
        {section === "actions" ? renderCustomActions() : null}
        {section === "nsEnrichment" ? renderNsEnrichment() : null}
        {section === "importExport" ? renderImportExport() : null}
      </Box>
    </Box>
  );
}
