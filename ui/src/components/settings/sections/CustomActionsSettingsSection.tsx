import React from "react";
import { Box, MenuItem, TextField, Typography } from "@mui/material";
import {
  customActionResourceKeys,
  newCustomActionDefinition,
  type CustomActionDefinition,
  type CustomActionKind,
  type CustomActionPatchType,
  type CustomActionTarget,
  type CustomCommandSafety,
  type KviewUserSettingsV2,
} from "../../../settings";
import { getResourceLabel, type ListResourceKey } from "../../../utils/k8sResources";
import { AppButton } from "../../shared/AppActions";
import SettingsIcon from "../SettingsIcon";
import {
  FieldGroup,
  ReorderButtons,
  SettingField,
  SettingGrid,
  SettingRow,
  SettingSection,
  SettingsMultiSelect,
  type SettingsMultiSelectOption,
} from "../shared";
import { moveItem } from "../shared/reorder";

type Props = {
  settings: KviewUserSettingsV2;
  setSettings: React.Dispatch<React.SetStateAction<KviewUserSettingsV2>>;
};

const headerRowSx = { display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" } as const;
const settingsItemCardSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 2,
  p: 1.5,
  display: "flex",
  flexDirection: "column",
  gap: 1,
} as const;
const denseSelectMenuProps = {
  slotProps: {
    paper: {
      sx: {
        "& .MuiMenuItem-root": { minHeight: 30, py: 0.25, fontSize: "0.875rem" },
        "& .MuiCheckbox-root": { py: 0.25 },
        "& .MuiListItemText-root": { my: 0 },
      },
    },
  },
};

function resourceMultiSelectOptions(keys: readonly ListResourceKey[]): Array<SettingsMultiSelectOption<ListResourceKey>> {
  return keys.map((key) => ({ value: key, label: getResourceLabel(key) }));
}

function updateCustomActions(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["customActions"]>,
): KviewUserSettingsV2 {
  return { ...settings, customActions: { ...settings.customActions, ...patch } };
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

export default function CustomActionsSettingsSection({ settings, setSettings }: Props) {
  const setAction = (index: number, patch: Partial<CustomActionDefinition>) => {
    setSettings((prev) => {
      const actions = prev.customActions.actions.map((action, i) =>
        i === index ? { ...action, ...patch } : action,
      );
      return updateCustomActions(prev, { actions });
    });
  };

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
            onUp={() => setSettings((prev) => updateCustomActions(prev, {
              actions: moveItem(prev.customActions.actions, index, -1),
            }))}
            onDown={() => setSettings((prev) => updateCustomActions(prev, {
              actions: moveItem(prev.customActions.actions, index, 1),
            }))}
            onRemove={() => setSettings((prev) => updateCustomActions(prev, {
              actions: prev.customActions.actions.filter((_, i) => i !== index),
            }))}
          />
        </Box>
        <SettingRow label="Enabled" checked={action.enabled} onChange={(v) => setAction(index, { enabled: v })} />
        <SettingGrid variant="auto">
          <SettingField label="Name" value={action.name} onChange={(v) => setAction(index, { name: v })} />
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
                <SettingField label="Env key" value={action.key} onChange={(v) => setAction(index, { key: v })} />
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

  return (
    <SettingSection
      title="Custom Actions"
      icon={<SettingsIcon name="actions" />}
      hint="Custom actions are browser-local presets for patch-capable workload resources."
      actions={
        <AppButton
          intent="primary"
          onClick={() => setSettings((prev) => updateCustomActions(prev, {
            actions: [...prev.customActions.actions, newCustomActionDefinition()],
          }))}
        >
          Add action
        </AppButton>
      }
    >
      {settings.customActions.actions.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No custom actions are defined.</Typography>
      ) : settings.customActions.actions.map(renderAction)}
    </SettingSection>
  );
}
