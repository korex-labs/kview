import React, { useEffect, useMemo, useState } from "react";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Tab,
  TablePagination,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { actionDefinitions, type EffectiveKeyboardAction, type KeySequence } from "../../keyboard/actions";
import {
  effectiveDynamicKeyboardActions,
  type DynamicKeyboardActionDefinition,
  type EffectiveDynamicKeyboardAction,
} from "../../keyboard/dynamicActions";
import { validateKeymap, type KeymapDiagnostic } from "../../keyboard/keymapValidation";
import { compileKeymap, keymapPresets } from "../../keyboard/keymaps";
import { canonicalizeKeyChord, eventToBinding } from "../../keyboard/keyboardUtils";
import type { KeyboardSettings } from "../../settings";
import SettingsIcon, { type SettingsIconName } from "./SettingsIcon";
import { settingsTabsSx } from "./settingsTabs";

export type KeyboardShortcutsEditorProps = {
  settings: KeyboardSettings;
  onChange: (settings: KeyboardSettings) => void;
  dynamicActions?: DynamicKeyboardActionDefinition[];
};

const pureModifierKeys = new Set(["Alt", "Control", "Meta", "Shift"]);
const actionPageSize = 12;
const presetDisplayLabels: Record<KeyboardSettings["preset"], string> = {
  "kview-classic": "Kview Classic",
  "vim-k9s": "Vim/k9s",
  "browser-safe": "Browser Safe",
};
const groupIcons: Record<string, SettingsIconName> = {
  Global: "overview",
  Navigation: "allContexts",
  Table: "dataplane",
  Drawer: "linksMacros",
  Activity: "signals",
  "Custom Commands": "commands",
  "Custom Actions": "actions",
};

function sequenceLabel(sequence: KeySequence): string {
  return sequence.join(" ");
}

function hasOverride(settings: KeyboardSettings, actionId: string): boolean {
  return Object.prototype.hasOwnProperty.call(settings.overrides, actionId);
}

function diagnosticsForAction(diagnostics: KeymapDiagnostic[], actionId: string): KeymapDiagnostic[] {
  return diagnostics.filter((diagnostic) =>
    diagnostic.actionId === actionId || diagnostic.conflictingActionId === actionId,
  );
}

export default function KeyboardShortcutsEditor({
  settings,
  onChange,
  dynamicActions = [],
}: KeyboardShortcutsEditorProps) {
  const [draft, setDraft] = useState(settings);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [selectedGroup, setSelectedGroup] = useState("Global");
  const [recordingActionId, setRecordingActionId] = useState<string | null>(null);
  const [recordedSequence, setRecordedSequence] = useState<KeySequence>([]);
  const [recorderError, setRecorderError] = useState("");

  useEffect(() => setDraft(settings), [settings]);

  const builtInActions = useMemo(
    () => compileKeymap(draft.preset, draft.overrides),
    [draft.overrides, draft.preset],
  );
  const effectiveDynamicActions = useMemo(
    () => effectiveDynamicKeyboardActions(dynamicActions, draft.overrides),
    [draft.overrides, dynamicActions],
  );
  const effectiveActions = useMemo(
    () => [...builtInActions, ...effectiveDynamicActions],
    [builtInActions, effectiveDynamicActions],
  );
  const diagnostics = useMemo(
    () => validateKeymap([
      ...builtInActions,
      ...effectiveDynamicActions.filter((action) => action.enabled),
    ]),
    [builtInActions, effectiveDynamicActions],
  );
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const builtInIds = useMemo(() => new Set<string>(actionDefinitions.map((action) => action.id)), []);
  const hasBuiltInOverrides = Object.keys(draft.overrides).some((actionId) => builtInIds.has(actionId));
  const effectiveById = useMemo(
    () => new Map<string, EffectiveKeyboardAction | EffectiveDynamicKeyboardAction>(
      effectiveActions.map((action) => [action.id, action]),
    ),
    [effectiveActions],
  );

  const normalizedSearch = search.trim().toLowerCase();
  const groupTabs = useMemo(() => effectiveActions
    .map((action) => action.group)
    .filter((group, index, all) => all.indexOf(group) === index)
    .map((group) => ({ group, count: effectiveActions.filter((action) => action.group === group).length })), [effectiveActions]);
  const filteredActions = useMemo(() => effectiveActions.filter((action) => {
    if (action.group !== selectedGroup) return false;
    if (!normalizedSearch) return true;
    const typeLabel = "typeLabel" in action ? action.typeLabel : "Built-in";
    return [action.label, action.group, action.id, typeLabel, ...action.scopes]
      .some((value) => value.toLowerCase().includes(normalizedSearch));
  }), [effectiveActions, normalizedSearch, selectedGroup]);
  const pageCount = Math.max(1, Math.ceil(filteredActions.length / actionPageSize));
  const pageActions = filteredActions.slice(page * actionPageSize, (page + 1) * actionPageSize);

  useEffect(() => {
    if (!groupTabs.some(({ group }) => group === selectedGroup)) {
      setSelectedGroup(groupTabs[0]?.group ?? "Global");
    }
  }, [groupTabs, selectedGroup]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  const applyOverrides = (overrides: KeyboardSettings["overrides"]) => {
    setDraft((current) => ({ ...current, overrides }));
  };

  const setActionBindings = (actionId: string, bindings: KeySequence[]) => {
    applyOverrides({
      ...draft.overrides,
      [actionId]: bindings.map((binding) => [...binding]),
    });
  };

  const resetAction = (actionId: string) => {
    const nextOverrides = { ...draft.overrides };
    delete nextOverrides[actionId];
    applyOverrides(nextOverrides);
  };

  const openRecorder = (actionId: string) => {
    setRecordingActionId(actionId);
    setRecordedSequence([]);
    setRecorderError("");
  };

  const closeRecorder = () => {
    setRecordingActionId(null);
    setRecordedSequence([]);
    setRecorderError("");
  };

  const saveRecordedBinding = () => {
    if (!recordingActionId || recordedSequence.length === 0) return;
    const existing = effectiveById.get(recordingActionId)?.bindings ?? [];
    const key = sequenceLabel(recordedSequence);
    if (existing.some((binding) => sequenceLabel(binding) === key)) {
      setRecorderError(`“${key}” is already assigned to this action.`);
      return;
    }
    setActionBindings(recordingActionId, [...existing, [...recordedSequence]]);
    closeRecorder();
  };

  const handleRecorderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      closeRecorder();
      return;
    }
    if (event.key === "Enter") {
      if (recordedSequence.length > 0) saveRecordedBinding();
      return;
    }
    if (event.key === "Backspace") {
      setRecordedSequence((current) => current.slice(0, -1));
      setRecorderError("");
      return;
    }
    if (pureModifierKeys.has(event.key)) return;
    const maxSequenceLength = effectiveById.get(recordingActionId!)?.maxSequenceLength ?? 4;
    if (recordedSequence.length >= maxSequenceLength) {
      setRecorderError(`This action accepts at most ${maxSequenceLength} ${maxSequenceLength === 1 ? "chord" : "chords"}.`);
      return;
    }
    const binding = canonicalizeKeyChord(eventToBinding(event));
    if (!binding) {
      setRecorderError("That key chord cannot be recorded.");
      return;
    }
    setRecordedSequence((current) => [...current, binding]);
    setRecorderError("");
  };

  const resetAllBuiltIns = () => {
    applyOverrides(Object.fromEntries(
      Object.entries(draft.overrides).filter(([actionId]) => !builtInIds.has(actionId)),
    ));
  };

  return (
    <Stack spacing={2}>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(180px, 0.45fr) 1fr auto" }, gap: 1.5, alignItems: "start" }}>
        <TextField
          select
          size="small"
          label="Keyboard preset"
          value={draft.preset}
          onChange={(event) => setDraft((current) => ({ ...current, preset: event.target.value as KeyboardSettings["preset"] }))}
        >
          {keymapPresets.map((preset) => (
            <MenuItem key={preset.id} value={preset.id}>{presetDisplayLabels[preset.id]}</MenuItem>
          ))}
        </TextField>
        <TextField
          size="small"
          label="Search keyboard actions"
          value={search}
          onChange={(event) => { setSearch(event.target.value); setPage(0); }}
          placeholder="Label, group, stable ID, or scope"
        />
        <Tooltip title="Remove overrides for built-in actions and restore this preset's defaults. Custom Command and Custom Action shortcuts are preserved.">
          <span>
            <Button
              variant="outlined"
              startIcon={<RestartAltIcon />}
              onClick={resetAllBuiltIns}
              aria-label="Restore built-in shortcuts to preset defaults"
              disabled={!hasBuiltInOverrides}
            >
              Restore preset defaults
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Tabs
        value={selectedGroup}
        onChange={(_, group: string) => { setSelectedGroup(group); setPage(0); }}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Keyboard shortcut groups"
        sx={settingsTabsSx}
      >
        {groupTabs.map(({ group, count }) => (
          <Tab
            key={group}
            value={group}
            icon={<SettingsIcon name={groupIcons[group] ?? "keyboard"} size={16} />}
            iconPosition="start"
            label={`${group} (${count})`}
          />
        ))}
      </Tabs>

      <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
        <Button onClick={() => setDraft(settings)} disabled={!dirty}>Cancel keyboard changes</Button>
        <Button
          variant="contained"
          onClick={() => onChange(draft)}
          disabled={!dirty || errors.length > 0}
        >
          Apply keyboard changes
        </Button>
      </Box>

      {diagnostics.length > 0 && (
        <Box
          data-testid="keyboard-attention"
          sx={{
            border: `1px solid var(${errors.length > 0 ? "--chip-error-border" : "--chip-warning-border"})`,
            borderRadius: 2,
            p: 1.25,
            backgroundColor: `var(${errors.length > 0 ? "--chip-error-bg" : "--chip-warning-bg"})`,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            <WarningAmberIcon sx={{ color: errors.length > 0 ? "error.main" : "warning.main", fontSize: 20 }} />
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>Keyboard attention</Typography>
            <Typography variant="caption" color="text.secondary">
              {errors.length} {errors.length === 1 ? "conflict" : "conflicts"}, {warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
            </Typography>
          </Box>
          <Stack spacing={0.75}>
            {diagnostics.map((diagnostic, index) => (
              <Box key={`${diagnostic.code}-${diagnostic.actionId}-${sequenceLabel(diagnostic.binding)}-${index}`} sx={{ display: "flex", alignItems: "flex-start", gap: 0.75 }}>
                <Chip size="small" color={diagnostic.severity === "error" ? "error" : "warning"} label={diagnostic.severity === "error" ? "Conflict" : "Warning"} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{diagnostic.message}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                    {diagnostic.actionId}{diagnostic.conflictingActionId ? ` ↔ ${diagnostic.conflictingActionId}` : ""}
                  </Typography>
                </Box>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
      {filteredActions.length > actionPageSize && (
        <TablePagination
          component="div"
          count={filteredActions.length}
          page={page}
          rowsPerPage={actionPageSize}
          rowsPerPageOptions={[]}
          onPageChange={(_, nextPage) => setPage(nextPage)}
          sx={{ borderTop: "1px solid var(--panel-border)" }}
        />
      )}

      {pageActions.length === 0 ? (
        <Alert severity="info">No keyboard actions match “{search}”.</Alert>
      ) : (
        <Box component="section" aria-label={`${selectedGroup} keyboard shortcuts`}>
          <Stack spacing={1} divider={<Divider flexItem />}>
            {pageActions.map((action) => {
              const overridden = hasOverride(draft, action.id);
              const disabled = overridden && action.bindings.length === 0;
              const dynamic = "typeLabel" in action;
              const definitionDisabled = dynamic && !action.enabled;
              const source = disabled
                ? "Disabled"
                : overridden
                  ? "Override"
                  : dynamic
                    ? "Unbound"
                    : "Preset";
              const rowDiagnostics = diagnosticsForAction(diagnostics, action.id);
              return (
                <Box
                  key={action.id}
                  data-testid={`keyboard-action-${action.id}`}
                  sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(220px, 0.8fr) minmax(260px, 1.2fr) auto" }, gap: 1.25, py: 1 }}
                >
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2">{action.label}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", fontFamily: "monospace" }}>
                      {action.id}
                    </Typography>
                    <Stack direction="row" spacing={0.5} useFlexGap sx={{ mt: 0.75, flexWrap: "wrap" }}>
                      <Chip size="small" variant="outlined" label={`Safety: ${action.safety}`} />
                      {dynamic && <Chip size="small" variant="outlined" label={action.typeLabel} />}
                      {definitionDisabled && <Chip size="small" variant="outlined" label="Definition disabled" />}
                      <Chip size="small" color={disabled ? "default" : overridden ? "info" : "success"} label={source} />
                    </Stack>
                  </Box>

                  <Box sx={{ minWidth: 0 }}>
                    {action.bindings.length > 0 ? (
                      <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap" }}>
                        {action.bindings.map((binding, index) => {
                          const label = sequenceLabel(binding);
                          return (
                            <Box key={`${label}-${index}`} sx={{ display: "inline-flex", alignItems: "center" }}>
                              <Chip variant="outlined" label={label} sx={{ fontFamily: "monospace" }} />
                              <IconButton
                                size="small"
                                onClick={() => setActionBindings(action.id, action.bindings.filter((_, bindingIndex) => bindingIndex !== index))}
                                aria-label={`Remove binding ${label} from ${action.label}`}
                              >
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          );
                        })}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">No bindings</Typography>
                    )}
                    {rowDiagnostics.length > 0 && (
                      <Stack spacing={0.5} sx={{ mt: 1 }}>
                        {rowDiagnostics.map((diagnostic, index) => (
                          <Alert key={`${diagnostic.code}-${sequenceLabel(diagnostic.binding)}-${index}`} severity={diagnostic.severity} sx={{ py: 0 }}>
                            {diagnostic.message}
                          </Alert>
                        ))}
                      </Stack>
                    )}
                  </Box>

                  <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap", alignContent: "flex-start" }}>
                    <Button size="small" startIcon={<AddIcon />} onClick={() => openRecorder(action.id)} aria-label={`Add binding for ${action.label}`}>
                      Add
                    </Button>
                    <Button size="small" onClick={() => setActionBindings(action.id, [])} aria-label={`Disable ${action.label}`} disabled={disabled}>
                      Disable
                    </Button>
                    <Button
                      size="small"
                      startIcon={<RestartAltIcon />}
                      onClick={() => resetAction(action.id)}
                      aria-label={`Reset ${action.label} to ${dynamic ? "unbound" : "preset"}`}
                      disabled={!overridden}
                    >
                      Reset
                    </Button>
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}

      <Dialog open={recordingActionId !== null} onClose={closeRecorder} maxWidth="sm" fullWidth>
        <DialogTitle>Record shortcut binding</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Press 1–4 key chords. Backspace removes the last chord, Enter saves, and Escape cancels.
          </Typography>
          <Box
            role="textbox"
            tabIndex={0}
            autoFocus
            aria-label="Record shortcut sequence"
            data-kview-ignore-shortcuts="true"
            onKeyDown={handleRecorderKeyDown}
            sx={{ minHeight: 88, p: 2, border: 1, borderColor: "divider", borderRadius: 1, outlineOffset: 2, display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <Typography sx={{ fontFamily: "monospace", fontWeight: 700 }}>
              {recordedSequence.length > 0 ? sequenceLabel(recordedSequence) : "Press a key chord…"}
            </Typography>
          </Box>
          {recorderError && <Alert severity="error" sx={{ mt: 1.5 }}>{recorderError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeRecorder}>Cancel</Button>
          <Button variant="contained" onClick={saveRecordedBinding} disabled={recordedSequence.length === 0}>Save binding</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
