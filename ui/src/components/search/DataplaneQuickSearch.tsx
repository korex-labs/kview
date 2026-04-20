import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  ClickAwayListener,
  List,
  ListItemButton,
  ListItemText,
  Paper,
  Popper,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { apiGetWithContext } from "../../api";
import type { ApiDataplaneSearchItem, ApiDataplaneSearchResponse } from "../../types/api";
import { getResourceLabel, type ListResourceKey } from "../../utils/k8sResources";

const SEARCH_PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 400;

type Props = {
  token: string;
  activeContext: string;
  disabled?: boolean;
  onOpenResult: (item: ApiDataplaneSearchItem) => void;
};

function labelForKind(kind: string): string {
  if (kind === "helmreleases") return "Helm Releases";
  return getResourceLabel(kind as ListResourceKey);
}

function resultSecondary(item: ApiDataplaneSearchItem): string {
  const scope = item.namespace ? `${item.cluster} / ${item.namespace}` : item.cluster;
  return `${labelForKind(item.kind)} · ${scope || "cached dataplane"}`;
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { name?: unknown }).name === "AbortError";
}

export default function DataplaneQuickSearch({ token, activeContext, disabled, onOpenResult }: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ApiDataplaneSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef(0);
  const trimmed = query.trim();
  const canSearch = trimmed.length >= 2 && !!activeContext && !disabled;

  const fetchResults = React.useCallback((searchQuery: string, offset: number, signal: AbortSignal) => {
    const path = `/api/dataplane/search?q=${encodeURIComponent(searchQuery)}&limit=${SEARCH_PAGE_SIZE}&offset=${offset}`;
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
    const searchSeq = searchSeqRef.current + 1;
    searchSeqRef.current = searchSeq;
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setItems([]);
    setHasMore(false);
    setError("");
    setLoading(true);
    setLoadingMore(false);
    setOpen(true);

    const timer = window.setTimeout(() => {
      fetchResults(searchQuery, 0, controller.signal)
        .then((res) => {
          if (controller.signal.aborted || searchSeq !== searchSeqRef.current) return;
          setItems(res.items || []);
          setHasMore(!!res.hasMore);
          setError("");
          setOpen(true);
        })
        .catch((err) => {
          if (controller.signal.aborted || searchSeq !== searchSeqRef.current || isAbortError(err)) return;
          setItems([]);
          setError(String((err as Error | undefined)?.message || err || "Search failed"));
          setOpen(true);
        })
        .finally(() => {
          if (!controller.signal.aborted && searchSeq === searchSeqRef.current) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

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

  const loadMore = React.useCallback(() => {
    if (!canSearch || loading || loadingMore) return;
    const searchQuery = trimmed;
    const searchSeq = searchSeqRef.current;
    const controller = new AbortController();
    loadMoreAbortRef.current?.abort();
    loadMoreAbortRef.current = controller;

    setLoadingMore(true);
    fetchResults(searchQuery, items.length, controller.signal)
      .then((res) => {
        if (controller.signal.aborted || searchSeq !== searchSeqRef.current) return;
        setItems((prev) => [...prev, ...(res.items || [])]);
        setHasMore(!!res.hasMore);
        setError("");
      })
      .catch((err) => {
        if (controller.signal.aborted || searchSeq !== searchSeqRef.current || isAbortError(err)) return;
        setError(String((err as Error | undefined)?.message || err || "Search failed"));
      })
      .finally(() => {
        if (!controller.signal.aborted && searchSeq === searchSeqRef.current) setLoadingMore(false);
      });
  }, [canSearch, fetchResults, items.length, loading, loadingMore, trimmed]);

  const content = useMemo(() => {
    if (!trimmed) return null;
    if (trimmed.length < 2) return <Typography variant="body2" color="text.secondary">Type at least 2 characters.</Typography>;
    if (loading) return <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><CircularProgress size={16} /> Searching cached dataplane</Box>;
    if (error) return <Typography variant="body2" color="error">{error}</Typography>;
    if (items.length === 0) return <Typography variant="body2" color="text.secondary">No cached dataplane matches.</Typography>;
    return (
      <>
        <List dense disablePadding>
          {items.map((item) => (
            <ListItemButton
              key={`${item.cluster}/${item.kind}/${item.namespace || ""}/${item.name}`}
              onClick={() => {
                onOpenResult(item);
                setOpen(false);
                setQuery("");
              }}
            >
              <ListItemText primary={item.name} secondary={resultSecondary(item)} primaryTypographyProps={{ noWrap: true }} secondaryTypographyProps={{ noWrap: true }} />
            </ListItemButton>
          ))}
        </List>
        {hasMore ? (
          <Box sx={{ p: 0.75, borderTop: "1px solid", borderColor: "divider" }}>
            <Button size="small" fullWidth onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? "Loading" : "Load 10 more"}
            </Button>
          </Box>
        ) : null}
      </>
    );
  }, [error, hasMore, items, loadMore, loading, loadingMore, onOpenResult, trimmed]);

  return (
    <ClickAwayListener onClickAway={() => setOpen(false)}>
      <Box ref={anchorRef} sx={{ width: { xs: 220, sm: 320, md: 420 }, mx: 1.25 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search cached dataplane"
          value={query}
          disabled={disabled || !activeContext}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            setQuery("");
            setItems([]);
            setError("");
            setHasMore(false);
            setOpen(false);
          }}
          onFocus={() => setOpen(true)}
          InputProps={{
            startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.75, color: "text.secondary" }} />,
            endAdornment: loading ? <CircularProgress size={16} /> : null,
          }}
          sx={{
            "& .MuiOutlinedInput-root": {
              backgroundColor: "var(--bg-primary)",
              color: "var(--text-primary)",
              borderRadius: 1,
              boxShadow: 1,
              "& fieldset": {
                borderColor: "var(--border-subtle)",
              },
              "&:hover fieldset": {
                borderColor: "var(--border-subtle)",
              },
              "&.Mui-focused fieldset": {
                borderColor: "var(--border-subtle)",
              },
            },
            "& .MuiInputBase-input::placeholder": {
              color: "text.secondary",
              opacity: 1,
            },
          }}
        />
        <Popper open={open && !!content} anchorEl={anchorRef.current} placement="bottom-start" sx={{ zIndex: 1500, width: anchorRef.current?.clientWidth || 420 }}>
          <Paper variant="outlined" sx={{ mt: 0.75, p: items.length > 0 && !loading && !error ? 0 : 1.25, maxHeight: 380, overflow: "auto" }}>
            {content}
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
  );
}
