import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from "@mui/material";
import type { Section } from "../state";
import { buildCommandSuggestions, parseKeyboardCommand, type CommandSuggestion, type KeyboardCommandAction } from "./commands";
import { eventToBinding, matchKeySequence, shouldIgnoreGlobalShortcut } from "./keyboardUtils";
import { formatBinding, shortcutCommands, type ShortcutCommand, type ShortcutCommandId, type ShortcutGroup } from "./shortcuts";

type TableKeyboardControls = {
  focusFilter: () => boolean;
  focusGrid: () => boolean;
  pagePrevious: () => boolean;
  pageNext: () => boolean;
  openSelectedRow: () => boolean;
};

type KeyboardContextValue = {
  registerTableControls: (controls: TableKeyboardControls) => () => void;
};

const KeyboardContext = createContext<KeyboardContextValue>({
  registerTableControls: () => () => undefined,
});

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
}: KeyboardProviderProps) {
  const tableControlsRef = useRef<TableKeyboardControls | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandInitialQuery, setCommandInitialQuery] = useState("");
  const sequenceRef = useRef<string[]>([]);
  const sequenceTimerRef = useRef<number | null>(null);

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
    const nav = shortcutCommands.find((item) => item.id === command);
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
  }, [onFocusGlobalSearch, onOpenSettings, onSelectSection, openCommand]);

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
      if (shouldIgnoreGlobalShortcut(event.target)) return;

      const key = eventToBinding(event);
      const pressed = [...sequenceRef.current, key];
      const exact = shortcutCommands.find((command) => command.bindings.some((binding) => matchKeySequence(binding, pressed) === "matched"));
      if (exact) {
        const handled = runCommand(exact.id);
        if (handled) event.preventDefault();
        clearSequence();
        return;
      }

      const partial = shortcutCommands.some((command) => command.bindings.some((binding) => matchKeySequence(binding, pressed) === "partial"));
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
  }, [clearSequence, commandOpen, helpOpen, runCommand, settingsOpen]);

  const registerTableControls = useCallback((controls: TableKeyboardControls) => {
    tableControlsRef.current = controls;
    return () => {
      if (tableControlsRef.current === controls) tableControlsRef.current = null;
    };
  }, []);

  const value = useMemo(() => ({ registerTableControls }), [registerTableControls]);

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
      <KeyboardHelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
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
              <Box>
                <Typography variant="body2">{option.value}</Typography>
                <Typography variant="caption" color="text.secondary">{option.description}</Typography>
              </Box>
            </li>
          )}
        />
      </DialogContent>
    </Dialog>
  );
}

function KeyboardHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const grouped = useMemo(() => {
    const groups: Record<ShortcutGroup, ShortcutCommand[]> = {
      Global: [],
      Navigation: [],
      Table: [],
      "Command Mode": [],
    };
    for (const command of shortcutCommands) groups[command.group].push(command);
    return groups;
  }, []);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Keyboard shortcuts</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
          {(Object.keys(grouped) as ShortcutGroup[]).map((group) => (
            <Box key={group}>
              <Typography variant="subtitle2" sx={{ mb: 0.75 }}>{group}</Typography>
              <List dense disablePadding>
                {grouped[group].map((command) => (
                  <ListItem
                    key={command.id}
                    disableGutters
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "minmax(150px, 0.58fr) minmax(0, 1fr)",
                      columnGap: 2,
                      alignItems: "baseline",
                    }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography component="kbd" variant="caption" sx={{ fontFamily: "monospace" }}>
                        {command.bindings.map(formatBinding).join(" / ")}
                      </Typography>
                    </Box>
                    <ListItemText primary={command.label} primaryTypographyProps={{ variant: "body2" }} />
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
