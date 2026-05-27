import React, { useMemo, useState } from "react";
import { Box, Checkbox, Divider, ListItemText, Menu, MenuItem, TextField, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DataObjectIcon from "@mui/icons-material/DataObject";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import type { ResourceMacroDefinition, ResourceMacroScopeRef, ResourceMacrosSettings } from "../../settings";
import { useActiveContext } from "../../activeContext";
import { resolveResourceMacros, type ResourceMacroTarget, type ResolvedMacro } from "../../resourceMacros";
import { useUserSettings } from "../../settingsContext";
import type { ListResourceKey } from "../../utils/k8sResources";
import { AppButton, AppIconButton } from "./AppActions";

type MacroEditorTarget = {
  context: string;
  resource: ListResourceKey;
  namespace: string;
  name: string;
  nodeName?: string | null;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

function cleanMacroName(value: string): string {
  const cleaned = value.replace(/^\$/, "").toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return cleaned.replace(/^[^A-Z]+/, "").slice(0, 64);
}

function macroScopeForTarget(target: MacroEditorTarget): ResourceMacroScopeRef {
  if (target.resource === "namespaces") {
    return {
      scope: "namespace",
      context: target.context,
      namespace: target.name,
      node: "",
      resource: "",
      name: "",
    };
  }
  if (target.resource === "nodes") {
    return {
      scope: "node",
      context: target.context,
      namespace: "",
      node: target.name,
      resource: "",
      name: "",
    };
  }
  return {
    scope: "resource",
    context: target.context,
    namespace: target.namespace,
    node: "",
    resource: target.resource,
    name: target.name,
  };
}

function scopeEquals(a: ResourceMacroScopeRef, b: ResourceMacroScopeRef): boolean {
  return a.scope === b.scope &&
    a.context === b.context &&
    a.namespace === b.namespace &&
    a.node === b.node &&
    a.resource === b.resource &&
    a.name === b.name;
}

function scopeLabel(scope: ResourceMacroScopeRef): string {
  if (scope.scope === "namespace") return `Namespace ${scope.namespace}`;
  if (scope.scope === "node") return `Node ${scope.node}`;
  if (scope.scope === "resource" && scope.resource === "pods") return `Pod ${scope.name}`;
  if (scope.scope === "resource") return `${scope.resource || "resource"} ${scope.name}`;
  return scope.scope;
}

function updateDefinition(
  settings: ResourceMacrosSettings,
  id: string,
  patch: Partial<ResourceMacroDefinition>,
): ResourceMacrosSettings {
  return {
    ...settings,
    definitions: settings.definitions.map((definition) =>
      definition.id === id ? { ...definition, ...patch } : definition,
    ),
  };
}

function removeDefinition(settings: ResourceMacrosSettings, id: string): ResourceMacrosSettings {
  return {
    ...settings,
    definitions: settings.definitions.filter((definition) => definition.id !== id),
  };
}

function addScopedDefinition(
  settings: ResourceMacrosSettings,
  scope: ResourceMacroScopeRef,
): ResourceMacrosSettings {
  return {
    ...settings,
    definitions: [
      ...settings.definitions,
      {
        id: `macro-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        enabled: true,
        macroName: "MACRO_NAME",
        value: "",
        scope,
      },
    ],
  };
}

function macroTargetForEditorTarget(target: MacroEditorTarget): ResourceMacroTarget {
  return {
    context: target.context,
    resource: target.resource,
    namespace: target.namespace,
    name: target.name,
    nodeName: target.nodeName || "",
    labels: target.labels,
    annotations: target.annotations,
  };
}

function macroSecondaryText(macro: ResolvedMacro): string {
  const source = macro.source === "extracted" ? "extracted" : "inherited";
  return `${macro.error || macro.value} (${source})`;
}

export function ResourceMacrosEditorButton({ target }: { target: MacroEditorTarget | null }) {
  const { settings, setSettings } = useUserSettings();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [showInherited, setShowInherited] = useState(false);
  const open = Boolean(anchorEl);
  const scope = useMemo(() => target ? macroScopeForTarget(target) : null, [target]);
  const definitions = useMemo(
    () => scope ? settings.resourceMacros.definitions.filter((definition) => scopeEquals(definition.scope, scope)) : [],
    [scope, settings.resourceMacros.definitions],
  );
  const inherited = useMemo(() => {
    if (!target) return [];
    const directIds = new Set(definitions.map((definition) => definition.id));
    return Object.values(resolveResourceMacros(settings.resourceMacros, macroTargetForEditorTarget(target)).macros)
      .filter((macro) => !directIds.has(macro.definitionId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [definitions, settings.resourceMacros, target]);

  if (!settings.resourceMacros.enabled) return null;

  const setMacroSettings = (next: ResourceMacrosSettings) => {
    setSettings((prev) => ({ ...prev, resourceMacros: next }));
  };

  return (
    <>
      <AppIconButton
        tooltip="Edit resource macros"
        label="Edit resource macros"
        disabled={!target || !scope}
        onClick={(event) => setAnchorEl(event.currentTarget)}
      >
        <DataObjectIcon fontSize="small" />
      </AppIconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        keepMounted
        slotProps={{ paper: { sx: { width: 400, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <MenuItem disabled sx={{ opacity: 1 }}>
          <ListItemText
            primary={scope ? scopeLabel(scope) : "Resource macros"}
            secondary="Manual macros assigned here override broader scopes."
            slotProps={{
              primary: { variant: "body2", sx: { fontWeight: 600 } },
              secondary: { variant: "caption" },
            }}
          />
        </MenuItem>
        <Divider />
        {definitions.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary="No macros assigned" secondary="Add a macro for this drawer scope." />
          </MenuItem>
        ) : null}
        {definitions.map((definition) => (
          <Box
            key={definition.id}
            sx={{ px: 1, py: 0.75, display: "grid", gridTemplateColumns: "126px minmax(0, 1fr) auto", gap: 0.75, alignItems: "center" }}
            onClick={(event) => event.stopPropagation()}
          >
            <TextField
              size="small"
              value={definition.macroName}
              onChange={(event) => setMacroSettings(updateDefinition(settings.resourceMacros, definition.id, { macroName: cleanMacroName(event.target.value) }))}
              placeholder="MACRO_NAME"
              fullWidth
              slotProps={{ input: { sx: { fontSize: 13 } } }}
            />
            <TextField
              size="small"
              value={definition.value}
              onChange={(event) => setMacroSettings(updateDefinition(settings.resourceMacros, definition.id, { value: event.target.value }))}
              placeholder="Value"
              fullWidth
              slotProps={{ input: { sx: { fontSize: 13 } } }}
            />
            <AppIconButton
              tooltip="Remove macro assignment"
              label="Remove macro assignment"
              onClick={() => setMacroSettings(removeDefinition(settings.resourceMacros, definition.id))}
            >
              <DeleteOutlineIcon fontSize="small" />
            </AppIconButton>
          </Box>
        ))}
        <Divider />
        <MenuItem dense onClick={() => setShowInherited((value) => !value)} sx={{ minHeight: 34 }}>
          <Checkbox size="small" checked={showInherited} />
          <ListItemText
            primary="Show inherited and extracted macros"
            secondary={`${inherited.length} available for this resource`}
            slotProps={{
              primary: { variant: "body2" },
              secondary: { variant: "caption" },
            }}
          />
        </MenuItem>
        {showInherited && inherited.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary="No inherited or extracted macros" />
          </MenuItem>
        ) : null}
        {showInherited
          ? inherited.map((macro) => (
            <MenuItem key={`${macro.definitionId}-${macro.name}`} dense disabled sx={{ minHeight: 34 }}>
              <ListItemText
                primary={`$${macro.name}`}
                secondary={macroSecondaryText(macro)}
                slotProps={{
                  primary: { variant: "body2" },
                  secondary: { variant: "caption", sx: { overflowWrap: "anywhere", whiteSpace: "normal" } },
                }}
              />
            </MenuItem>
          ))
          : null}
        <Box sx={{ px: 1, py: 0.75, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {definitions.length} assigned
          </Typography>
          <AppButton
            startIcon={<AddIcon />}
            onClick={() => {
              if (!scope) return;
              setMacroSettings(addScopedDefinition(settings.resourceMacros, scope));
            }}
          >
            Add macro
          </AppButton>
        </Box>
      </Menu>
    </>
  );
}

export function ResourceDrawerMacros({
  resource,
  namespace,
  name,
  nodeName,
  labels,
  annotations,
}: {
  resource: ListResourceKey;
  namespace?: string | null;
  name?: string | null;
  nodeName?: string | null;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}) {
  const context = useActiveContext();
  const target = name
    ? {
      context,
      resource,
      namespace: namespace || "",
      name,
      nodeName,
      labels,
      annotations,
    }
    : null;
  return <ResourceMacrosEditorButton target={target} />;
}
