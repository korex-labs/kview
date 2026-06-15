import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
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
import { buildShortcutHelpSections } from "./help";
import {
  eventToBinding,
  isKeyboardOwnedOverlayTarget,
  matchKeySequence,
  shouldIgnoreContextShortcut,
  shouldIgnoreGlobalShortcut,
} from "./keyboardUtils";
import { emitFocusActivityPanelTab, emitToggleActivityPanel } from "../activityEvents";
import {
  formatBinding,
  shortcutCommandsForSettings,
  type ShortcutCommand,
  type ShortcutCommandId,
} from "./shortcuts";
import ShortcutKey from "./ShortcutKey";

export type ContextualKeyboardAction = {
  id: string;
  label: string;
  binding: string[];
  run: () => boolean | void;
  disabled?: boolean;
};

export type KeyboardFocusScope = {
  id: string;
  label: string;
  kind: "app" | "drawer" | "dialog" | "settings" | "terminal";
  suppressGlobalShortcuts?: boolean;
  suppressContextShortcuts?: boolean;
  onEscape?: () => boolean | void;
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
  registerKeyboardScope: (scope: KeyboardFocusScope) => () => void;
  activeKeyboardScope: KeyboardFocusScope | null;
  keyboardSettings: KeyboardSettings;
};

const KeyboardContext = createContext<KeyboardContextValue>({
  registerTableControls: () => () => undefined,
  registerContextActions: () => () => undefined,
  registerKeyboardScope: () => () => undefined,
  activeKeyboardScope: null,
  keyboardSettings: {
    vimTableNavigation: true,
    homeRowTableNavigation: true,
    singleLetterGlobalSearch: true,
  },
});

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

function effectiveKeyboardScope(stack: KeyboardFocusScope[]): KeyboardFocusScope | null {
  return stack.length ? stack[stack.length - 1] : null;
}

export function useKeyboardControls() {
  return useContext(KeyboardContext);
}

type KeyboardProviderProps = {
  children: React.ReactNode;
  onFocusGlobalSearch: (initialQuery?: string) => void;
  onSelectSection: (section: Section) => void;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  keyboardSettings: KeyboardSettings;
};

const sequenceTimeoutMs = 900;

export default function KeyboardProvider({
  children,
  onFocusGlobalSearch,
  onSelectSection,
  onOpenSettings,
  settingsOpen,
  keyboardSettings,
}: KeyboardProviderProps) {
  const tableControlsRef = useRef<TableKeyboardControls | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [contextActionStack, setContextActionStack] = useState<ContextualKeyboardAction[][]>([]);
  const [keyboardScopeStack, setKeyboardScopeStack] = useState<KeyboardFocusScope[]>([]);
  const sequenceRef = useRef<string[]>([]);
  const sequenceTimerRef = useRef<number | null>(null);
  const contextActionStackRef = useRef<ContextualKeyboardAction[][]>([]);
  const keyboardScopeStackRef = useRef<KeyboardFocusScope[]>([]);
  const activeShortcutCommands = useMemo(() => shortcutCommandsForSettings(keyboardSettings), [keyboardSettings]);
  const activeKeyboardScope = useMemo(() => effectiveKeyboardScope(keyboardScopeStack), [keyboardScopeStack]);

  useEffect(() => {
    contextActionStackRef.current = contextActionStack;
  }, [contextActionStack]);
  useEffect(() => {
    keyboardScopeStackRef.current = keyboardScopeStack;
  }, [keyboardScopeStack]);

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
        onFocusGlobalSearch("");
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
        onFocusGlobalSearch(":");
        return true;
      case "activity.panel.toggle":
        emitToggleActivityPanel();
        return true;
      case "activity.panel.activities":
        emitFocusActivityPanelTab(0);
        return true;
      case "activity.panel.work":
        emitFocusActivityPanelTab(1);
        return true;
      case "activity.panel.terminals":
        emitFocusActivityPanelTab(2);
        return true;
      case "activity.panel.portForwards":
        emitFocusActivityPanelTab(3);
        return true;
      case "activity.panel.logs":
        emitFocusActivityPanelTab(4);
        return true;
      case "table.row.open":
        return tableControlsRef.current?.openSelectedRow() ?? false;
      case "nav.context":
        onFocusGlobalSearch("ctx ");
        return true;
      case "nav.settings":
        onOpenSettings();
        return true;
      default:
        return false;
    }
  }, [activeShortcutCommands, onFocusGlobalSearch, onOpenSettings, onSelectSection]);

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
        const activeScope = effectiveKeyboardScope(keyboardScopeStackRef.current);
        if (activeScope?.onEscape && !isKeyboardOwnedOverlayTarget(event.target)) {
          const handled = activeScope.onEscape();
          if (handled !== false) {
            event.preventDefault();
            event.stopPropagation();
          }
          clearSequence();
          return;
        }
        clearSequence();
      }
      if (helpOpen || settingsOpen) return;
      const activeScope = effectiveKeyboardScope(keyboardScopeStackRef.current);
      const contextActions = effectiveContextActions(contextActionStackRef.current);
      if (contextActions.length && !activeScope?.suppressContextShortcuts && !shouldIgnoreContextShortcut(event.target)) {
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
      if (activeScope?.suppressGlobalShortcuts) return;
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
  }, [activeShortcutCommands, clearSequence, helpOpen, runCommand, settingsOpen]);

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

  const registerKeyboardScope = useCallback((scope: KeyboardFocusScope) => {
    setKeyboardScopeStack((prev) => [...prev, scope]);
    return () => {
      setKeyboardScopeStack((prev) => {
        const index = prev.lastIndexOf(scope);
        if (index < 0) return prev;
        return [...prev.slice(0, index), ...prev.slice(index + 1)];
      });
    };
  }, []);

  const value = useMemo(
    () => ({
      registerTableControls,
      registerContextActions,
      registerKeyboardScope,
      activeKeyboardScope,
      keyboardSettings,
    }),
    [activeKeyboardScope, keyboardSettings, registerContextActions, registerKeyboardScope, registerTableControls],
  );

  return (
    <KeyboardContext.Provider value={value}>
      {children}
      <KeyboardHelpDialog
        open={helpOpen}
        commands={activeShortcutCommands}
        contextActions={effectiveContextActions(contextActionStack)}
        onClose={() => setHelpOpen(false)}
      />
    </KeyboardContext.Provider>
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
  const sectionEntries = useMemo(
    () => buildShortcutHelpSections(commands, contextActions),
    [commands, contextActions],
  );

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
                        <ShortcutKey key={binding.join("+")} label={formatBinding(binding)} />
                      ))}
                    </Box>
                    <ListItemText primary={row.label} slotProps={{ primary: { variant: "body2" } }} sx={{ my: 0 }} />
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
