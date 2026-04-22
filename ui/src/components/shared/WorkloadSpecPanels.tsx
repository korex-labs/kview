import React, { useMemo } from "react";
import { Box, Chip, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from "@mui/material";
import { panelBoxSx } from "../../theme/sxTokens";
import { valueOrDash } from "../../utils/format";
import Section from "./Section";
import EmptyState from "./EmptyState";
import KeyValueTable from "./KeyValueTable";
import ResourceLinkChip from "./ResourceLinkChip";
import ContainerImageLabel from "./ContainerImageLabel";

type ContainerSummary = {
  name: string;
  image?: string;
  cpuRequest?: string;
  cpuLimit?: string;
  memoryRequest?: string;
  memoryLimit?: string;
};

type PodTemplateSummary = {
  containers?: ContainerSummary[];
  initContainers?: ContainerSummary[];
  imagePullSecrets?: string[];
};

type Toleration = {
  key?: string;
  operator?: string;
  value?: string;
  effect?: string;
  seconds?: number;
};

type TopologySpreadConstraint = {
  maxSkew: number;
  topologyKey?: string;
  whenUnsatisfiable?: string;
  labelSelector?: string;
};

type Scheduling = {
  nodeSelector?: Record<string, string>;
  affinitySummary?: string;
  tolerations?: Toleration[];
  topologySpreadConstraints?: TopologySpreadConstraint[];
};

type Volume = {
  name: string;
  type?: string;
  source?: string;
};

type MissingReference = {
  kind: string;
  name: string;
  source?: string;
};

type Props = {
  template: PodTemplateSummary | undefined;
  scheduling: Scheduling | undefined;
  volumes?: Volume[];
  missingReferences?: MissingReference[];
  templateTitle?: string;
  onOpenSecret?: (name: string) => void;
  onOpenConfigMap?: (name: string) => void;
};

function missingKey(kind: string, name: string) {
  return `${kind.toLowerCase()}/${name.toLowerCase()}`;
}

function ContainersTable({ containers }: { containers?: ContainerSummary[] }) {
  if (!containers?.length) return <EmptyState message="No containers defined." sx={{ mt: 0.5 }} />;
  return (
    <Table size="small" sx={{ mt: 0.5 }}>
      <TableHead>
        <TableRow>
          <TableCell>Name</TableCell>
          <TableCell>Image</TableCell>
          <TableCell>CPU Req/Lim</TableCell>
          <TableCell>Memory Req/Lim</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {containers.map((c, idx) => (
          <TableRow key={c.name || String(idx)}>
            <TableCell>{valueOrDash(c.name)}</TableCell>
            <TableCell sx={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
              <ContainerImageLabel image={c.image} />
            </TableCell>
            <TableCell>
              {valueOrDash(c.cpuRequest)} / {valueOrDash(c.cpuLimit)}
            </TableCell>
            <TableCell>
              {valueOrDash(c.memoryRequest)} / {valueOrDash(c.memoryLimit)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function MissingChip({ refInfo }: { refInfo?: MissingReference }) {
  if (!refInfo) return null;
  const title = `${refInfo.kind} ${refInfo.name} was not found in the dataplane snapshot${refInfo.source ? ` (${refInfo.source})` : ""}.`;
  return (
    <Tooltip title={title} arrow>
      <Chip size="small" color="warning" label="Missing" />
    </Tooltip>
  );
}

export default function WorkloadSpecPanels({
  template,
  scheduling,
  volumes = [],
  missingReferences = [],
  templateTitle = "Pod Template Summary",
  onOpenSecret,
  onOpenConfigMap,
}: Props) {
  const missingByKey = useMemo(() => {
    const out = new Map<string, MissingReference>();
    missingReferences.forEach((ref) => {
      if (ref.kind && ref.name) out.set(missingKey(ref.kind, ref.name), ref);
    });
    return out;
  }, [missingReferences]);

  return (
    <>
      <Box sx={panelBoxSx}>
        <Section title={templateTitle} dividerPlacement="content">
          <Typography variant="caption" color="text.secondary">
            Containers
          </Typography>
          <ContainersTable containers={template?.containers} />

          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Init Containers
            </Typography>
            <ContainersTable containers={template?.initContainers} />
          </Box>

          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Image Pull Secrets
            </Typography>
            {!template?.imagePullSecrets?.length ? (
              <EmptyState message="No image pull secrets." sx={{ mt: 0.5 }} />
            ) : (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                {template.imagePullSecrets.filter(Boolean).map((name) => (
                  <Box key={name} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <ResourceLinkChip label={name} onClick={() => onOpenSecret?.(name)} />
                    <MissingChip refInfo={missingByKey.get(missingKey("Secret", name))} />
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Section>
      </Box>

      <Box sx={panelBoxSx}>
        <Section title="Scheduling & Placement" dividerPlacement="content">
          <KeyValueTable columns={2} rows={[{ label: "Affinity", value: scheduling?.affinitySummary }]} />

          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Node Selectors
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
              {Object.entries(scheduling?.nodeSelector || {}).length === 0 ? (
                <EmptyState message="None" />
              ) : (
                Object.entries(scheduling?.nodeSelector || {}).map(([k, v]) => <Chip key={k} size="small" label={`${k}=${v}`} />)
              )}
            </Box>
          </Box>

          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Tolerations
            </Typography>
            {!scheduling?.tolerations?.length ? (
              <EmptyState message="None" sx={{ mt: 0.5 }} />
            ) : (
              <Table size="small" sx={{ mt: 0.5 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Key</TableCell>
                    <TableCell>Operator</TableCell>
                    <TableCell>Value</TableCell>
                    <TableCell>Effect</TableCell>
                    <TableCell>Seconds</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {scheduling.tolerations.map((t, idx) => (
                    <TableRow key={`${t.key ?? "toleration"}-${idx}`}>
                      <TableCell>{valueOrDash(t.key)}</TableCell>
                      <TableCell>{valueOrDash(t.operator)}</TableCell>
                      <TableCell>{valueOrDash(t.value)}</TableCell>
                      <TableCell>{valueOrDash(t.effect)}</TableCell>
                      <TableCell>{t.seconds !== undefined ? t.seconds : "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>

          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" color="text.secondary">
              Topology Spread Constraints
            </Typography>
            {!scheduling?.topologySpreadConstraints?.length ? (
              <EmptyState message="None" sx={{ mt: 0.5 }} />
            ) : (
              <Table size="small" sx={{ mt: 0.5 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Topology Key</TableCell>
                    <TableCell>Max Skew</TableCell>
                    <TableCell>When Unsatisfiable</TableCell>
                    <TableCell>Label Selector</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {scheduling.topologySpreadConstraints.map((t, idx) => (
                    <TableRow key={`${t.topologyKey ?? "topology"}-${idx}`}>
                      <TableCell>{valueOrDash(t.topologyKey)}</TableCell>
                      <TableCell>{valueOrDash(t.maxSkew)}</TableCell>
                      <TableCell>{valueOrDash(t.whenUnsatisfiable)}</TableCell>
                      <TableCell>{valueOrDash(t.labelSelector)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>
        </Section>
      </Box>

      <Box sx={panelBoxSx}>
        <Section title="Volumes" dividerPlacement="content">
          {volumes.length === 0 ? (
            <EmptyState message="No volumes defined." />
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Source</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {volumes.map((v, idx) => {
                  const isSecret = String(v.type || "").toLowerCase() === "secret";
                  const isConfigMap = String(v.type || "").toLowerCase() === "configmap";
                  const refInfo = v.source ? missingByKey.get(missingKey(isSecret ? "Secret" : "ConfigMap", v.source)) : undefined;
                  return (
                    <TableRow key={v.name || String(idx)}>
                      <TableCell>{valueOrDash(v.name)}</TableCell>
                      <TableCell>{valueOrDash(v.type)}</TableCell>
                      <TableCell>
                        {isSecret && v.source ? (
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                            <ResourceLinkChip label={v.source} onClick={() => onOpenSecret?.(v.source || "")} />
                            <MissingChip refInfo={refInfo} />
                          </Box>
                        ) : isConfigMap && v.source ? (
                          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                            <ResourceLinkChip label={v.source} onClick={() => onOpenConfigMap?.(v.source || "")} />
                            <MissingChip refInfo={refInfo} />
                          </Box>
                        ) : (
                          valueOrDash(v.source)
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Section>
      </Box>
    </>
  );
}
