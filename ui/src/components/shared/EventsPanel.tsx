import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { apiGet, apiGetWithContext, toApiError, type ApiError } from "../../api";
import type { ApiListResponse } from "../../types/api";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import EventCard, { type EventCardEvent } from "./EventCard";
import Section from "./Section";
import { AppButton } from "./AppActions";

type EventSubResourceOption = {
  label: string;
  value: string;
};

type EventTarget = {
  kind?: string;
  name?: string;
  label: string;
  title?: string;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
};

type EventsPanelProps<T extends EventCardEvent> = {
  title?: string;
  events?: T[];
  endpoint?: string;
  token?: string;
  contextName?: string;
  pageSize?: number;
  emptyMessage?: string;
  filterPlaceholder?: string;
  subResourceLabel?: string;
  subResourceOptions?: EventSubResourceOption[];
  getEventSubResource?: (event: T) => string;
  showTarget?: boolean;
  getEventTarget?: (event: T) => EventTarget | null;
  onSubResourceClick?: (subResource: string) => void;
};

function eventMatchesQuery(event: EventCardEvent, query: string) {
  if (!query) return true;
  const haystack = [
    event.type,
    event.reason,
    event.message,
    event.involvedKind,
    event.involvedName,
    event.fieldPath,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function EventsPanel<T extends EventCardEvent>(props: EventsPanelProps<T>) {
  return <EventsPanelContent key={JSON.stringify([props.endpoint, props.token, props.contextName])} {...props} />;
}

function EventsPanelContent<T extends EventCardEvent>({
  title,
  events = [],
  endpoint,
  token,
  contextName,
  pageSize = 50,
  emptyMessage = "No events found.",
  filterPlaceholder = "Filter events",
  subResourceLabel = "Sub-resource",
  subResourceOptions = [],
  getEventSubResource,
  showTarget = false,
  getEventTarget,
  onSubResourceClick,
}: EventsPanelProps<T>) {
  const [query, setQuery] = useState("");
  const [selectedSubResource, setSelectedSubResource] = useState("");
  const [remoteItems, setRemoteItems] = useState<T[]>([]);
  const [remoteTotal, setRemoteTotal] = useState(0);
  const [page, setPage] = useState({ filter: "", offset: 0 });
  const filter = JSON.stringify([query.trim().toLowerCase(), selectedSubResource, pageSize]);
  const remoteOffset = page.filter === filter ? page.offset : 0;
  const setRemoteOffset = (offset: number) => setPage({ filter, offset });
  const [remoteLimit, setRemoteLimit] = useState(pageSize);
  const [remoteHasMore, setRemoteHasMore] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteErr, setRemoteErr] = useState<ApiError | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const generation = useRef(0);
  const [resultKey, setResultKey] = useState("");
  const [retryNonce, setRetryNonce] = useState(0);
  const requestKey = JSON.stringify([filter, remoteOffset, retryNonce]);
  const normalizedQuery = query.trim().toLowerCase();
  const remoteMode = !!endpoint && !!token;
  const hasSubResourceFilter = subResourceOptions.length > 0 && !!getEventSubResource;
  const visibleEvents = remoteMode ? remoteItems : events;

  const filteredEvents = useMemo(
    () => {
      if (remoteMode) return resultKey === requestKey ? remoteItems : [];
      return events.filter((event) => {
        if (hasSubResourceFilter && selectedSubResource && getEventSubResource(event) !== selectedSubResource) {
          return false;
        }
        return eventMatchesQuery(event, normalizedQuery);
      });
    },
    [events, getEventSubResource, hasSubResourceFilter, normalizedQuery, remoteItems, remoteMode, selectedSubResource, resultKey, requestKey],
  );

  useEffect(() => {
    if (!remoteMode) return;
    topRef.current?.scrollIntoView?.({ block: "start" });
  }, [remoteMode, remoteOffset]);

  useEffect(() => {
    if (!remoteMode) return;
    const controller = new AbortController();
    const request = ++generation.current;
    const current = () => !controller.signal.aborted && generation.current === request;
    const [path, existingQuery = ""] = endpoint!.split("?");
    const params = new URLSearchParams(existingQuery);
    params.set("limit", String(pageSize));
    params.set("offset", String(remoteOffset));
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (selectedSubResource) params.set("subResource", selectedSubResource);
    const url = `${path}?${params.toString()}`;

    setRemoteLoading(true);
    setRemoteErr(null);
    const load = contextName === undefined
      ? apiGet<ApiListResponse<T>>(url, token!, { signal: controller.signal })
      : contextName
        ? apiGetWithContext<ApiListResponse<T>>(url, token!, contextName, { signal: controller.signal })
        : Promise.reject(new Error("Missing active context"));
    load.then((res) => {
        if (!current()) return;
        setResultKey(requestKey);
        setRemoteItems(res.items || []);
        setRemoteTotal(res.total ?? res.items?.length ?? 0);
        setRemoteLimit(res.limit ?? pageSize);
        setRemoteHasMore(!!res.hasMore);
      })
      .catch((error) => {
        if (!current() || (error as Error | undefined)?.name === "AbortError") return;
        setResultKey(requestKey);
        setRemoteItems([]);
        setRemoteTotal(0);
        setRemoteHasMore(false);
        setRemoteErr(toApiError(error));
      })
      .finally(() => {
        if (current()) setRemoteLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, normalizedQuery, pageSize, remoteMode, remoteOffset, selectedSubResource, token, contextName, requestKey]);

  const handleSubResourceChange = (event: SelectChangeEvent) => {
    setSelectedSubResource(event.target.value);
    setRemoteOffset(0);
  };

  const panelTitle = title ?? "Events";

  return (
    <Section title={panelTitle}>
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, minHeight: 0 }}>
      <Box ref={topRef} sx={{ height: 0, minHeight: 0 }} />
      {(hasSubResourceFilter || visibleEvents.length > 0 || remoteMode) ? (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Box sx={{ mr: "auto" }} />
          {hasSubResourceFilter ? (
            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel id="events-sub-resource-label" shrink>
                {subResourceLabel}
              </InputLabel>
              <Select
                labelId="events-sub-resource-label"
                label={subResourceLabel}
                displayEmpty
                value={selectedSubResource}
                onChange={handleSubResourceChange}
              >
                <MenuItem value="">All {subResourceLabel.toLowerCase()}s</MenuItem>
                {subResourceOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : null}
          {visibleEvents.length > 0 || remoteMode ? (
            <TextField
              size="small"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setRemoteOffset(0);
              }}
              placeholder={filterPlaceholder}
              sx={{ minWidth: 220 }}
            />
          ) : null}
        </Box>
      ) : null}

      {remoteErr && resultKey === requestKey ? (
        <Box>
          <ErrorState message={remoteErr.message} status={remoteErr.status} />
          <AppButton onClick={() => setRetryNonce((value) => value + 1)}>Retry events</AppButton>
        </Box>
      ) : remoteMode && (remoteLoading || resultKey !== requestKey) && filteredEvents.length === 0 ? (
        <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
          <CircularProgress size={22} />
        </Box>
      ) : filteredEvents.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <>
          {filteredEvents.map((event, index) => {
            const target = getEventTarget?.(event);
            const subResource = getEventSubResource?.(event);
            const canOpenSubResource =
              !!onSubResourceClick && !!subResource && subResourceOptions.some((option) => option.value === subResource);
            return (
              <EventCard
                key={`${event.lastSeen || "event"}-${event.reason || ""}-${index}`}
                event={event}
                showTarget={showTarget}
                targetKind={target?.kind}
                targetName={target?.name}
                targetLabel={target?.label}
                targetTitle={target?.title}
                onTargetClick={target?.onClick}
                subResourceKind={subResourceLabel}
                subResourceLabel={subResource || undefined}
                onSubResourceClick={canOpenSubResource ? () => onSubResourceClick?.(subResource) : undefined}
              />
            );
          })}
          {remoteMode ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, flexWrap: "wrap" }}>
              <Typography variant="caption" color="text.secondary">
                {remoteTotal === 0
                  ? "0 events"
                  : `${remoteOffset + 1}-${Math.min(remoteOffset + remoteLimit, remoteTotal)} of ${remoteTotal}`}
              </Typography>
              <Box sx={{ display: "flex", gap: 1 }}>
                <AppButton
                  disabled={remoteLoading || remoteOffset <= 0}
                  onClick={() => setRemoteOffset(Math.max(0, remoteOffset - remoteLimit))}
                >
                  Previous
                </AppButton>
                <AppButton
                  disabled={remoteLoading || !remoteHasMore}
                  onClick={() => setRemoteOffset(remoteOffset + remoteLimit)}
                >
                  Next
                </AppButton>
              </Box>
            </Box>
          ) : null}
        </>
      )}
    </Box>
    </Section>
  );
}
