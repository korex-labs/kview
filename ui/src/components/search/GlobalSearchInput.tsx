import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import type { PaperProps } from "@mui/material/Paper";
import { apiGetWithContext } from "../../api";
import type { Section } from "../../state";
import type { ApiDataplaneSearchItem, ApiDataplaneSearchResponse } from "../../types/api";
import { buildCommandSuggestions, parseKeyboardCommand, type CommandSuggestion, type KeyboardCommandAction } from "../../keyboard/commands";
import { useKeyboardControls } from "../../keyboard/KeyboardProvider";
import { getResourceLabel, type ListResourceKey } from "../../utils/k8sResources";
import {
  listInvestigationSnapshots,
  searchInvestigationSnapshots,
  type InvestigationSnapshotSearchItem,
} from "../../investigationSnapshots";

import { parseSearchFilters, tokenizeSearchDraft } from "./searchQuery";
import { searchResultMapIdentity } from "./searchNavigation";

const searchLimit = 10;
const searchDebounceMs = 350;

export type GlobalSearchFocusRequest = {
  nonce: number;
  query: string;
};

type PaletteSuggestion =
  | { kind: "cached-resource"; key: string; item: ApiDataplaneSearchItem }
  | { kind: "resource-map"; key: string; item: ApiDataplaneSearchItem }
  | { kind: "investigation-snapshot"; key: string; item: InvestigationSnapshotSearchItem }
  | { kind: "command"; key: string; suggestion: CommandSuggestion };

type Props = {
  token: string;
  activeContext: string;
  activeNamespace?: string;
  activeScope?: "namespaced" | "cluster";
  disabled?: boolean;
  focusRequest?: GlobalSearchFocusRequest;
  namespaces: string[];
  contexts: string[];
  onSelectSection: (section: Section) => void;
  onSelectNamespace: (namespace: string) => void;
  onSelectContext: (context: string) => void;
  onOpenResource: (item: ApiDataplaneSearchItem) => void;
  onOpenResourceMap?: (item: ApiDataplaneSearchItem) => void;
  onOpenSettings: () => void;
};

function isCommandQuery(value: string): boolean {
  return /^[\s]*[:>]/.test(value);
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "AbortError";
}

function resourceSuggestionKey(item: ApiDataplaneSearchItem): string {
  return ["cached-resource", item.cluster, item.kind, item.namespace || "", item.name].join("\x00");
}

function snapshotSuggestionKey(item: InvestigationSnapshotSearchItem): string {
  const snapshot = item.snapshot;
  return ["investigation-snapshot", snapshot.context || "", snapshot.id || snapshot.createdAt || "", snapshot.primaryResource?.kind || "", snapshot.primaryResource?.namespace || "", snapshot.primaryResource?.name || ""].join("\x00");
}

function snapshotResourceItem(item: InvestigationSnapshotSearchItem): ApiDataplaneSearchItem {
  const snapshot = item.snapshot;
  const ref = snapshot.primaryResource;
  return {
    cluster: snapshot.context || "local",
    kind: ref.kind,
    namespace: ref.namespace,
    name: ref.name,
    signalSeverity: snapshot.signal?.severity,
    signalCount: 1,
    needsAttention: snapshot.triageState !== "resolved" && snapshot.triageState !== "ignored",
    matchReason: item.matchReason,
  };
}

function labelForSearchKind(kind: string): string {
  if (kind === "helmreleases") return "Helm Releases";
  return getResourceLabel(kind as ListResourceKey);
}

function resourceSuggestionDescription(item: ApiDataplaneSearchItem): string {
  const scope = item.namespace ? `${item.cluster} / ${item.namespace}` : item.cluster;
  return `${labelForSearchKind(item.kind)} · ${scope || "cached dataplane"}`;
}

function paletteSuggestionCategory(option: PaletteSuggestion): string {
  if (option.kind === "cached-resource" || option.kind === "resource-map") return "Cached Resources";
  if (option.kind === "investigation-snapshot") return "Investigation Snapshots";
  return option.suggestion.category;
}

function optionToAction(option: PaletteSuggestion): KeyboardCommandAction {
  if (option.kind === "cached-resource" || option.kind === "resource-map") return { type: "resource", item: option.item };
  if (option.kind === "investigation-snapshot") return { type: "resource", item: snapshotResourceItem(option.item) };
  return option.suggestion.action;
}

export default function GlobalSearchInput({
  token,
  activeContext,
  activeNamespace = "",
  activeScope = "cluster",
  disabled = false,
  focusRequest,
  namespaces,
  contexts,
  onSelectSection,
  onSelectNamespace,
  onSelectContext,
  onOpenResource,
  onOpenResourceMap,
  onOpenSettings,
}: Props) {
  const { requestKeyboardFocus } = useKeyboardControls();
  const [draft, setDraft] = useState("");
  const [chips, setChips] = useState<string[]>([]);
  const query = [...chips, draft].join(" ");
  const setQuery = useCallback((value: string) => { setChips([]); setDraft(value); }, []);
  const commitDraft = (value: string, complete = false) => {
    const next = tokenizeSearchDraft(value, complete);
    setChips((previous) => [...previous, ...next.tokens]);
    setDraft(next.draft);
  };
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (disabled || !activeContext) setOpen(false);
  }, [disabled, activeContext]);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const commandSuggestions = useMemo(
    () => buildCommandSuggestions({ query, namespaces, contexts }),
    [contexts, namespaces, query],
  );
  const {
    items: resourceItems,
    loading,
    error,
    hasMore,
    loadMore,
    retryFailed,
  } = useDataplaneSearch({
    open,
    query,
    token,
    activeContext,
    activeNamespace,
    activeScope,
    disabled: disabled || isCommandQuery(query),
  });
  const snapshotItems = useInvestigationSnapshotSearch({
    open,
    query,
    token,
    activeContext,
    activeNamespace,
    activeScope,
    disabled: disabled || isCommandQuery(query),
  });

  useEffect(() => {
    if (!focusRequest?.nonce || disabled || !activeContext) return;
    setQuery(focusRequest.query);
    setOpen(true);
    requestKeyboardFocus({
      id: "global-search.input",
      focus: () => {
      const input = rootRef.current?.querySelector<HTMLInputElement>("input");
      input?.focus();
      input?.setSelectionRange(focusRequest.query.length, focusRequest.query.length);
        return document.activeElement === input;
      },
    });
  }, [activeContext, disabled, focusRequest, requestKeyboardFocus, setQuery]);

  const suggestions = useMemo<PaletteSuggestion[]>(() => {
    const resourceSuggestions: PaletteSuggestion[] = resourceItems.flatMap((item) => {
      const detail: PaletteSuggestion = { kind: "cached-resource", key: resourceSuggestionKey(item), item };
      return onOpenResourceMap && searchResultMapIdentity(item)
        ? [detail, { kind: "resource-map" as const, key: `map:${detail.key}`, item }]
        : [detail];
    });
    const snapshotSuggestions = snapshotItems.map((item) => ({
      kind: "investigation-snapshot" as const,
      key: snapshotSuggestionKey(item),
      item,
    }));
    const commandOptions = commandSuggestions.map((suggestion) => ({
      kind: "command" as const,
      key: suggestion.value,
      suggestion,
    }));
    if (isCommandQuery(query)) return commandOptions;
    return [...resourceSuggestions, ...snapshotSuggestions, ...commandOptions];
  }, [commandSuggestions, onOpenResourceMap, query, resourceItems, snapshotItems]);

  const openMap = (item: ApiDataplaneSearchItem) => {
    // Resolve against this render's identity-bound results, not a retained item.
    const current = resourceItems.find((candidate) => candidate === item);
    if (disabled || !activeContext || !current || !searchResultMapIdentity(current)) return;
    onOpenResourceMap?.(current);
    setQuery("");
    setOpen(false);
  };

  const groupedSuggestions = useMemo(() => {
    const groups: Array<{ category: string; options: PaletteSuggestion[] }> = [];
    for (const suggestion of suggestions) {
      const category = paletteSuggestionCategory(suggestion);
      let group = groups.find((item) => item.category === category);
      if (!group) {
        group = { category, options: [] };
        groups.push(group);
      }
      group.options.push(suggestion);
    }
    return groups;
  }, [suggestions]);

  const runAction = useCallback((action: KeyboardCommandAction) => {
    if (action.type === "section") onSelectSection(action.section);
    else if (action.type === "namespace") onSelectNamespace(action.namespace);
    else if (action.type === "context") onSelectContext(action.context);
    else if (action.type === "resource") onOpenResource(action.item);
    else onOpenSettings();
    setQuery("");
    setOpen(false);
  }, [onOpenResource, onOpenSettings, onSelectContext, onSelectNamespace, onSelectSection, setQuery]);

  const runQuery = useCallback((value: string) => {
    const action = parseKeyboardCommand(value, namespaces, contexts);
    if (action) runAction(action);
  }, [contexts, namespaces, runAction]);

  const PalettePaper = useCallback(({ children, ...paperProps }: PaperProps) => (
    <Paper {...paperProps}>
      {children}
      {error && suggestions.length > 0 ? <Typography role="alert" color="error" sx={{ px: 2, py: 0.75 }}>{error}</Typography> : null}
      {error ? <Button size="small" fullWidth disabled={loading}
        onMouseDown={(event) => event.preventDefault()} onClick={retryFailed}>Retry failed search</Button> : null}
      {hasMore && !isCommandQuery(query) ? (
        <Box sx={{ p: 0.75, borderTop: "1px solid", borderColor: "divider" }}>
          <Button size="small" fullWidth disabled={loading}
            onMouseDown={(event) => event.preventDefault()}
            onClick={loadMore}>Load more cached resources</Button>
        </Box>
      ) : null}
    </Paper>
  ), [error, hasMore, loadMore, loading, query, retryFailed, suggestions.length]);

  return (
    <Box sx={{ width: { xs: 220, sm: 320, md: 420 }, mx: 1.25 }}>
    <Autocomplete<PaletteSuggestion, false, false, true>
      freeSolo
      loading={loading || !!error}
      loadingText={<Typography role={error ? "alert" : "status"} color={error ? "error" : "text.secondary"}>{error || "Searching cached resources…"}</Typography>}
      autoHighlight
      openOnFocus
      open={open && !disabled && !!activeContext}
      onOpen={() => setOpen(true)}
      onClose={(event) => {
        // MUI calls handleBlur without an event during its disabled render.
        // That transition is closed by our effect, not a parent render update.
        if (event) setOpen(false);
      }}
      disabled={disabled || !activeContext}
      options={suggestions}
      groupBy={paletteSuggestionCategory}
      inputValue={draft}
      getOptionLabel={(option) => {
        if (typeof option === "string") return option;
        if (option.kind === "cached-resource" || option.kind === "resource-map") return option.item.name;
        if (option.kind === "investigation-snapshot") return option.item.snapshot.title;
        if (option.kind === "command") return option.suggestion.value;
        return "";
      }}
      filterOptions={(options) => options}
      onInputChange={(_, value, reason) => {
        if (reason !== "input" && reason !== "clear") return;
        if (reason === "clear") setQuery("");
        else commitDraft(value);
        setOpen(true);
      }}
      onChange={(_, value) => {
        if (!value) return;
        if (typeof value === "string") runQuery(query);
        else if (value.kind === "resource-map") openMap(value.item);
        else runAction(optionToAction(value));
      }}
      ref={rootRef}
      sx={{ width: "100%" }}
      renderInput={(params) => {
        return (
          <TextField
            id={params.id}
            disabled={params.disabled}
            fullWidth={params.fullWidth}
            size="small"
            placeholder="Search or command"
            onBlur={() => commitDraft(draft, true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                rootRef.current?.querySelector<HTMLInputElement>("input")?.blur();
                setQuery("");
                setOpen(false);
              }
            }}
            slotProps={{
              inputLabel: params.slotProps.inputLabel,
              htmlInput: params.slotProps.htmlInput,
              input: {
                ...params.slotProps.input,
                startAdornment: (
                  <>
                    <SearchIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} />
                    {chips.length ? <Box aria-label="Search filters" data-inline-search-chips
                      sx={{ display: "flex", flexWrap: "nowrap", gap: 0.5, maxWidth: "65%", overflowX: "auto", overflowY: "hidden", flexShrink: 1 }}>
                      {chips.map((raw, index) => <Chip key={`${index}:${raw}`} size="small" label={raw}
                        aria-label={`Remove filter ${raw}`} sx={{ flexShrink: 0, maxWidth: 180 }}
                        onDelete={() => {
                          setChips((previous) => previous.filter((_, i) => i !== index));
                          setOpen(true);
                          rootRef.current?.querySelector<HTMLInputElement>("input")?.focus();
                        }} />)}
                    </Box> : null}
                    {params.slotProps.input.startAdornment}
                  </>
                ),
                endAdornment: (
                  <>
                    {loading ? <CircularProgress size={16} /> : null}
                    {params.slotProps.input.endAdornment}
                  </>
                ),
              },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                height: 40,
                flexWrap: "nowrap",
                overflow: "hidden",
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                borderRadius: 1,
                boxShadow: 1,
                "& fieldset": { borderColor: "var(--border-subtle)" },
                "&:hover fieldset": { borderColor: "var(--border-subtle)" },
                "&.Mui-focused fieldset": { borderColor: "var(--border-subtle)" },
              },
              "& .MuiInputBase-input": { minWidth: 40, flexGrow: 1 },
              "& .MuiInputBase-input::placeholder": {
                color: "text.secondary",
                opacity: 1,
              },
            }}
          />
        );
      }}
      renderOption={(props, option) => (
        <li
          {...props}
          key={option.key}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (option.kind === "resource-map") openMap(option.item);
            else runAction(optionToAction(option));
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            // Assistive technology may dispatch click without a pointer down.
            if (event.detail === 0) {
              if (option.kind === "resource-map") openMap(option.item);
              else runAction(optionToAction(option));
            }
          }}
        >
          {option.kind === "resource-map" ? (
            <Typography>Map {option.item.name} · {resourceSuggestionDescription(option.item)}</Typography>
          ) : option.kind === "cached-resource" ? (
            <ResourceOption item={option.item} />
          ) : option.kind === "investigation-snapshot" ? (
            <SnapshotOption item={option.item} />
          ) : option.kind === "command" ? (
            <CommandOption option={option.suggestion} />
          ) : null}
        </li>
      )}
      renderGroup={(params) => {
        const group = groupedSuggestions.find((item) => item.category === params.group);
        return (
          <Box component="li" key={params.key}>
            <Typography variant="overline" color="text.secondary" sx={{ display: "block", px: 2, pt: 1, lineHeight: 1.4 }}>
              {params.group}{group ? ` (${group.options.filter((option) => option.kind !== "resource-map").length})` : ""}
            </Typography>
            <Box component="ul" sx={{ p: 0 }}>{params.children}</Box>
          </Box>
        );
      }}
      noOptionsText={error || (query.trim().length < 2 && !isCommandQuery(query) ? "Type at least 2 characters." : "No matches.")}
      slots={{ paper: PalettePaper }}
      slotProps={{
        listbox: {
          sx: { maxHeight: 380 },
        },
      }}
    />
    </Box>
  );
}

function useDataplaneSearch({
  open, query, token, activeContext, activeNamespace, activeScope, disabled,
}: {
  open: boolean; query: string; token: string; activeContext: string;
  activeNamespace: string; activeScope: "namespaced" | "cluster"; disabled: boolean;
}) {
  const identity = useMemo(() => ({ token, activeContext, query, activeNamespace, activeScope, disabled }),
    [token, activeContext, query, activeNamespace, activeScope, disabled]);
  type Page = { items: ApiDataplaneSearchItem[]; offset: number; more: boolean; ready: boolean; error: string };
  type SearchState = { identity: typeof identity; pages: Page[]; pending: number };
  const [state, setState] = useState<SearchState | null>(null);
  const session = useRef<{ identity: typeof identity; controller: AbortController; busy: Set<number> } | null>(null);
  const trimmed = query.trim();
  const canSearch = open && !disabled && !!activeContext && trimmed.length >= 2;
  const preferred = activeScope === "namespaced" && activeNamespace &&
    !parseSearchFilters(query).some(({ key }) => key === "ns" || key === "namespace") ? activeNamespace : "";

  const fetchPage = useCallback((index: number, offset: number, owner: NonNullable<typeof session.current>) => {
    if (owner.busy.has(index) || owner.controller.signal.aborted) return;
    owner.busy.add(index);
    const restriction = preferred ? `&${index === 0 ? "namespace" : "excludeNamespace"}=${encodeURIComponent(preferred)}` : "";
    const path = `/api/dataplane/search?q=${encodeURIComponent(trimmed)}&limit=${searchLimit}&offset=${offset}${restriction}`;
    const current = () => session.current === owner && !owner.controller.signal.aborted;
    setState((previous) => previous?.identity === owner.identity ? { ...previous, pending: previous.pending + 1 } : previous);
    apiGetWithContext<ApiDataplaneSearchResponse>(path, token, activeContext, { signal: owner.controller.signal })
      .then((response) => {
        if (!current()) return;
        setState((previous) => {
          if (previous?.identity !== owner.identity) return previous;
          const pages = [...previous.pages];
          const page = pages[index];
          pages[index] = { items: [...page.items, ...(response.items || [])],
            offset: offset + (response.items || []).length, more: !!response.hasMore, ready: true, error: "" };
          return { ...previous, pages };
        });
      })
      .catch((error) => {
        if (!current() || isAbortError(error)) return;
        setState((previous) => {
          if (previous?.identity !== owner.identity) return previous;
          const pages = [...previous.pages];
          pages[index] = { ...pages[index], ready: true, more: false, error: String(error?.message || error || "Search failed") };
          return { ...previous, pages };
        });
      })
      .finally(() => {
        owner.busy.delete(index);
        if (current()) setState((previous) => previous?.identity === owner.identity ? { ...previous, pending: previous.pending - 1 } : previous);
      });
  }, [activeContext, preferred, token, trimmed]);

  useEffect(() => {
    session.current?.controller.abort();
    if (!canSearch) { setState(null); return; }
    const owner = { identity, controller: new AbortController(), busy: new Set<number>() };
    session.current = owner;
    const pages = Array.from({ length: preferred ? 2 : 1 }, () => ({ items: [], offset: 0, more: false, ready: false, error: "" }));
    setState({ identity, pages, pending: 0 });
    const timer = window.setTimeout(() => {
      // Start both cache-only partitions in the same debounce tick. Publish the
      // local response independently; hold broad results until local is ready.
      pages.forEach((_, index) => fetchPage(index, 0, owner));
    }, searchDebounceMs);
    return () => { window.clearTimeout(timer); owner.controller.abort(); };
  }, [canSearch, fetchPage, identity, preferred]);

  const current = canSearch && state?.identity === identity ? state : null;
  const seen = new Set<string>();
  const items = current?.pages[0].ready ? current.pages.flatMap((page) => page.items).filter((item) => {
    const key = resourceSuggestionKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) : [];
  const loadMore = useCallback(() => {
    const owner = session.current;
    if (!current || !owner || owner.identity !== identity || current.pending) return;
    const index = current.pages.findIndex((page) => page.more);
    if (index >= 0) fetchPage(index, current.pages[index].offset, owner);
  }, [current, fetchPage, identity]);
  const retryFailed = useCallback(() => {
    const owner = session.current;
    if (!current || !owner || owner.identity !== identity) return;
    current.pages.forEach((page, index) => {
      if (page.error) fetchPage(index, page.offset, owner);
    });
  }, [current, fetchPage, identity]);
  return { items, loading: !!current && (current.pending > 0 || current.pages.some((page) => !page.ready)),
    error: current?.pages.map((page) => page.error).filter(Boolean).join("; ") || "", hasMore: !!current?.pages.some((page) => page.more), loadMore, retryFailed };
}

function useInvestigationSnapshotSearch({
  open,
  query,
  token,
  activeContext,
  activeNamespace,
  activeScope,
  disabled,
}: {
  open: boolean;
  query: string;
  token: string;
  activeContext: string;
  activeNamespace: string;
  activeScope: "namespaced" | "cluster";
  disabled: boolean;
}) {
  const identity = useMemo(() => ({ token, activeContext, activeNamespace, activeScope, query, disabled }),
    [token, activeContext, activeNamespace, activeScope, query, disabled]);
  const [result, setResult] = useState<{ identity: typeof identity; items: InvestigationSnapshotSearchItem[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const trimmed = query.trim();
  const canSearch = open && !disabled && !!activeContext && trimmed.length >= 2;

  useEffect(() => {
    abortRef.current?.abort();
    if (!canSearch) {
      setResult(null);
      return;
    }
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(() => {
      listInvestigationSnapshots(token, activeContext, { signal: controller.signal })
        .then((snapshots) => {
          if (controller.signal.aborted || seq !== seqRef.current) return;
          setResult({ identity, items: searchInvestigationSnapshots(snapshots, trimmed) });
        })
        .catch((err) => {
          if (controller.signal.aborted || seq !== seqRef.current || isAbortError(err)) return;
          setResult(null);
        });
    }, searchDebounceMs);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activeContext, canSearch, identity, token, trimmed]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return canSearch && result?.identity === identity ? result.items : [];
}

function severityChipColor(severity?: string): "default" | "error" | "warning" | "info" | "success" {
  switch ((severity || "").toLowerCase()) {
    case "high":
      return "error";
    case "medium":
      return "warning";
    case "low":
      return "info";
    case "ok":
      return "success";
    default:
      return "default";
  }
}

export function SnapshotOption({ item }: { item: InvestigationSnapshotSearchItem }) {
  const snapshot = item.snapshot;
  const ref = snapshot.primaryResource;
  const resourceLabel = ref.namespace ? `${ref.kind} · ${ref.namespace}/${ref.name}` : `${ref.kind} · ${ref.name}`;
  return (
    <Box sx={{ minWidth: 0, width: "100%", py: 0.25 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, mb: 0.35 }}>
        <Typography variant="body2" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {snapshot.title || snapshot.signal?.title || "Saved investigation"}
        </Typography>
        <Chip size="small" color="info" variant="outlined" label="snapshot" sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }} />
        <Chip size="small" variant="outlined" label={`${item.matchReason} match`} sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }} />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0, flexWrap: "wrap" }}>
        <Chip size="small" color={severityChipColor(snapshot.signal?.severity)} variant="outlined" label={snapshot.signal?.severity || "signal"} sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }} />
        <Chip size="small" variant="outlined" label={snapshot.triageState || "investigating"} sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }} />
        <Chip size="small" variant="outlined" label={resourceLabel} sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }} />
      </Box>
      {snapshot.operatorNote ? (
        <Typography variant="caption" color="text.secondary" noWrap>
          {snapshot.operatorNote}
        </Typography>
      ) : null}
    </Box>
  );
}

export function ResourceOption({ item }: { item: ApiDataplaneSearchItem }) {
  const signalCount = item.signalCount || 0;
  const kindLabel = labelForSearchKind(item.kind);
  const matchLabel = item.matchReason ? `${item.matchReason} match` : "cached match";
  return (
    <Box sx={{ minWidth: 0, width: "100%", py: 0.25 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0, mb: 0.35 }}>
        <Typography variant="body2" sx={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {item.name}
        </Typography>
        <Chip
          size="small"
          color="info"
          variant="outlined"
          label={kindLabel}
          sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }}
        />
        <Chip
          size="small"
          variant="outlined"
          label={matchLabel}
          sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }}
        />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0, flexWrap: "wrap" }}>
        {item.namespace ? (
          <Chip
            size="small"
            variant="outlined"
            label={`ns: ${item.namespace}`}
            sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }}
          />
        ) : null}
        {item.needsAttention || signalCount > 0 ? (
          <Chip
            size="small"
            color={severityChipColor(item.signalSeverity)}
            variant="outlined"
            label={signalCount > 0 ? `${signalCount} signal${signalCount === 1 ? "" : "s"}` : "attention"}
            sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }}
          />
        ) : null}
        {item.healthBucket ? (
          <Chip
            size="small"
            variant="outlined"
            label={item.healthBucket}
            sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }}
          />
        ) : null}
        {item.listStatus ? (
          <Chip
            size="small"
            color={item.needsAttention ? severityChipColor(item.signalSeverity) : "default"}
            variant="outlined"
            label={item.listStatus}
            sx={{ height: 20, "& .MuiChip-label": { px: 0.65 } }}
          />
        ) : null}
      </Box>
      <Typography variant="caption" color="text.secondary" noWrap>
        {resourceSuggestionDescription(item)}
      </Typography>
    </Box>
  );
}

function CommandOption({ option }: { option: CommandSuggestion }) {
  return (
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
  );
}
