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
import { defaultKeyboardSettings, type KeyboardSettings } from "../settings";
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
import { actionDefinitionById, type KeyboardActionHandlers, type KeySequence } from "./actions";
import { compileKeymap } from "./keymaps";
import ShortcutKey from "./ShortcutKey";

export type ContextualKeyboardAction = {
  id: string;
  label: string;
  /** Fallback for unregistered callers. Built-in action IDs use compiled bindings. */
  binding?: KeySequence;
  /** Multiple fallback bindings for unregistered callers. */
  bindings?: KeySequence[];
  run: () => boolean | void;
  disabled?: boolean;
  /** Higher-priority owners win duplicate IDs/bindings regardless of registration timing. */
  priority?: number;
};

export type KeyboardFocusScope = {
  id: string;
  label: string;
  kind: "app" | "drawer" | "dialog" | "settings" | "terminal";
  suppressGlobalShortcuts?: boolean;
  suppressContextShortcuts?: boolean;
  onEscape?: (event: KeyboardEvent) => boolean | void;
};

export type TableKeyboardControls = {
  focusFilter: () => boolean;
  focusGrid: () => boolean;
  pagePrevious: () => boolean;
  pageNext: () => boolean;
  openSelectedRow: () => boolean;
};

export type KeyboardFocusRequest = {
  id: string;
  focus: () => boolean | void;
};

type KeyboardContextValue = {
  registerTableControls: (controls: TableKeyboardControls) => () => void;
  registerContextActions: (actions: ContextualKeyboardAction[]) => () => void;
  registerKeyboardScope: (scope: KeyboardFocusScope) => () => void;
  requestKeyboardFocus: (request: KeyboardFocusRequest) => void;
  activeKeyboardScope: KeyboardFocusScope | null;
  keyboardSettings: KeyboardSettings;
};

const KeyboardContext = createContext<KeyboardContextValue>({
  registerTableControls: () => () => undefined,
  registerContextActions: () => () => undefined,
  registerKeyboardScope: () => () => undefined,
  requestKeyboardFocus: () => undefined,
  activeKeyboardScope: null,
  keyboardSettings: defaultKeyboardSettings(),
});
const ContextualKeyboardSurfaceActiveContext = createContext(true);

export function ContextualKeyboardSurface({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <ContextualKeyboardSurfaceActiveContext.Provider value={active}>
      {children}
    </ContextualKeyboardSurfaceActiveContext.Provider>
  );
}

export function useContextualKeyboardSurfaceActive() {
  return useContext(ContextualKeyboardSurfaceActiveContext);
}

type EffectiveContextualKeyboardAction = ContextualKeyboardAction & { bindings: KeySequence[] };

function effectiveContextActions(
  stack: ContextualKeyboardAction[][],
  compiledBindings: ReadonlyMap<string, KeySequence[]>,
): EffectiveContextualKeyboardAction[] {
  const seenBindings = new Set<string>();
  const seenActionIds = new Set<string>();
  const actions: EffectiveContextualKeyboardAction[] = [];
  const candidates = stack.flatMap((group, stackIndex) => group.map((action, actionIndex) => ({
    action,
    stackIndex,
    actionIndex,
  }))).sort((left, right) =>
    (right.action.priority ?? 0) - (left.action.priority ?? 0)
    || right.stackIndex - left.stackIndex
    || left.actionIndex - right.actionIndex);
  for (const { action } of candidates) {
    if (seenActionIds.has(action.id)) continue;
    seenActionIds.add(action.id);
    const definition = actionDefinitionById.get(action.id as never);
    const bindings = definition
      ? (compiledBindings.get(action.id) ?? [])
      : (action.bindings ?? (action.binding ? [action.binding] : []));
    const availableBindings = bindings.filter((binding) => {
      const bindingKey = binding.join(" ");
      if (seenBindings.has(bindingKey)) return false;
      seenBindings.add(bindingKey);
      return true;
    });
    actions.push({ ...action, bindings: availableBindings, disabled: action.disabled || availableBindings.length === 0 });
  }
  return actions;
}

function effectiveKeyboardScope(stack: KeyboardFocusScope[]): KeyboardFocusScope | null {
  return stack.length ? stack[stack.length - 1] : null;
}

function effectiveEscapeScope(stack: KeyboardFocusScope[]): KeyboardFocusScope | null {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].onEscape) return stack[index];
  }
  return null;
}

export function useKeyboardControls() {
  return useContext(KeyboardContext);
}

export function useKeyboardScope(scope: KeyboardFocusScope | null | undefined) {
  const { registerKeyboardScope } = useKeyboardControls();
  useEffect(() => {
    if (!scope) return undefined;
    return registerKeyboardScope(scope);
  }, [registerKeyboardScope, scope]);
}

export function useContextualKeyboardActions(actions: ContextualKeyboardAction[] | null | undefined) {
  const { registerContextActions } = useKeyboardControls();
  const surfaceActive = useContext(ContextualKeyboardSurfaceActiveContext);
  useEffect(() => {
    if (!surfaceActive || !actions?.length) return undefined;
    return registerContextActions(actions);
  }, [actions, registerContextActions, surfaceActive]);
}

export function useTableKeyboardControls(controls: TableKeyboardControls | null | undefined) {
  const { registerTableControls } = useKeyboardControls();
  useEffect(() => {
    if (!controls) return undefined;
    return registerTableControls(controls);
  }, [controls, registerTableControls]);
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
  const compiledContextBindings = useMemo(() => new Map(
    compileKeymap(keyboardSettings.preset, keyboardSettings.overrides).map((action) => [action.id, action.bindings]),
  ), [keyboardSettings]);
  const activeKeyboardScope = useMemo(() => effectiveKeyboardScope(keyboardScopeStack), [keyboardScopeStack]);

  useEffect(() => {
    contextActionStackRef.current = contextActionStack;
  }, [contextActionStack]);
  useEffect(() => {
    keyboardScopeStackRef.current = keyboardScopeStack;
  }, [keyboardScopeStack]);

  const actionHandlers = useMemo<KeyboardActionHandlers>(() => {
    const handlers: KeyboardActionHandlers = {
      "help.open": () => { setHelpOpen(true); return true; },
      "search.focus": () => { onFocusGlobalSearch(""); return true; },
      "table.filter.focus": () => tableControlsRef.current?.focusFilter() ?? false,
      "table.grid.focus": () => tableControlsRef.current?.focusGrid() ?? false,
      "table.page.previous": () => tableControlsRef.current?.pagePrevious() ?? false,
      "table.page.next": () => tableControlsRef.current?.pageNext() ?? false,
      "table.row.open": () => tableControlsRef.current?.openSelectedRow() ?? false,
      "command.open": () => { onFocusGlobalSearch(":"); return true; },
      "activity.panel.toggle": () => { emitToggleActivityPanel(); return true; },
      "activity.panel.activities": () => { emitFocusActivityPanelTab(0); return true; },
      "activity.panel.work": () => { emitFocusActivityPanelTab(1); return true; },
      "activity.panel.terminals": () => { emitFocusActivityPanelTab(2); return true; },
      "activity.panel.portForwards": () => { emitFocusActivityPanelTab(3); return true; },
      "activity.panel.logs": () => { emitFocusActivityPanelTab(4); return true; },
      "nav.context": () => { onFocusGlobalSearch("ctx "); return true; },
      "nav.settings": () => { onOpenSettings(); return true; },
    };
    for (const command of activeShortcutCommands) {
      if (command.section) handlers[command.id] = () => { onSelectSection(command.section!); return true; };
    }
    return handlers;
  }, [activeShortcutCommands, onFocusGlobalSearch, onOpenSettings, onSelectSection]);

  const runCommand = useCallback((command: ShortcutCommandId) => actionHandlers[command]?.() ?? false, [actionHandlers]);
  const activeDispatchCommands = useMemo(
    () => activeShortcutCommands.filter((command) => Boolean(actionHandlers[command.id])),
    [actionHandlers, activeShortcutCommands],
  );

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
        const escapeScope = effectiveEscapeScope(keyboardScopeStackRef.current);
        if (escapeScope?.onEscape && !isKeyboardOwnedOverlayTarget(event.target)) {
          const handled = escapeScope.onEscape(event);
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
      const key = eventToBinding(event);
      const contextActions = effectiveContextActions(contextActionStackRef.current, compiledContextBindings);
      const contextualSurfaceActive = activeScope?.kind === "drawer" && !activeScope.suppressContextShortcuts;
      if (contextActions.length && contextualSurfaceActive && !shouldIgnoreContextShortcut(event.target)) {
        const pressed = [...sequenceRef.current, key];
        const action = contextActions.find((item) => !item.disabled && item.bindings.some((binding) => matchKeySequence(binding, pressed) === "matched"));
        if (action) {
          const handled = action.run();
          if (handled !== false) {
            event.preventDefault();
            event.stopPropagation();
          }
          clearSequence();
          return;
        }
        const partial = contextActions.some((item) => !item.disabled && item.bindings.some((binding) => matchKeySequence(binding, pressed) === "partial"));
        if (partial) {
          event.preventDefault();
          sequenceRef.current = pressed;
          if (sequenceTimerRef.current !== null) window.clearTimeout(sequenceTimerRef.current);
          sequenceTimerRef.current = window.setTimeout(clearSequence, sequenceTimeoutMs);
          return;
        }
        if (sequenceRef.current.length) {
          clearSequence();
          return;
        }
      }
      const allowScopedHelp = Boolean(
        activeScope?.suppressGlobalShortcuts && !shouldIgnoreContextShortcut(event.target),
      );
      if (shouldIgnoreGlobalShortcut(event.target) && !allowScopedHelp) return;

      const pressed = [...sequenceRef.current, key];
      const commandsForScope = activeScope?.suppressGlobalShortcuts
        ? activeDispatchCommands.filter((command) => command.id === "help.open")
        : activeDispatchCommands;
      const exact = commandsForScope.find((command) => command.bindings.some((binding) => matchKeySequence(binding, pressed) === "matched"));
      if (exact) {
        const handled = runCommand(exact.id);
        if (handled) event.preventDefault();
        clearSequence();
        return;
      }

      const partial = commandsForScope.some((command) => command.bindings.some((binding) => matchKeySequence(binding, pressed) === "partial"));
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
  }, [activeDispatchCommands, clearSequence, compiledContextBindings, helpOpen, runCommand, settingsOpen]);

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

  const requestKeyboardFocus = useCallback((request: KeyboardFocusRequest) => {
    const run = () => request.focus();
    if (run() !== false) return;
    window.requestAnimationFrame(() => {
      if (run() !== false) return;
      window.setTimeout(() => {
        if (run() !== false) return;
        window.setTimeout(run, 50);
      }, 0);
    });
  }, []);

  const value = useMemo(
    () => ({
      registerTableControls,
      registerContextActions,
      registerKeyboardScope,
      requestKeyboardFocus,
      activeKeyboardScope,
      keyboardSettings,
    }),
    [activeKeyboardScope, keyboardSettings, registerContextActions, registerKeyboardScope, registerTableControls, requestKeyboardFocus],
  );

  return (
    <KeyboardContext.Provider value={value}>
      {children}
      <KeyboardHelpDialog
        open={helpOpen}
        commands={activeShortcutCommands}
        contextActions={activeKeyboardScope?.kind === "drawer"
          ? effectiveContextActions(contextActionStack, compiledContextBindings)
          : []}
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
  contextActions: EffectiveContextualKeyboardAction[];
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
