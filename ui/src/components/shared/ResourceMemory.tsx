import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { AppButton } from "./AppActions";
import InfoHint from "./InfoHint";
import Section from "./Section";
import { useActiveContext } from "../../activeContext";
import type { ListResourceKey } from "../../utils/k8sResources";
import {
  getResourceMemoryRecord,
  loadResourceMemoryStore,
  removeResourceMemoryRecord,
  RESOURCE_MEMORY_CHANGED_EVENT,
  saveResourceMemoryStore,
  upsertResourceMemoryRecord,
  type ResourceMemoryRecord,
  type ResourceMemoryStatus,
  type ResourceMemoryTarget,
} from "../../resourceMemory";

const statusOptions: Array<{ value: ResourceMemoryStatus; label: string; color: "default" | "info" | "warning" | "error" | "success" }> = [
  { value: "watch", label: "Watch item", color: "info" },
  { value: "known", label: "Known behavior", color: "default" },
  { value: "do-not-touch", label: "Do not touch", color: "error" },
  { value: "investigating", label: "Investigating", color: "warning" },
  { value: "resolved", label: "Resolved", color: "success" },
];

function statusLabel(status: ResourceMemoryStatus): string {
  return statusOptions.find((item) => item.value === status)?.label || status;
}

function statusColor(status: ResourceMemoryStatus): "default" | "info" | "warning" | "error" | "success" {
  return statusOptions.find((item) => item.value === status)?.color || "default";
}

function formatUpdatedAt(value?: number): string {
  if (!value) return "Not saved yet";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "Saved";
  }
}

function labelWithHint(label: string, hint: string): React.ReactNode {
  return (
    <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      {label}
      <InfoHint title={hint} />
    </Box>
  );
}

function useResourceMemory(target: ResourceMemoryTarget | null): ResourceMemoryRecord | null {
  const [store, setStore] = useState(() => loadResourceMemoryStore());

  useEffect(() => {
    const refresh = () => setStore(loadResourceMemoryStore());
    window.addEventListener(RESOURCE_MEMORY_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(RESOURCE_MEMORY_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  return useMemo(() => (target ? getResourceMemoryRecord(store, target) : null), [store, target]);
}

export function ResourceMemoryPanel({
  resource,
  namespace,
  name,
}: {
  resource: ListResourceKey;
  namespace?: string | null;
  name?: string | null;
}) {
  const context = useActiveContext();
  const target = useMemo<ResourceMemoryTarget | null>(() => {
    if (!context || !name) return null;
    return { context, resource, namespace: namespace || "", name };
  }, [context, name, namespace, resource]);
  const record = useResourceMemory(target);
  const [status, setStatus] = useState<ResourceMemoryStatus>("watch");
  const [note, setNote] = useState("");
  const [runbookUrl, setRunbookUrl] = useState("");

  useEffect(() => {
    setStatus(record?.status || "watch");
    setNote(record?.note || "");
    setRunbookUrl(record?.runbookUrl || "");
  }, [record, target]);

  if (!target) return null;

  const dirty = status !== (record?.status || "watch") || note !== (record?.note || "") || runbookUrl !== (record?.runbookUrl || "");
  const hasContent = Boolean(record || note.trim() || runbookUrl.trim() || status !== "watch");

  const save = () => {
    const store = loadResourceMemoryStore();
    saveResourceMemoryStore(upsertResourceMemoryRecord(store, target, { status, note, runbookUrl }));
  };
  const clear = () => {
    const store = loadResourceMemoryStore();
    saveResourceMemoryStore(removeResourceMemoryRecord(store, target));
  };

  return (
    <Section
      title="Operator notes"
      dividerPlacement="content"
      actions={record ? <Chip size="small" color={statusColor(record.status)} variant="outlined" label={statusLabel(record.status)} /> : null}
      sx={{
        borderColor: hasContent ? "warning.main" : "var(--panel-border)",
        bgcolor: hasContent ? "rgba(255, 193, 7, 0.06)" : undefined,
      }}
    >
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: { xs: "stretch", sm: "flex-start" } }}>
        <FormControl size="small" sx={{ flex: "0 0 220px" }}>
          <InputLabel id="resource-memory-status-label">
            {labelWithHint("Triage state", "How operators should treat this object.")}
          </InputLabel>
          <Select
            labelId="resource-memory-status-label"
            label={labelWithHint("Triage state", "How operators should treat this object.")}
            value={status}
            onChange={(event) => setStatus(event.target.value as ResourceMemoryStatus)}
          >
            {statusOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          label={labelWithHint("Reference link", "Optional link to the procedure, runbook, ticket, dashboard, or external context.")}
          value={runbookUrl}
          onChange={(event) => setRunbookUrl(event.target.value)}
          placeholder="Runbook, dashboard, ticket, or docs URL"
          slotProps={{ inputLabel: { shrink: true } }}
          sx={{ flexGrow: 1, minWidth: 260 }}
        />
      </Stack>
      <TextField
        size="small"
        label={labelWithHint("Operator note", "Local note for this context/resource only; not written to Kubernetes.")}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Why this object matters, what is known, or what to check next"
        multiline
        minRows={5}
        maxRows={12}
        slotProps={{ inputLabel: { shrink: true } }}
        sx={{ mt: 1, width: "100%" }}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mt: 1, alignItems: "center", justifyContent: "flex-end" }}>
        <AppButton intent="primary" onClick={save} disabled={!dirty && Boolean(record)}>
          Save notes
        </AppButton>
        <AppButton onClick={clear} disabled={!record}>
          Clear
        </AppButton>
      </Stack>
      {record ? (
        <>
          <Divider sx={{ my: 0.75 }} />
          <Stack direction="row" spacing={1} sx={{ minWidth: 0, alignItems: "center" }}>
            <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
              Updated {formatUpdatedAt(record.updatedAt)} · local browser notes for {target.context}
            </Typography>
            {record.runbookUrl ? (
              <Link href={record.runbookUrl} target="_blank" rel="noreferrer" variant="caption" sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                Runbook <OpenInNewIcon fontSize="inherit" />
              </Link>
            ) : null}
          </Stack>
        </>
      ) : null}
    </Section>
  );
}
