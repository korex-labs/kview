import React from "react";
import { Box, MenuItem, TextField, Typography } from "@mui/material";
import {
  newCustomCommandDefinition,
  type CustomCommandDefinition,
  type CustomCommandOutputType,
  type CustomCommandSafety,
  type KviewUserSettingsV2,
} from "../../../settings";
import { AppButton } from "../../shared/AppActions";
import SettingsIcon from "../SettingsIcon";
import { FieldGroup, ReorderButtons, SettingField, SettingGrid, SettingRow, SettingSection } from "../shared";
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

function updateCustomCommands(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["customCommands"]>,
): KviewUserSettingsV2 {
  return { ...settings, customCommands: { ...settings.customCommands, ...patch } };
}

function updatePodDebug(
  settings: KviewUserSettingsV2,
  patch: Partial<KviewUserSettingsV2["podDebug"]>,
): KviewUserSettingsV2 {
  return { ...settings, podDebug: { ...settings.podDebug, ...patch } };
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

export default function PodToolsSettingsSection({ settings, setSettings }: Props) {
  const setCommand = (index: number, patch: Partial<CustomCommandDefinition>) => {
    setSettings((prev) => {
      const commands = prev.customCommands.commands.map((command, i) =>
        i === index ? { ...command, ...patch } : command,
      );
      return updateCustomCommands(prev, { commands });
    });
  };

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
            onUp={() => setSettings((prev) => updateCustomCommands(prev, {
              commands: moveItem(prev.customCommands.commands, index, -1),
            }))}
            onDown={() => setSettings((prev) => updateCustomCommands(prev, {
              commands: moveItem(prev.customCommands.commands, index, 1),
            }))}
            onRemove={() => setSettings((prev) => updateCustomCommands(prev, {
              commands: prev.customCommands.commands.filter((_, i) => i !== index),
            }))}
          />
        </Box>
        <SettingRow label="Enabled" checked={command.enabled} onChange={(v) => setCommand(index, { enabled: v })} />
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
          <SettingField label="Safety" hint="Dangerous commands require typed confirmation before execution.">
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

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <SettingSection
        title="Pod Debug"
        icon={<SettingsIcon name="commands" />}
        hint="Defaults for ephemeral debug containers opened from Pod drawers. Kubernetes cannot remove an ephemeral container after it is added to a Pod."
      >
        <SettingRow
          label="Enable Pod Debug"
          checked={settings.podDebug.enabled}
          onChange={(enabled) => setSettings((prev) => updatePodDebug(prev, { enabled }))}
        />
        <SettingGrid variant="auto">
          <SettingField
            label="Default debug image"
            value={settings.podDebug.defaultImage}
            onChange={(defaultImage) => setSettings((prev) => updatePodDebug(prev, { defaultImage }))}
            hint="Use an organization-approved image with a shell. Avoid mutable latest tags."
          />
          <SettingField
            label="Default shell"
            value={settings.podDebug.defaultShell}
            onChange={(defaultShell) => setSettings((prev) => updatePodDebug(prev, { defaultShell }))}
            hint="Absolute path executed as the debug container's main process."
          />
        </SettingGrid>
      </SettingSection>
      <SettingSection
        title="Custom Commands"
        icon={<SettingsIcon name="commands" />}
        hint="Commands are stored in this browser profile and become available on matching Pod containers."
        actions={
          <AppButton
            intent="primary"
            onClick={() => setSettings((prev) => updateCustomCommands(prev, {
              commands: [...prev.customCommands.commands, newCustomCommandDefinition()],
            }))}
          >
            Add command
          </AppButton>
        }
      >
        {settings.customCommands.commands.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No custom commands are defined.</Typography>
        ) : settings.customCommands.commands.map(renderCommand)}
      </SettingSection>
    </Box>
  );
}
