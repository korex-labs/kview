import React from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  FormControlLabel,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlineOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import { fmtTimeAgo, valueOrDash } from "../../../utils/format";
import { panelBoxSx } from "../../../theme/sxTokens";
import { formatCPUMilli, formatMemoryBytes, formatPct, severityForPct } from "../../metrics/format";
import { AppButton } from "../../shared/AppActions";
import ContainerImageLabel from "../../shared/ContainerImageLabel";
import EmptyState from "../../shared/EmptyState";
import GaugeBar, { type GaugeTone } from "../../shared/GaugeBar";
import GaugeTableRow from "../../shared/GaugeTableRow";
import InfoHint from "../../shared/InfoHint";
import KeyValueTable from "../../shared/KeyValueTable";
import Section from "../../shared/Section";
import EnvValueDisplay from "./EnvValueDisplay";
import type { PodContainer, PodEphemeralContainer, Probe } from "./podDetailsTypes";

export function isContainerHealthy(ctn: PodContainer) {
  if (!ctn.ready) return false;
  if (!ctn.state) return false;
  return ctn.state === "Running";
}

export function isContainerActionAvailable(ctn: PodContainer | undefined) {
  return ctn?.state === "Running";
}

function usageGaugeTone(pct: number | undefined): GaugeTone {
  switch (severityForPct(pct)) {
    case "critical":
      return "error";
    case "warn":
      return "warning";
    default:
      return "success";
  }
}

function containerStateColor(state?: string): "success" | "warning" | "error" | "default" {
  if (!state) return "default";
  if (state === "Running") return "success";
  if (state === "Waiting") return "warning";
  if (state === "Terminated") return "error";
  return "default";
}

function formatProbeDetails(probe?: Probe) {
  if (!probe) return "-";
  const base = `${probe.type || "Probe"}`;
  const port = probe.port ? `:${probe.port}` : "";
  const path = probe.path ? `${probe.path}` : "";
  const scheme = probe.scheme ? `${probe.scheme} ` : "";
  const target = probe.command ? probe.command : `${scheme}${path}${port}`;
  return [base, target].filter(Boolean).join(" ");
}

export type PodContainersTabProps = {
  containers: PodContainer[];
  ephemeralContainers: PodEphemeralContainer[];
  qosClass?: string;
  metricsUsable: boolean;
  offline: boolean;
  creatingTerminal: boolean;
  runningCommand: boolean;
  matchingCommandCounts: Record<string, number>;
  envQueryByContainer: Record<string, string>;
  envShowRefsByContainer: Record<string, boolean>;
  envPrettyByContainer: Record<string, boolean>;
  onContainerRef: (containerName: string, node: HTMLDivElement | null) => void;
  onOpenTerminal: (containerName: string) => void;
  onOpenCommands: (containerName: string, anchor: HTMLElement) => void;
  onEnvQueryChange: (containerName: string, value: string) => void;
  onEnvShowRefsChange: (containerName: string, value: boolean) => void;
  onEnvPrettyChange: (containerName: string, value: boolean) => void;
};

export default function PodContainersTab(props: PodContainersTabProps) {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", overflow: "auto" }}>
      {props.containers.length === 0 ? (
        <EmptyState message="No containers found for this Pod." />
      ) : (
        props.containers.map((ctn, idx) => {
          const unhealthy = !isContainerHealthy(ctn);
          const containerKey = ctn.name ?? String(idx);
          const envQuery = props.envQueryByContainer[containerKey] || "";
          const showRefs = props.envShowRefsByContainer[containerKey] || false;
          const prettyEnv = props.envPrettyByContainer[containerKey] ?? true;
          const envFiltered = (ctn.env || []).filter((e) =>
            String(e.name ?? "").toLowerCase().includes(envQuery.toLowerCase())
          );

          return (
            <Box
              key={containerKey}
              ref={(node: HTMLDivElement | null) => props.onContainerRef(containerKey, node)}
              sx={{
                ...panelBoxSx,
                border: unhealthy ? "1px solid var(--chip-error-border)" : "1px solid var(--panel-border)",
              }}
            >
              <Box sx={{ pb: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", minWidth: 0, flex: "1 1 auto" }}>
                    <Typography variant="subtitle2">{valueOrDash(ctn.name)}</Typography>
                    <Chip size="small" label={ctn.state || "Unknown"} color={containerStateColor(ctn.state)} />
                    <Chip
                      size="small"
                      label={ctn.ready ? "Ready" : "Not Ready"}
                      color={ctn.ready ? "success" : "warning"}
                    />
                    <Chip size="small" label={`Restarts: ${ctn.restartCount ?? 0}`} />
                    {unhealthy && <Chip size="small" color="error" label="Attention" />}
                  </Box>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", ml: "auto" }}>
                    <AppButton
                      startIcon={<TerminalIcon />}
                      disabled={props.offline || props.creatingTerminal || !ctn.name || !isContainerActionAvailable(ctn)}
                      onClick={() => {
                        if (!ctn.name) return;
                        props.onOpenTerminal(ctn.name);
                      }}
                    >
                      Terminal
                    </AppButton>
                    <AppButton
                      startIcon={<PlayCircleOutlineIcon />}
                      disabled={
                        props.offline ||
                        props.runningCommand ||
                        !ctn.name ||
                        !isContainerActionAvailable(ctn) ||
                        (props.matchingCommandCounts[ctn.name] || 0) === 0
                      }
                      onClick={(e) => {
                        if (!ctn.name) return;
                        props.onOpenCommands(ctn.name, e.currentTarget);
                      }}
                    >
                      Commands
                    </AppButton>
                  </Box>
                </Box>
              </Box>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Section title="Runtime" dividerPlacement="content" variant="plain">
                  <KeyValueTable
                    columns={3}
                    sx={{ mt: 1 }}
                    rows={[
                      { label: "Image", value: <ContainerImageLabel image={ctn.image} imageId={ctn.imageId} /> },
                      {
                        label: "State",
                        value: ctn.state ? <Chip size="small" label={ctn.state} color={containerStateColor(ctn.state)} /> : "-",
                      },
                      { label: "Reason", value: valueOrDash(ctn.reason) },
                      {
                        label: "Message",
                        value: <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{valueOrDash(ctn.message)}</Typography>,
                      },
                      { label: "Started At", value: ctn.startedAt ? fmtTimeAgo(ctn.startedAt) : "-" },
                      { label: "Finished At", value: ctn.finishedAt ? fmtTimeAgo(ctn.finishedAt) : "-" },
                      { label: "Last Termination Reason", value: valueOrDash(ctn.lastTerminationReason) },
                      {
                        label: "Last Termination Message",
                        value: <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{valueOrDash(ctn.lastTerminationMessage)}</Typography>,
                      },
                      { label: "Last Termination At", value: ctn.lastTerminationAt ? fmtTimeAgo(ctn.lastTerminationAt) : "-" },
                    ]}
                  />
                </Section>

                <Section title="Resources" dividerPlacement="content" variant="plain">
                  <KeyValueTable
                    columns={2}
                    sx={{ mt: 1 }}
                    rows={[
                      {
                        label: "CPU Requests / Limits",
                        value: `${valueOrDash(ctn.resources?.cpuRequest)} / ${valueOrDash(ctn.resources?.cpuLimit)}`,
                      },
                      {
                        label: "Memory Requests / Limits",
                        value: `${valueOrDash(ctn.resources?.memoryRequest)} / ${valueOrDash(ctn.resources?.memoryLimit)}`,
                      },
                      { label: "QoS Impact", value: valueOrDash(props.qosClass) },
                    ]}
                  />
                </Section>

                {props.metricsUsable && ctn.usage ? (
                  <Section title="Usage" dividerPlacement="content" variant="plain">
                    {(() => {
                      const u = ctn.usage!;
                      const cpuPct = u.cpuPctLimit ?? u.cpuPctRequest;
                      const memPct = u.memoryPctLimit ?? u.memoryPctRequest;
                      const cpuAnchor = u.cpuPctLimit != null ? "limit" : u.cpuPctRequest != null ? "request" : "";
                      const memAnchor = u.memoryPctLimit != null ? "limit" : u.memoryPctRequest != null ? "request" : "";
                      return (
                        <Box sx={{ mt: 1 }}>
                          <GaugeTableRow
                            label="CPU"
                            hint={cpuAnchor ? `Percentage of ${cpuAnchor}; sourced from metrics.k8s.io.` : "Live usage from metrics.k8s.io."}
                            bar={cpuPct != null && cpuPct > 0 ? <GaugeBar value={cpuPct} tone={usageGaugeTone(cpuPct)} /> : <Box sx={{ fontSize: 12, color: "text.secondary" }}>No request/limit set</Box>}
                            summary={cpuPct != null && cpuPct > 0 ? `${formatPct(cpuPct)} / ${formatCPUMilli(u.cpuMilli)}` : formatCPUMilli(u.cpuMilli)}
                          />
                          <GaugeTableRow
                            label="Memory"
                            hint={memAnchor ? `Percentage of ${memAnchor}; sourced from metrics.k8s.io.` : "Live usage from metrics.k8s.io."}
                            bar={memPct != null && memPct > 0 ? <GaugeBar value={memPct} tone={usageGaugeTone(memPct)} /> : <Box sx={{ fontSize: 12, color: "text.secondary" }}>No request/limit set</Box>}
                            summary={memPct != null && memPct > 0 ? `${formatPct(memPct)} / ${formatMemoryBytes(u.memoryBytes)}` : formatMemoryBytes(u.memoryBytes)}
                          />
                        </Box>
                      );
                    })()}
                  </Section>
                ) : null}

                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", width: "100%" }}>
                      <Typography variant="subtitle2">Environment</Typography>
                      <Chip size="small" label={(ctn.env || []).length} />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 1 }}>
                      <TextField
                        size="small"
                        label="Filter"
                        value={envQuery}
                        onChange={(e) => props.onEnvQueryChange(containerKey, e.target.value)}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={showRefs}
                            slotProps={{ input: { "aria-label": "Show environment source references" } }}
                            onChange={(e) => props.onEnvShowRefsChange(containerKey, e.target.checked)}
                          />
                        }
                        label={
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <span>Show references</span>
                            <InfoHint title="Shows the exact env source reference, such as config-map:key, secret:key, metadata.name, or a resource field. This does not resolve ConfigMap or Secret contents; literal values are always shown." />
                          </Box>
                        }
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={prettyEnv}
                            slotProps={{ input: { "aria-label": "Pretty environment values" } }}
                            onChange={(e) => props.onEnvPrettyChange(containerKey, e.target.checked)}
                          />
                        }
                        label={
                          <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                            <span>Pretty</span>
                            <InfoHint title="Decorates exact boolean-like values, debug and log-level strings with themed chips, and turns http:// or https:// values into clickable links. Plain mode preserves text-only rendering." />
                          </Box>
                        }
                      />
                    </Box>
                    {(ctn.env || []).length === 0 ? (
                      <EmptyState message="No environment variables." sx={{ mt: 1 }} />
                    ) : envFiltered.length === 0 ? (
                      <EmptyState message="No environment variables match the filter." sx={{ mt: 1 }} />
                    ) : (
                      <Table size="small" sx={{ mt: 1 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>Name</TableCell>
                            <TableCell>{showRefs ? "Value / Reference" : "Value"}</TableCell>
                            <TableCell>Source</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {envFiltered.map((e, envIdx) => (
                            <TableRow key={`${containerKey}-env-${e.name ?? envIdx}`}>
                              <TableCell>{valueOrDash(e.name)}</TableCell>
                              <TableCell>
                                <EnvValueDisplay
                                  value={e.source === "Value" ? e.value : showRefs ? e.sourceRef : undefined}
                                  pretty={prettyEnv}
                                />
                              </TableCell>
                              <TableCell>
                                {e.source === "Value" ? "Literal" : valueOrDash(e.source)}
                                {e.optional ? " (optional)" : ""}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </AccordionDetails>
                </Accordion>

                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", width: "100%" }}>
                      <Typography variant="subtitle2">Mounts & Volumes</Typography>
                      <Chip size="small" label={(ctn.mounts || []).length} />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    {(ctn.mounts || []).length === 0 ? (
                      <EmptyState message="No mounts defined." sx={{ mt: 1 }} />
                    ) : (
                      <Table size="small" sx={{ mt: 1 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>Mount Path</TableCell>
                            <TableCell>Volume</TableCell>
                            <TableCell>Mode</TableCell>
                            <TableCell>SubPath</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(ctn.mounts || []).map((m, mountIdx) => (
                            <TableRow key={`${containerKey}-${m.mountPath ?? mountIdx}`}>
                              <TableCell>{valueOrDash(m.mountPath)}</TableCell>
                              <TableCell>{valueOrDash(m.name)}</TableCell>
                              <TableCell>{m.readOnly === undefined ? "-" : m.readOnly ? "ReadOnly" : "ReadWrite"}</TableCell>
                              <TableCell>{valueOrDash(m.subPath)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </AccordionDetails>
                </Accordion>

                <Accordion>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", width: "100%" }}>
                      <Typography variant="subtitle2">Probes</Typography>
                      <Chip size="small" label={[ctn.probes?.liveness, ctn.probes?.readiness, ctn.probes?.startup].filter(Boolean).length} />
                    </Box>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Table size="small" sx={{ mt: 1 }}>
                      <TableHead>
                        <TableRow>
                          <TableCell>Probe</TableCell>
                          <TableCell>Type / Target</TableCell>
                          <TableCell>Initial Delay</TableCell>
                          <TableCell>Period</TableCell>
                          <TableCell>Timeout</TableCell>
                          <TableCell>Failure / Success</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {[
                          { label: "Liveness", probe: ctn.probes?.liveness },
                          { label: "Readiness", probe: ctn.probes?.readiness },
                          { label: "Startup", probe: ctn.probes?.startup },
                        ].map((p) => (
                          <TableRow key={`${containerKey}-${p.label}`}>
                            <TableCell>{p.label}</TableCell>
                            <TableCell>{formatProbeDetails(p.probe)}</TableCell>
                            <TableCell>{p.probe?.initialDelaySeconds ?? "-"}</TableCell>
                            <TableCell>{p.probe?.periodSeconds ?? "-"}</TableCell>
                            <TableCell>{p.probe?.timeoutSeconds ?? "-"}</TableCell>
                            <TableCell>{p.probe ? `${p.probe.failureThreshold ?? "-"} / ${p.probe.successThreshold ?? "-"}` : "-"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </AccordionDetails>
                </Accordion>
              </Box>
            </Box>
          );
        })
      )}
      {props.ephemeralContainers.length > 0 ? (
        <Section title="Ephemeral Containers" dividerPlacement="content">
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Ephemeral containers cannot be removed or changed after Kubernetes adds them. Terminated entries remain until the Pod is recreated.
          </Alert>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {props.ephemeralContainers.map((ephemeral) => (
              <Box key={ephemeral.name} sx={panelBoxSx}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 1 }}>
                  <Typography variant="subtitle2">{ephemeral.name}</Typography>
                  <Chip size="small" label="Ephemeral" variant="outlined" />
                  <Chip size="small" label={ephemeral.state || "Pending"} color={containerStateColor(ephemeral.state)} />
                </Box>
                <KeyValueTable
                  columns={2}
                  rows={[
                    { label: "Image", value: <ContainerImageLabel image={ephemeral.image} imageId={ephemeral.imageId} /> },
                    { label: "Target Container", value: valueOrDash(ephemeral.targetContainer) },
                    { label: "Reason", value: valueOrDash(ephemeral.reason) },
                    { label: "Message", value: valueOrDash(ephemeral.message) },
                    { label: "Started At", value: ephemeral.startedAt ? fmtTimeAgo(ephemeral.startedAt) : "-" },
                    { label: "Finished At", value: ephemeral.finishedAt ? fmtTimeAgo(ephemeral.finishedAt) : "-" },
                    { label: "Exit Code", value: ephemeral.state === "Terminated" ? ephemeral.exitCode ?? "-" : "-" },
                  ]}
                />
              </Box>
            ))}
          </Box>
        </Section>
      ) : null}
    </Box>
  );
}
