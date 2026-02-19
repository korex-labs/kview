import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Drawer,
  Typography,
  Tabs,
  Tab,
  IconButton,
  Divider,
  CircularProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { apiGet } from "../api";
import { useConnectionState } from "../connectionState";
import { fmtAge, fmtTs, valueOrDash } from "../utils/format";
import { detectLanguageFromKey } from "../utils/syntaxDetect";
import Section from "./shared/Section";
import KeyValueTable from "./shared/KeyValueTable";
import EmptyState from "./shared/EmptyState";
import ErrorState from "./shared/ErrorState";
import MetadataSection from "./shared/MetadataSection";
import EventsList from "./shared/EventsList";
import CodeBlock from "./shared/CodeBlock";
import ConfigMapActions from "./ConfigMapActions";

type ConfigMapDetails = {
  summary: ConfigMapSummary;
  keys: ConfigMapKey[];
  keyNames: string[];
  metadata: ConfigMapMetadata;
  yaml: string;
};

type ConfigMapSummary = {
  name: string;
  namespace: string;
  immutable?: boolean;
  dataKeysCount: number;
  binaryKeysCount: number;
  keysCount: number;
  totalBytes?: number;
  createdAt?: number;
  ageSec?: number;
};

type ConfigMapKey = {
  name: string;
  type: string;
  sizeBytes: number;
};

type ConfigMapMetadata = {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

type EventDTO = {
  type: string;
  reason: string;
  message: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

function formatImmutable(val?: boolean) {
  if (val === undefined || val === null) return "-";
  return val ? "Yes" : "No";
}

function formatBytes(bytes?: number) {
  if (bytes === undefined || bytes === null) return "-";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

const MAX_VALUE_PREVIEW_CHARS = 4096;

type ParsedDataValue = {
  value: string;
  truncated: boolean;
};

function appendWithLimit(current: ParsedDataValue, chunk: string, limit: number) {
  if (current.truncated) return;
  const remaining = limit - current.value.length;
  if (remaining <= 0) {
    current.truncated = true;
    return;
  }
  if (chunk.length <= remaining) {
    current.value += chunk;
  } else {
    current.value += chunk.slice(0, remaining);
    current.truncated = true;
  }
}

function extractConfigMapDataValues(
  yaml: string,
  limit: number
): { values: Record<string, ParsedDataValue>; error: string } {
  try {
    const values: Record<string, ParsedDataValue> = {};
    const lines = yaml.split(/\r?\n/);
    let inData = false;
    let dataIndent = 0;
    let currentKey: string | null = null;
    let currentIndent = 0;
    let collectingMultiline = false;
    let multilineIndent: number | null = null;
    let firstMultilineLine = true;

    const finalizeCurrent = () => {
      if (currentKey) {
        values[currentKey] = values[currentKey] ?? { value: "", truncated: false };
      }
      currentKey = null;
      collectingMultiline = false;
      multilineIndent = null;
      firstMultilineLine = true;
    };

    for (let i = 0; i < lines.length; i++) {
      const rawLine = lines[i];
      const indentMatch = rawLine.match(/^ */);
      const indent = indentMatch ? indentMatch[0].length : 0;
      const trimmed = rawLine.trim();

      if (!inData) {
        if (trimmed === "data:" || trimmed.startsWith("data:")) {
          const dataMatch = rawLine.match(/^(\s*)data:\s*$/);
          if (dataMatch) {
            inData = true;
            dataIndent = dataMatch[1]?.length ?? 0;
          }
        }
        continue;
      }

      if (trimmed === "" && collectingMultiline) {
        const entry = values[currentKey || ""];
        if (entry) {
          if (!firstMultilineLine) appendWithLimit(entry, "\n", limit);
          firstMultilineLine = false;
        }
        continue;
      }

      if (trimmed !== "" && indent <= dataIndent) {
        finalizeCurrent();
        inData = false;
        continue;
      }

      if (collectingMultiline) {
        if (indent <= currentIndent) {
          finalizeCurrent();
          i -= 1;
          continue;
        }
        if (multilineIndent === null) {
          multilineIndent = indent;
        }
        const entry = values[currentKey || ""];
        if (entry) {
          const content = rawLine.slice(Math.min(multilineIndent, rawLine.length));
          if (!firstMultilineLine) appendWithLimit(entry, "\n", limit);
          appendWithLimit(entry, content, limit);
          firstMultilineLine = false;
        }
        continue;
      }

      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = rawLine.match(/^(\s*)([^:]+):\s*(.*)$/);
      if (!match) continue;
      const keyIndent = match[1]?.length ?? 0;
      if (keyIndent <= dataIndent) {
        finalizeCurrent();
        inData = false;
        continue;
      }

      const key = match[2]?.trim() ?? "";
      const rest = match[3] ?? "";
      currentKey = key;
      currentIndent = keyIndent;
      values[currentKey] = values[currentKey] ?? { value: "", truncated: false };

      if (rest === "|" || rest === "|-" || rest === "|+" || rest === ">" || rest === ">-" || rest === ">+") {
        collectingMultiline = true;
        multilineIndent = null;
        firstMultilineLine = true;
        continue;
      }

      appendWithLimit(values[currentKey], rest, limit);
      finalizeCurrent();
    }

    finalizeCurrent();
    return { values, error: "" };
  } catch (err) {
    return { values: {}, error: `Unable to parse data values: ${String(err)}` };
  }
}

export default function ConfigMapDrawer(props: {
  open: boolean;
  onClose: () => void;
  token: string;
  namespace: string;
  configMapName: string | null;
}) {
  const { retryNonce } = useConnectionState();
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [details, setDetails] = useState<ConfigMapDetails | null>(null);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [err, setErr] = useState("");
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const ns = props.namespace;
  const name = props.configMapName;

  useEffect(() => {
    if (!props.open || !name) return;

    setTab(0);
    setErr("");
    setDetails(null);
    setEvents([]);
    setExpandedKeys({});
    setLoading(true);

    (async () => {
      const det = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/configmaps/${encodeURIComponent(name)}`,
        props.token
      );
      const item: ConfigMapDetails | null = det?.item ?? null;
      setDetails(item);

      const ev = await apiGet<any>(
        `/api/namespaces/${encodeURIComponent(ns)}/configmaps/${encodeURIComponent(name)}/events`,
        props.token
      );
      setEvents(ev?.items || []);
    })()
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [props.open, name, ns, props.token, retryNonce]);

  const summary = details?.summary;
  const metadata = details?.metadata;

  const summaryItems = useMemo(
    () => [
      { label: "Name", value: valueOrDash(summary?.name), monospace: true },
      { label: "Namespace", value: valueOrDash(summary?.namespace) },
      { label: "Keys", value: valueOrDash(summary?.keysCount) },
      { label: "Data keys", value: valueOrDash(summary?.dataKeysCount) },
      { label: "Binary keys", value: valueOrDash(summary?.binaryKeysCount) },
      { label: "Immutable", value: formatImmutable(summary?.immutable) },
      { label: "Age", value: fmtAge(summary?.ageSec) },
      { label: "Created", value: summary?.createdAt ? fmtTs(summary.createdAt) : "-" },
    ],
    [summary]
  );

  const hasKeys = (details?.keys || []).length > 0;
  const showSize = summary?.totalBytes !== undefined;
  const dataValues = useMemo(() => {
    if (tab !== 1 || !details?.yaml) return { values: {}, error: "" };
    return extractConfigMapDataValues(details.yaml, MAX_VALUE_PREVIEW_CHARS);
  }, [tab, details?.yaml]);

  return (
    <Drawer
      anchor="right"
      open={props.open}
      onClose={props.onClose}
      PaperProps={{
        sx: {
          mt: 8,
          height: "calc(100% - 64px)",
          borderTopLeftRadius: 8,
          borderBottomLeftRadius: 8,
        },
      }}
    >
      <Box sx={{ width: 820, p: 2, display: "flex", flexDirection: "column", height: "100%" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            ConfigMap: {name || "-"}{" "}
            <Typography component="span" variant="body2">
              ({ns})
            </Typography>
          </Typography>
          <IconButton onClick={props.onClose}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ my: 1 }} />

        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
            <CircularProgress />
          </Box>
        ) : err ? (
          <ErrorState message={err} />
        ) : (
          <>
            <Tabs value={tab} onChange={(_, v) => setTab(v)}>
              <Tab label="Overview" />
              <Tab label="Keys" />
              <Tab label="Events" />
              <Tab label="YAML" />
            </Tabs>

            <Box sx={{ mt: 2, flexGrow: 1, minHeight: 0, overflow: "hidden" }}>
              {/* OVERVIEW */}
              {tab === 0 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2, height: "100%", overflow: "auto" }}>
                  {name && (
                    <Section title="Actions" divider={false}>
                      <ConfigMapActions
                        token={props.token}
                        namespace={ns}
                        configMapName={name}
                        onDeleted={props.onClose}
                      />
                    </Section>
                  )}

                  <Box sx={{ border: "1px solid #ddd", borderRadius: 2, p: 1.5 }}>
                    <KeyValueTable rows={summaryItems} columns={3} />
                  </Box>

                  <MetadataSection labels={metadata?.labels} annotations={metadata?.annotations} />

                  {showSize && (
                    <Section title="Size">
                      <KeyValueTable
                        columns={2}
                        sx={{ mt: 1 }}
                        rows={[
                          { label: "Total", value: formatBytes(summary?.totalBytes) },
                        ]}
                      />
                    </Section>
                  )}
                </Box>
              )}

              {/* KEYS */}
              {tab === 1 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  {!hasKeys ? (
                    <EmptyState message="No keys found for this ConfigMap." />
                  ) : (
                    (details?.keys || []).map((k, idx) => {
                      const keyId = `${k.type || "data"}:${k.name || idx}`;
                      const isBinary = k.type === "binaryData";
                      const dataValue = dataValues.values[k.name];
                      const showValue = !isBinary && dataValue;
                      const truncated = showValue ? dataValue.truncated : false;

                      return (
                        <Accordion
                          key={keyId}
                          expanded={!!expandedKeys[keyId]}
                          onChange={() =>
                            setExpandedKeys((prev) => ({
                              ...prev,
                              [keyId]: !prev[keyId],
                            }))
                          }
                        >
                          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", flexGrow: 1 }}>
                              <Typography variant="subtitle2" sx={{ fontFamily: "monospace" }}>
                                {valueOrDash(k.name)}
                              </Typography>
                              {k.type && <Chip size="small" label={k.type} />}
                              {k.sizeBytes !== undefined && <Chip size="small" label={formatBytes(k.sizeBytes)} />}
                            </Box>
                          </AccordionSummary>
                          <AccordionDetails>
                            {isBinary ? (
                              <Box
                                sx={{
                                  border: "1px solid #ddd",
                                  borderRadius: 2,
                                  p: 1,
                                  backgroundColor: "#fafafa",
                                  fontFamily: "monospace",
                                  whiteSpace: "pre-wrap",
                                  fontSize: "0.8125rem",
                                }}
                              >
                                Binary data (base64) — see YAML tab.
                              </Box>
                            ) : dataValues.error ? (
                              <ErrorState message={`${dataValues.error}\nSee full content in YAML tab.`} />
                            ) : dataValue ? (
                              <>
                                {truncated && (
                                  <Typography variant="caption" color="text.secondary">
                                    Showing first {MAX_VALUE_PREVIEW_CHARS} characters… See full content in YAML tab.
                                  </Typography>
                                )}
                                <Box sx={{ mt: truncated ? 0.5 : 0 }}>
                                  <CodeBlock code={dataValue.value} language={detectLanguageFromKey(k.name)} showCopy />
                                </Box>
                              </>
                            ) : (
                              <Typography variant="body2" color="text.secondary">
                                Value not available. See YAML tab.
                              </Typography>
                            )}
                          </AccordionDetails>
                        </Accordion>
                      );
                    })
                  )}
                </Box>
              )}

              {/* EVENTS */}
              {tab === 2 && (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", overflow: "auto" }}>
                  <EventsList events={events} emptyMessage="No events found for this ConfigMap." />
                </Box>
              )}

              {/* YAML */}
              {tab === 3 && (
                <CodeBlock code={details?.yaml || ""} language="yaml" />
              )}
            </Box>
          </>
        )}
      </Box>
    </Drawer>
  );
}
