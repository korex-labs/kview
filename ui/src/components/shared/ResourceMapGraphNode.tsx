import React from "react";
import { Box, ButtonBase, Chip, Divider, Stack, Tooltip, Typography } from "@mui/material";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ResourceMapNode } from "../../types/api";
import { isPodGroupNode } from "./resourceOwnershipPresentation";
import ResourceIcon from "../icons/resources/ResourceIcon";
import { isResourceIconName } from "../../utils/k8sResources";
import { resourceMapEdgeLabel, resourceMapIdentityLabel, type ResourceMapFlowNode } from "./resourceMapGraphModel";

function availabilityColor(availability: ResourceMapNode["availability"]): "success" | "warning" | "default" {
  if (availability === "present") return "success";
  if (availability === "missing") return "warning";
  return "default";
}

function roleLabel(direction: ResourceMapNode["direction"]): string {
  switch (direction) {
    case "current": return "Current resource";
    case "parent": return "Parent or dependency";
    case "child": return "Child or dependant";
    case "both": return "Parent and child relation";
  }
}

function relationshipSummary(data: ResourceMapFlowNode["data"]): string[] {
  const counts = new Map<string, number>();
  for (const edge of [...data.incoming, ...data.outgoing]) {
    const label = resourceMapEdgeLabel(edge.type);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, count]) => `${label}: ${count}`);
}

function handleOffset(index: number, count: number): string {
  return `${12 + (76 * (index + 1)) / (count + 1)}%`;
}

function handleStyle(index: number, count: number, position: Position, routeOffset?: number): React.CSSProperties {
  const offset = routeOffset === undefined ? handleOffset(index, count) : `${routeOffset}%`;
  const axis = position === Position.Left || position === Position.Right ? "top" : "left";
  return { [axis]: offset, opacity: 0, pointerEvents: "none" };
}

export default function ResourceMapGraphNode({ data }: NodeProps<ResourceMapFlowNode>) {
  const { resourceNode } = data;
  if (isPodGroupNode(resourceNode)) {
    const { group, expanded, owner } = resourceNode;
    return <>
      {data.incoming.map((edge, index) => <Handle key={edge.id} id={`target-${edge.id}`} type="target" position={data.incomingHandlePositions[edge.id] || Position.Left} isConnectable={false} style={handleStyle(index, data.incoming.length, data.incomingHandlePositions[edge.id] || Position.Left, data.incomingHandleOffsets[edge.id])} />)}
      <ButtonBase className="nodrag" aria-label={`${expanded ? "Collapse" : "Expand"} Pods owned by ${owner.kind} ${owner.name}`} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); data.onToggleGroup?.(group.id); }} sx={{ width: "100%", height: "100%", p: 1, border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", textAlign: "left", display: "block", "&.Mui-focusVisible": { outline: "3px solid", outlineColor: "primary.main" } }}>
        <Typography variant="subtitle2">Pods · {group.countComplete ? "" : "at least "}{group.observedCount} observed</Typography>
        <Typography variant="caption" sx={{ display: "block" }}>{expanded ? `Collapse · ${resourceNode.visibleMembers} visible` : "Expand · Collapsed"} · {Math.min(10, group.members.length)} cached members{group.membersTruncated || group.members.length > 10 ? " (sample limited)" : ""}</Typography>
        <Typography variant="caption" sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={Object.entries(group.states).map(([state, count]) => `${state}: ${count}`).join(" · ")}>{Object.entries(group.states).sort(([a], [b]) => a.localeCompare(b)).map(([state, count]) => `${state}: ${count}`).join(" · ")}</Typography>
      </ButtonBase>
      {data.outgoing.map((edge, index) => <Handle key={edge.id} id={`source-${edge.id}`} type="source" position={data.outgoingHandlePositions[edge.id] || Position.Right} isConnectable={false} style={handleStyle(index, data.outgoing.length, data.outgoingHandlePositions[edge.id] || Position.Right, data.outgoingHandleOffsets[edge.id])} />)}
    </>;
  }
  const identity = resourceNode.identity;
  const iconName = isResourceIconName(identity.resource)
    ? identity.resource
    : identity.scope === "cluster" ? "clusterresources" : "customresources";
  const relationships = relationshipSummary(data);
  const accessibleLabel = resourceNode.replicaSet
    ? `${identity.kind}: ${identity.name}, revision ${resourceNode.replicaSet.revision}, desired ${resourceNode.replicaSet.desired}, ready ${resourceNode.replicaSet.ready}`
    : `${identity.kind}: ${identity.name}`;
  const open = () => {
    if (data.uiNavigable) data.onOpenResource?.(identity);
  };

  const tooltip = (
    <Stack spacing={0.75} sx={{ maxWidth: 360, py: 0.25 }}>
      <Typography variant="subtitle2" sx={{ overflowWrap: "anywhere" }}>{resourceMapIdentityLabel(identity)}</Typography>
      <Typography variant="caption">{roleLabel(resourceNode.direction)} · depth {resourceNode.depth}</Typography>
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Chip size="small" label={resourceNode.availability} color={availabilityColor(resourceNode.availability)} />
        {resourceNode.current ? <Chip size="small" label="current" color="primary" /> : null}
        {data.cacheFreshness ? <Chip size="small" label={`${data.cacheFreshness} cache`} variant="outlined" /> : null}
        {data.coveragePartial ? <Chip size="small" label="partial relationship coverage" color="warning" variant="outlined" /> : null}
      </Stack>
      {resourceNode.replicaSet ? (
        <Typography variant="caption">
          Revision {resourceNode.replicaSet.revision} · desired {resourceNode.replicaSet.desired} · ready {resourceNode.replicaSet.ready}
        </Typography>
      ) : null}
      {relationships.length ? <><Divider /><Typography variant="caption">{relationships.join(" · ")}</Typography></> : null}
      <Typography variant="caption" color="inherit">
        {data.uiNavigable ? "Select to open this resource." : resourceNode.current ? "Current resource." : "No supported cached drawer is available."}
      </Typography>
    </Stack>
  );

  return (
    <>
      {data.incoming.map((edge, index) => (
        <Handle
          key={`target-${edge.id}`}
          id={`target-${edge.id}`}
          type="target"
          position={data.incomingHandlePositions[edge.id] || Position.Top}
          isConnectable={false}
          style={handleStyle(
            index,
            data.incoming.length,
            data.incomingHandlePositions[edge.id] || Position.Top,
            data.incomingHandleOffsets[edge.id],
          )}
        />
      ))}
      <Tooltip title={tooltip} arrow describeChild enterDelay={250} placement="top">
        <ButtonBase
          aria-label={accessibleLabel}
          aria-disabled={!data.uiNavigable}
          data-direction={resourceNode.direction}
          data-depth={resourceNode.depth}
          onClick={(event) => {
            event.stopPropagation();
            open();
          }}
          sx={{
            width: "100%",
            height: "100%",
            display: "block",
            textAlign: "left",
            px: 1.25,
            py: 1,
            border: 1.5,
            borderColor: resourceNode.current ? "primary.main" : resourceNode.availability === "present" ? "divider" : "text.disabled",
            borderStyle: resourceNode.availability === "present" ? "solid" : "dashed",
            borderRadius: 1.5,
            bgcolor: resourceNode.current ? "action.selected" : "background.paper",
            boxShadow: resourceNode.current ? 3 : 1,
            opacity: resourceNode.availability === "present" ? 1 : 0.76,
            cursor: data.uiNavigable ? "pointer" : "default",
            "&:hover": { borderColor: data.uiNavigable ? "primary.main" : undefined, boxShadow: data.uiNavigable ? 3 : 1 },
            "&.Mui-focusVisible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: 3 },
          }}
        >
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
            <ResourceIcon name={iconName} size={18} sx={{ flexShrink: 0, color: resourceNode.current ? "primary.main" : "text.secondary" }} />
            <Typography component="span" variant="caption" sx={{ fontWeight: 800, minWidth: 0 }}>
              {identity.kind}{resourceNode.replicaSet ? ` · rev ${resourceNode.replicaSet.revision}` : ""}
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Chip size="small" label={resourceNode.availability} color={availabilityColor(resourceNode.availability)} sx={{ height: 19, "& .MuiChip-label": { px: 0.75, fontSize: "0.65rem" } }} />
          </Stack>
          {identity.namespace ? (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {identity.namespace}
            </Typography>
          ) : null}
          <Typography
            component="span"
            variant="caption"
            sx={{
              display: "-webkit-box",
              mt: identity.namespace ? 0 : 0.45,
              fontWeight: 600,
              lineHeight: 1.2,
              overflow: "hidden",
              overflowWrap: "anywhere",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: identity.namespace ? 3 : 4,
            }}
          >
            {identity.name}
          </Typography>
        </ButtonBase>
      </Tooltip>
      {data.outgoing.map((edge, index) => (
        <Handle
          key={`source-${edge.id}`}
          id={`source-${edge.id}`}
          type="source"
          position={data.outgoingHandlePositions[edge.id] || Position.Bottom}
          isConnectable={false}
          style={handleStyle(
            index,
            data.outgoing.length,
            data.outgoingHandlePositions[edge.id] || Position.Bottom,
            data.outgoingHandleOffsets[edge.id],
          )}
        />
      ))}
    </>
  );
}
