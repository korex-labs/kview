import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import type { Section } from "../state";
import type { KeyboardSettings } from "../settings";
import { panelBoxSx } from "../theme/sxTokens";
import { buildCommandSuggestions, parseKeyboardCommand, type CommandSuggestion, type KeyboardCommandAction } from "./commands";
import { eventToBinding, isEditableElement, matchKeySequence, shouldIgnoreGlobalShortcut } from "./keyboardUtils";
import {
  formatBinding,
  shortcutCommandsForSettings,
  type ShortcutCommand,
  type ShortcutCommandId,
  type ShortcutGroup,
} from "./shortcuts";

export type ContextualKeyboardAction = {
  id: string;
  label: string;
  binding: string[];
  run: () => boolean | void;
  disabled?: boolean;
};

type TableKeyboardControls = {
  focusFilter: () => boolean;
  focusGrid: () => boolean;
  pagePrevious: () => boolean;
  pageNext: () => boolean;
  openSelectedRow: () => boolean;
};

type KeyboardContextValue = {
  registerTableControls: (controls: TableKeyboardControls) => () => void;
  registerContextActions: (actions: ContextualKeyboardAction[]) => () => void;
  keyboardSettings: KeyboardSettings;
};

const KeyboardContext = createContext<KeyboardContextValue>({
  registerTableControls: () => () => undefined,
  registerContextActions: () => () => undefined,
  keyboardSettings: {
    vimTableNavigation: true,
    homeRowTableNavigation: true,
    singleLetterGlobalSearch: true,
  },
});

function shouldIgnoreContextShortcut(target: EventTarget | null): boolean {
  if (isEditableElement(target)) return true;
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest([
    ".MuiAutocomplete-popper",
    ".MuiMenu-root",
    ".MuiPopover-root",
    ".MuiDialog-root",
    ".xterm",
    "[role='dialog']",
    "[role='menu']",
    "[role='listbox']",
  ].join(","));
}

function effectiveContextActions(stack: ContextualKeyboardAction[][]): ContextualKeyboardAction[] {
  const seenBindings = new Set<string>();
  const actions: ContextualKeyboardAction[] = [];
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    for (const action of stack[i]) {
      const bindingKey = action.binding.join(" ");
      if (seenBindings.has(bindingKey)) continue;
      seenBindings.add(bindingKey);
      actions.push(action);
    }
  }
  return actions;
}

export function useKeyboardControls() {
  return useContext(KeyboardContext);
}

type KeyboardProviderProps = {
  children: React.ReactNode;
  namespaces: string[];
  contexts: string[];
  onFocusGlobalSearch: () => void;
  onSelectSection: (section: Section) => void;
  onSelectNamespace: (namespace: string) => void;
  onSelectContext: (context: string) => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  keyboardSettings: KeyboardSettings;
};

const sequenceTimeoutMs = 900;

export default function KeyboardProvider({
  children,
  namespaces,
  contexts,
  onFocusGlobalSearch,
  onSelectSection,
  onSelectNamespace,
  onSelectContext,
  onOpenSettings,
  settingsOpen,
  keyboardSettings,
}: KeyboardProviderProps) {
  const tableControlsRef = useRef<TableKeyboardControls | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandInitialQuery, setCommandInitialQuery] = useState("");
  const [contextActionStack, setContextActionStack] = useState<ContextualKeyboardAction[][]>([]);
  const sequenceRef = useRef<string[]>([]);
  const sequenceTimerRef = useRef<number | null>(null);
  const contextActionStackRef = useRef<ContextualKeyboardAction[][]>([]);
  const activeShortcutCommands = useMemo(() => shortcutCommandsForSettings(keyboardSettings), [keyboardSettings]);

  useEffect(() => {
    contextActionStackRef.current = contextActionStack;
  }, [contextActionStack]);

  const closeCommand = useCallback(() => {
    setCommandOpen(false);
    setCommandInitialQuery("");
  }, []);

  const openCommand = useCallback((initialQuery = "") => {
    setCommandInitialQuery(initialQuery);
    setCommandOpen(true);
  }, []);

  const runAction = useCallback((action: KeyboardCommandAction) => {
    if (action.type === "section") {
      onSelectSection(action.section);
      return;
    }
    if (action.type === "namespace") {
      onSelectNamespace(action.namespace);
      return;
    }
    if (action.type === "context") {
      onSelectContext(action.context);
      return;
    }
    onOpenSettings();
  }, [onOpenSettings, onSelectContext, onSelectNamespace, onSelectSection]);

  const runCommand = useCallback((command: ShortcutCommandId) => {
    const nav = activeShortcutCommands.find((item) => item.id === command);
    if (nav?.section) {
      onSelectSection(nav.section);
      return true;
    }
    switch (command) {
      case "help.open":
        setHelpOpen(true);
        return true;
      case "search.focus":
        onFocusGlobalSearch();
        return true;
      case "table.filter.focus":
        return tableControlsRef.current?.focusFilter() ?? false;
      case "table.grid.focus":
        return tableControlsRef.current?.focusGrid() ?? false;
      case "table.page.previous":
        return tableControlsRef.current?.pagePrevious() ?? false;
      case "table.page.next":
        return tableControlsRef.current?.pageNext() ?? false;
      case "command.open":
        openCommand();
        return true;
      case "table.row.open":
        return tableControlsRef.current?.openSelectedRow() ?? false;
      case "nav.context":
        openCommand("ctx ");
        return true;
      case "nav.settings":
        onOpenSettings();
        return true;
      default:
        return false;
    }
  }, [activeShortcutCommands, onFocusGlobalSearch, onOpenSettings, onSelectSection, openCommand]);

  const clearSequence = useCallback(() => {
    sequenceRef.current = [];
    if (sequenceTimerRef.current !== null) {
      window.clearTimeout(sequenceTimerRef.current);
      sequenceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (helpOpen) {
          event.preventDefault();
          setHelpOpen(false);
          clearSequence();
          return;
        }
        clearSequence();
      }
      if (commandOpen || helpOpen || settingsOpen) return;
      const contextActions = effectiveContextActions(contextActionStackRef.current);
      if (contextActions.length && !shouldIgnoreContextShortcut(event.target)) {
        const key = eventToBinding(event);
        const action = contextActions.find((item) => !item.disabled && matchKeySequence(item.binding, [key]) === "matched");
        if (action) {
          const handled = action.run();
          if (handled !== false) {
            event.preventDefault();
            event.stopPropagation();
          }
          clearSequence();
          return;
        }
        if (key === "?") {
          event.preventDefault();
          event.stopPropagation();
          setHelpOpen(true);
          clearSequence();
          return;
        }
      }
      if (shouldIgnoreGlobalShortcut(event.target)) return;

      const key = eventToBinding(event);
      const pressed = [...sequenceRef.current, key];
      const exact = activeShortcutCommands.find((command) => command.bindings.some((binding) => matchKeySequence(binding, pressed) === "matched"));
      if (exact) {
        const handled = runCommand(exact.id);
        if (handled) event.preventDefault();
        clearSequence();
        return;
      }

      const partial = activeShortcutCommands.some((command) => command.bindings.some((binding) => matchKeySequence(binding, pressed) === "partial"));
      if (partial) {
        event.preventDefault();
        sequenceRef.current = pressed;
        if (sequenceTimerRef.current !== null) window.clearTimeout(sequenceTimerRef.current);
        sequenceTimerRef.current = window.setTimeout(clearSequence, sequenceTimeoutMs);
        return;
      }

      clearSequence();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearSequence();
    };
  }, [activeShortcutCommands, clearSequence, commandOpen, helpOpen, runCommand, settingsOpen]);

  const registerTableControls = useCallback((controls: TableKeyboardControls) => {
    tableControlsRef.current = controls;
    return () => {
      if (tableControlsRef.current === controls) tableControlsRef.current = null;
    };
  }, []);

  const registerContextActions = useCallback((actions: ContextualKeyboardAction[]) => {
    setContextActionStack((prev) => [...prev, actions]);
    return () => {
      setContextActionStack((prev) => {
        const index = prev.lastIndexOf(actions);
        if (index < 0) return prev;
        return [...prev.slice(0, index), ...prev.slice(index + 1)];
      });
    };
  }, []);

  const value = useMemo(
    () => ({ registerTableControls, registerContextActions, keyboardSettings }),
    [keyboardSettings, registerContextActions, registerTableControls],
  );

  return (
    <KeyboardContext.Provider value={value}>
      {children}
      <KeyboardCommandPalette
        open={commandOpen}
        initialQuery={commandInitialQuery}
        namespaces={namespaces}
        contexts={contexts}
        onClose={closeCommand}
        onRun={(action) => {
          runAction(action);
          closeCommand();
        }}
      />
      <KeyboardHelpDialog
        open={helpOpen}
        commands={activeShortcutCommands}
        contextActions={effectiveContextActions(contextActionStack)}
        onClose={() => setHelpOpen(false)}
      />
    </KeyboardContext.Provider>
  );
}

function KeyboardCommandPalette({
  open,
  initialQuery,
  namespaces,
  contexts,
  onClose,
  onRun,
}: {
  open: boolean;
  initialQuery: string;
  namespaces: string[];
  contexts: string[];
  onClose: () => void;
  onRun: (action: KeyboardCommandAction) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const suggestions = useMemo(
    () => buildCommandSuggestions({ query, namespaces, contexts }),
    [contexts, namespaces, query],
  );
  const groupedSuggestions = useMemo(() => {
    const groups: Array<{ category: CommandSuggestion["category"]; options: CommandSuggestion[] }> = [];
    for (const suggestion of suggestions) {
      let group = groups.find((item) => item.category === suggestion.category);
      if (!group) {
        group = { category: suggestion.category, options: [] };
        groups.push(group);
      }
      group.options.push(suggestion);
    }
    return groups;
  }, [suggestions]);

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [initialQuery, open]);

  const runQuery = useCallback((value: string) => {
    const action = parseKeyboardCommand(value, namespaces, contexts);
    if (action) onRun(action);
  }, [contexts, namespaces, onRun]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{ sx: { mt: 10, alignSelf: "flex-start" } }}
    >
      <DialogTitle sx={{ pb: 1 }}>Command</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <Autocomplete<CommandSuggestion, false, false, true>
          freeSolo
          autoHighlight
          openOnFocus
          options={suggestions}
          groupBy={(option) => option.category}
          inputValue={query}
          getOptionLabel={(option) => typeof option === "string" ? option : option.value}
          filterOptions={(options) => options}
          onInputChange={(_, value) => setQuery(value)}
          onChange={(_, value) => {
            if (!value) return;
            if (typeof value === "string") runQuery(value);
            else onRun(value.action);
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              autoFocus
              placeholder=":pods, :ns kube-system, :ctx minikube"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  onClose();
                }
              }}
            />
          )}
          renderOption={(props, option) => (
            <li {...props} key={option.value}>
              <Box sx={{ minWidth: 0, width: "100%" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontFamily: "monospace", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {option.value}
                  </Typography>
                  {option.aliases?.slice(0, 3).map((alias) => (
                    <Chip
                      key={alias}
                      size="small"
                      variant="outlined"
                      label={alias}
                      sx={{
                        height: 20,
                        borderRadius: 1,
                        fontFamily: "monospace",
                        fontSize: "0.68rem",
                        "& .MuiChip-label": { px: 0.65 },
                      }}
                    />
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary">{option.description}</Typography>
              </Box>
            </li>
          )}
          renderGroup={(params) => {
            const group = groupedSuggestions.find((item) => item.category === params.group);
            return (
              <Box component="li" key={params.key}>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block", px: 2, pt: 1, lineHeight: 1.4 }}>
                  {params.group}{group ? ` (${group.options.length})` : ""}
                </Typography>
                <Box component="ul" sx={{ p: 0 }}>{params.children}</Box>
              </Box>
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function KeyboardHelpDialog({
  open,
  commands,
  contextActions,
  onClose,
}: {
  open: boolean;
  commands: ShortcutCommand[];
  contextActions: ContextualKeyboardAction[];
  onClose: () => void;
}) {
  const grouped = useMemo(() => {
    const groups: Record<ShortcutGroup, ShortcutCommand[]> = {
      Global: [],
      Navigation: [],
      Table: [],
      "Command Mode": [],
    };
    for (const command of commands) groups[command.group].push(command);
    return groups;
  }, [commands]);
  const sectionEntries = useMemo(() => {
    const entries: Array<{ title: string; rows: Array<{ id: string; label: string; bindings: string[][]; disabled?: boolean }> }> =
      (Object.keys(grouped) as ShortcutGroup[]).map((group) => ({
        title: group,
        rows: grouped[group].map((command) => ({
          id: command.id,
          label: command.label,
          bindings: command.bindings,
        })),
      }));
    if (contextActions.length) {
      entries.push({
        title: "Current Resource",
        rows: contextActions.map((action) => ({
          id: action.id,
          label: action.label,
          bindings: [action.binding],
          disabled: action.disabled,
        })),
      });
    }
    return entries;
  }, [contextActions, grouped]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pb: 1 }}>Keyboard shortcuts</DialogTitle>
      <Divider />
      <DialogContent sx={{ p: 2 }}>
        <Box sx={{ columnCount: { xs: 1, md: 2, xl: 3 }, columnGap: 2 }}>
          {sectionEntries.map((section) => (
            <Box key={section.title} sx={{ ...panelBoxSx, mb: 2, breakInside: "avoid", display: "inline-block", width: "100%" }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                {section.title}
              </Typography>
              <Divider sx={{ mt: 0.75, mb: 1 }} />
              <List dense disablePadding>
                {section.rows.map((row) => (
                  <ListItem
                    key={row.id}
                    disableGutters
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "minmax(180px, 0.72fr) minmax(0, 1fr)",
                      columnGap: 1.5,
                      alignItems: "center",
                      py: 0.45,
                      opacity: row.disabled ? 0.55 : 1,
                    }}
                  >
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, minWidth: 0 }}>
                      {row.bindings.map((binding) => (
                        <Chip
                          key={binding.join("+")}
                          component="kbd"
                          size="small"
                          variant="outlined"
                          label={formatBinding(binding)}
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
                    <ListItemText primary={row.label} primaryTypographyProps={{ variant: "body2" }} sx={{ my: 0 }} />
                  </ListItem>
                ))}
              </List>
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
