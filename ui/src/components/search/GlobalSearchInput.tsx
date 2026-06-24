import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Autocomplete,
  Box,
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

const searchLimit = 10;
const searchDebounceMs = 350;

export type GlobalSearchFocusRequest = {
  nonce: number;
  query: string;
};

type PaletteSuggestion =
  | { kind: "cached-resource"; key: string; item: ApiDataplaneSearchItem }
  | { kind: "command"; key: string; suggestion: CommandSuggestion };

type Props = {
  token: string;
  activeContext: string;
  disabled?: boolean;
  focusRequest?: GlobalSearchFocusRequest;
  namespaces: string[];
  contexts: string[];
  onSelectSection: (section: Section) => void;
  onSelectNamespace: (namespace: string) => void;
  onSelectContext: (context: string) => void;
  onOpenResource: (item: ApiDataplaneSearchItem) => void;
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

function labelForSearchKind(kind: string): string {
  if (kind === "helmreleases") return "Helm Releases";
  return getResourceLabel(kind as ListResourceKey);
}

function resourceSuggestionDescription(item: ApiDataplaneSearchItem): string {
  const scope = item.namespace ? `${item.cluster} / ${item.namespace}` : item.cluster;
  return `${labelForSearchKind(item.kind)} · ${scope || "cached dataplane"}`;
}

function paletteSuggestionCategory(option: PaletteSuggestion): string {
  return option.kind === "cached-resource" ? "Cached Resources" : option.suggestion.category;
}

function optionToAction(option: PaletteSuggestion): KeyboardCommandAction {
  if (option.kind === "cached-resource") return { type: "resource", item: option.item };
  return option.suggestion.action;
}

export default function GlobalSearchInput({
  token,
  activeContext,
  disabled = false,
  focusRequest,
  namespaces,
  contexts,
  onSelectSection,
  onSelectNamespace,
  onSelectContext,
  onOpenResource,
  onOpenSettings,
}: Props) {
  const { requestKeyboardFocus } = useKeyboardControls();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
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
  } = useDataplaneSearch({
    open,
    query,
    token,
    activeContext,
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
  }, [activeContext, disabled, focusRequest, requestKeyboardFocus]);

  const suggestions = useMemo<PaletteSuggestion[]>(() => {
    const resourceSuggestions = resourceItems.map((item) => ({
      kind: "cached-resource" as const,
      key: resourceSuggestionKey(item),
      item,
    }));
    const commandOptions = commandSuggestions.map((suggestion) => ({
      kind: "command" as const,
      key: suggestion.value,
      suggestion,
    }));
    if (isCommandQuery(query)) return commandOptions;
    return [...resourceSuggestions, ...commandOptions];
  }, [commandSuggestions, query, resourceItems]);

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
  }, [onOpenResource, onOpenSettings, onSelectContext, onSelectNamespace, onSelectSection]);

  const runQuery = useCallback((value: string) => {
    const action = parseKeyboardCommand(value, namespaces, contexts);
    if (action) runAction(action);
  }, [contexts, namespaces, runAction]);

  const PalettePaper = useCallback(({ children, ...paperProps }: PaperProps) => (
    <Paper {...paperProps}>
      {children}
      {hasMore && !isCommandQuery(query) ? (
        <Box sx={{ p: 0.75, borderTop: "1px solid", borderColor: "divider" }}>
          <Chip
            data-load-more
            size="small"
            variant="outlined"
            label="Load more cached resources"
            sx={{ width: "100%" }}
          />
        </Box>
      ) : null}
    </Paper>
  ), [hasMore, query]);

  return (
    <Autocomplete<PaletteSuggestion, false, false, true>
      freeSolo
      autoHighlight
      openOnFocus
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      disabled={disabled || !activeContext}
      options={suggestions}
      groupBy={paletteSuggestionCategory}
      inputValue={query}
      getOptionLabel={(option) => {
        if (typeof option === "string") return option;
        if (option.kind === "cached-resource") return option.item.name;
        return option.suggestion.value;
      }}
      filterOptions={(options) => options}
      onInputChange={(_, value) => {
        setQuery(value);
        setOpen(true);
      }}
      onChange={(_, value) => {
        if (!value) return;
        if (typeof value === "string") runQuery(value);
        else runAction(optionToAction(value));
      }}
      ref={rootRef}
      sx={{ width: { xs: 220, sm: 320, md: 420 }, mx: 1.25 }}
      renderInput={(params) => {
        return (
          <TextField
            id={params.id}
            disabled={params.disabled}
            fullWidth={params.fullWidth}
            size="small"
            placeholder="Search or command"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setQuery("");
                setOpen(false);
                rootRef.current?.querySelector<HTMLInputElement>("input")?.blur();
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
                backgroundColor: "var(--bg-primary)",
                color: "var(--text-primary)",
                borderRadius: 1,
                boxShadow: 1,
                "& fieldset": { borderColor: "var(--border-subtle)" },
                "&:hover fieldset": { borderColor: "var(--border-subtle)" },
                "&.Mui-focused fieldset": { borderColor: "var(--border-subtle)" },
              },
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
            runAction(optionToAction(option));
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {option.kind === "cached-resource" ? (
            <ResourceOption item={option.item} />
          ) : (
            <CommandOption option={option.suggestion} />
          )}
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
      noOptionsText={error || (query.trim().length < 2 && !isCommandQuery(query) ? "Type at least 2 characters." : "No matches.")}
      slots={{ paper: PalettePaper }}
      slotProps={{
        listbox: {
          sx: { maxHeight: 380 },
          onMouseDown: (event: React.MouseEvent<HTMLElement>) => {
            const target = event.target as HTMLElement;
            if (!target.closest("[data-load-more]")) return;
            event.preventDefault();
            event.stopPropagation();
            loadMore();
          },
        },
      }}
    />
  );
}

function useDataplaneSearch({
  open,
  query,
  token,
  activeContext,
  disabled,
}: {
  open: boolean;
  query: string;
  token: string;
  activeContext: string;
  disabled: boolean;
}) {
  const [items, setItems] = useState<ApiDataplaneSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const trimmed = query.trim();
  const canSearch = open && !disabled && !!activeContext && trimmed.length >= 2;

  const fetchResults = useCallback((searchQuery: string, offset: number, signal: AbortSignal) => {
    const path = `/api/dataplane/search?q=${encodeURIComponent(searchQuery)}&limit=${searchLimit}&offset=${offset}`;
    return apiGetWithContext<ApiDataplaneSearchResponse>(path, token, activeContext, { signal });
  }, [activeContext, token]);

  useEffect(() => {
    searchAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort();

    if (!canSearch) {
      setItems([]);
      setLoading(false);
      setLoadingMore(false);
      setError("");
      setHasMore(false);
      return;
    }

    const searchQuery = trimmed;
    const seq = seqRef.current + 1;
    seqRef.current = seq;
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setItems([]);
    setHasMore(false);
    setError("");
    setLoading(true);
    setLoadingMore(false);

    const timer = window.setTimeout(() => {
      fetchResults(searchQuery, 0, controller.signal)
        .then((res) => {
          if (controller.signal.aborted || seq !== seqRef.current) return;
          setItems(res.items || []);
          setHasMore(!!res.hasMore);
        })
        .catch((err) => {
          if (controller.signal.aborted || seq !== seqRef.current || isAbortError(err)) return;
          setItems([]);
          setHasMore(false);
          setError(String((err as Error | undefined)?.message || err || "Search failed"));
        })
        .finally(() => {
          if (!controller.signal.aborted && seq === seqRef.current) setLoading(false);
        });
    }, searchDebounceMs);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [canSearch, fetchResults, trimmed]);

  useEffect(() => {
    return () => {
      searchAbortRef.current?.abort();
      loadMoreAbortRef.current?.abort();
    };
  }, []);

  const loadMore = useCallback(() => {
    if (!canSearch || loading || loadingMore) return;
    const searchQuery = trimmed;
    const seq = seqRef.current;
    const controller = new AbortController();
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = controller;

    setLoadingMore(true);
    fetchResults(searchQuery, items.length, controller.signal)
      .then((res) => {
        if (controller.signal.aborted || seq !== seqRef.current) return;
        setItems((prev) => [...prev, ...(res.items || [])]);
        setHasMore(!!res.hasMore);
        setError("");
      })
      .catch((err) => {
        if (controller.signal.aborted || seq !== seqRef.current || isAbortError(err)) return;
        setError(String((err as Error | undefined)?.message || err || "Search failed"));
      })
      .finally(() => {
        if (!controller.signal.aborted && seq === seqRef.current) setLoadingMore(false);
      });
  }, [canSearch, fetchResults, items.length, loading, loadingMore, trimmed]);

  return { items, loading: loading || loadingMore, error, hasMore, loadMore };
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
