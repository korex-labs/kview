import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import { apiGet, toApiError, type ApiError } from "../../api";
import type { ApiListResponse } from "../../types/api";
import EmptyState from "./EmptyState";
import ErrorState from "./ErrorState";
import EventCard, { type EventCardEvent } from "./EventCard";
import Section from "./Section";

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

export default function EventsPanel<T extends EventCardEvent>({
  title,
  events = [],
  endpoint,
  token,
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
  const [remoteOffset, setRemoteOffset] = useState(0);
  const [remoteLimit, setRemoteLimit] = useState(pageSize);
  const [remoteHasMore, setRemoteHasMore] = useState(false);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteErr, setRemoteErr] = useState<ApiError | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim().toLowerCase();
  const remoteMode = !!endpoint && !!token;
  const hasSubResourceFilter = subResourceOptions.length > 0 && !!getEventSubResource;
  const visibleEvents = remoteMode ? remoteItems : events;

  const filteredEvents = useMemo(
    () => {
      if (remoteMode) return remoteItems;
      return events.filter((event) => {
        if (hasSubResourceFilter && selectedSubResource && getEventSubResource(event) !== selectedSubResource) {
          return false;
        }
        return eventMatchesQuery(event, normalizedQuery);
      });
    },
    [events, getEventSubResource, hasSubResourceFilter, normalizedQuery, remoteItems, remoteMode, selectedSubResource],
  );

  useEffect(() => {
    setRemoteOffset(0);
  }, [endpoint, normalizedQuery, selectedSubResource]);

  useEffect(() => {
    if (!remoteMode) return;
    topRef.current?.scrollIntoView({ block: "start" });
  }, [remoteMode, remoteOffset]);

  useEffect(() => {
    if (!remoteMode) return;
    const controller = new AbortController();
    const params = new URLSearchParams({
      limit: String(pageSize),
      offset: String(remoteOffset),
    });
    if (normalizedQuery) params.set("q", normalizedQuery);
    if (selectedSubResource) params.set("subResource", selectedSubResource);
    const url = `${endpoint}?${params.toString()}`;

    setRemoteLoading(true);
    setRemoteErr(null);
    apiGet<ApiListResponse<T>>(url, token, { signal: controller.signal })
      .then((res) => {
        setRemoteItems(res.items || []);
        setRemoteTotal(res.total ?? res.items?.length ?? 0);
        setRemoteLimit(res.limit ?? pageSize);
        setRemoteHasMore(!!res.hasMore);
      })
      .catch((error) => {
        if ((error as Error | undefined)?.name === "AbortError") return;
        setRemoteItems([]);
        setRemoteTotal(0);
        setRemoteHasMore(false);
        setRemoteErr(toApiError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setRemoteLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, normalizedQuery, pageSize, remoteMode, remoteOffset, selectedSubResource, token]);

  const handleSubResourceChange = (event: SelectChangeEvent) => {
    setSelectedSubResource(event.target.value);
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder={filterPlaceholder}
              sx={{ minWidth: 220 }}
            />
          ) : null}
        </Box>
      ) : null}

      {remoteErr ? (
        <ErrorState message={remoteErr.message} />
      ) : remoteLoading && filteredEvents.length === 0 ? (
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
                <Button
                  size="small"
                  variant="outlined"
                  disabled={remoteLoading || remoteOffset <= 0}
                  onClick={() => setRemoteOffset(Math.max(0, remoteOffset - remoteLimit))}
                >
                  Previous
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={remoteLoading || !remoteHasMore}
                  onClick={() => setRemoteOffset(remoteOffset + remoteLimit)}
                >
                  Next
                </Button>
              </Box>
            </Box>
          ) : null}
        </>
      )}
    </Box>
    </Section>
  );
}
