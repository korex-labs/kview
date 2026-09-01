import React, { useState } from "react";
import { Box, Chip, Divider, Stack, Tooltip, Typography } from "@mui/material";
import { BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import { resourceMapEdgeLabel, resourceMapIdentityLabel, type ResourceMapFlowEdge } from "./resourceMapGraphModel";

function selectorText(selector?: Record<string, string>): string {
  if (!selector) return "";
  return Object.entries(selector).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join(", ");
}

type RoutePoint = { x: number; y: number };

function pointDistance(a: RoutePoint, b: RoutePoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function routedPoints(source: RoutePoint, target: RoutePoint, points: RoutePoint[]): RoutePoint[] {
  return [source, ...points.slice(1, -1), target].filter((point, index, all) => (
    index === 0 || pointDistance(all[index - 1], point) > 0.1
  ));
}

function roundedPolylinePath(points: RoutePoint[], radius = 10): string {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const beforeLength = pointDistance(previous, current);
    const afterLength = pointDistance(current, next);
    const beforeRatio = Math.min(radius, beforeLength / 2) / beforeLength;
    const afterRatio = Math.min(radius, afterLength / 2) / afterLength;
    const before = {
      x: current.x + (previous.x - current.x) * beforeRatio,
      y: current.y + (previous.y - current.y) * beforeRatio,
    };
    const after = {
      x: current.x + (next.x - current.x) * afterRatio,
      y: current.y + (next.y - current.y) * afterRatio,
    };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  const last = points[points.length - 1];
  return `${path} L ${last.x} ${last.y}`;
}

function polylineMidpoint(points: RoutePoint[]): RoutePoint {
  const segments = points.slice(1).map((point, index) => pointDistance(points[index], point));
  const halfway = segments.reduce((sum, length) => sum + length, 0) / 2;
  let traversed = 0;
  for (let index = 0; index < segments.length; index += 1) {
    if (traversed + segments[index] >= halfway) {
      const ratio = segments[index] ? (halfway - traversed) / segments[index] : 0;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    traversed += segments[index];
  }
  return points[points.length - 1];
}

export default function ResourceMapGraphEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  data,
}: EdgeProps<ResourceMapFlowEdge>) {
  const [labelActive, setLabelActive] = useState(false);
  const pathOptions = { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition };
  let path: string;
  let labelX: number;
  let labelY: number;
  if (data?.routePoints.length && !data.selfLoop) {
    const points = routedPoints({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, data.routePoints);
    const midpoint = polylineMidpoint(points);
    path = roundedPolylinePath(points);
    labelX = midpoint.x;
    labelY = midpoint.y;
  } else if (data?.selfLoop) {
    const loopX = Math.max(sourceX, targetX) + 72;
    path = `M ${sourceX} ${sourceY} C ${loopX} ${sourceY} ${loopX} ${targetY} ${targetX} ${targetY}`;
    labelX = loopX;
    labelY = (sourceY + targetY) / 2;
  } else {
    [path, labelX, labelY] = getSmoothStepPath({ ...pathOptions, borderRadius: 12, stepPosition: data?.stepPosition });
  }
  if (!data) return <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={18} />;
  const edge = data.resourceEdge;
  const label = resourceMapEdgeLabel(edge.type);
  const selector = selectorText(edge.evidence?.selector);
  const accessibleLabel = `${label}: ${resourceMapIdentityLabel(data.fromIdentity)} to ${resourceMapIdentityLabel(data.toIdentity)}, ${edge.confidence} confidence, ${edge.resolved ? "resolved" : "unresolved"}`;
  const tooltip = (
    <Stack spacing={0.75} sx={{ maxWidth: 420, py: 0.25 }}>
      <Typography variant="subtitle2">{label}</Typography>
      <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>
        {resourceMapIdentityLabel(data.fromIdentity)} → {resourceMapIdentityLabel(data.toIdentity)}
      </Typography>
      <Stack direction="row" spacing={0.5} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Chip size="small" label={`${edge.confidence} confidence`} />
        <Chip size="small" label={edge.resolved ? "resolved" : "unresolved"} color={edge.resolved ? "success" : "warning"} />
        <Chip size="small" label={edge.source.type} variant="outlined" />
      </Stack>
      <Divider />
      {edge.source.fieldPath ? <Typography variant="caption">Source field: {edge.source.fieldPath}</Typography> : null}
      {edge.evidence?.description ? <Typography variant="caption">Evidence: {edge.evidence.description}</Typography> : null}
      {selector ? <Typography variant="caption" sx={{ overflowWrap: "anywhere" }}>Selector: {selector}</Typography> : null}
    </Stack>
  );

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={22} />
      <EdgeLabelRenderer>
        <Tooltip title={tooltip} arrow describeChild enterDelay={200} placement="top">
          <Box
            component="span"
            className="nopan nodrag"
            tabIndex={0}
            aria-label={accessibleLabel}
            data-edge-id={id}
            onMouseEnter={() => setLabelActive(true)}
            onMouseLeave={() => setLabelActive(false)}
            onFocus={() => setLabelActive(true)}
            onBlur={() => setLabelActive(false)}
            sx={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "all",
              px: labelActive ? 0.6 : 0.35,
              py: 0.15,
              border: 1,
              borderColor: "transparent",
              borderRadius: 0.75,
              bgcolor: "transparent",
              color: "text.secondary",
              typography: "caption",
              fontSize: "0.64rem",
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              boxShadow: 0,
              minWidth: labelActive ? undefined : 14,
              textAlign: "center",
              opacity: labelActive ? 1 : 0.45,
              transition: "opacity 120ms ease, background-color 120ms ease, border-color 120ms ease",
              "&:hover, &:focus-visible": {
                opacity: 1,
                bgcolor: "background.paper",
                borderColor: "divider",
                boxShadow: 1,
              },
              "&:focus-visible": { outline: "2px solid", outlineColor: "primary.main", outlineOffset: 2 },
            }}
          >
            {labelActive ? label : "•"}
          </Box>
        </Tooltip>
      </EdgeLabelRenderer>
    </>
  );
}
