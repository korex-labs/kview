import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Chip,
  Checkbox,
  Divider,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import AddIcon from "@mui/icons-material/Add";
import type { ResourceTagTarget, ResolvedResourceTag } from "../../resourceTags";
import type { SxProps, Theme } from "@mui/material/styles";
import {
  assignmentTagIdsForTarget,
  buildResourceTagsIndex,
  resourceTagsForTarget,
  withResourceTagAssignment,
} from "../../resourceTags";
import { useUserSettings } from "../../settingsContext";
import { useActiveContext } from "../../activeContext";
import type { ListResourceKey } from "../../utils/k8sResources";
import ResourceTagChip from "./ResourceTagChip";
import { AppButton, AppIconButton } from "./AppActions";

export function ResourceTagsRow({
  tags,
  empty = null,
  chipSx,
  maxVisible,
  fitToWidth = false,
}: {
  tags: ResolvedResourceTag[];
  empty?: React.ReactNode;
  chipSx?: SxProps<Theme>;
  maxVisible?: number;
  fitToWidth?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLDivElement | null>(null);
  const overflowMeasureRef = useRef<HTMLDivElement | null>(null);
  const [measuredVisible, setMeasuredVisible] = useState(tags.length);

  useEffect(() => {
    if (!fitToWidth) {
      setMeasuredVisible(tags.length);
      return;
    }

    const measure = () => {
      const container = containerRef.current;
      const measureBox = measureRef.current;
      if (!container || !measureBox) return;

      const containerWidth = container.clientWidth || container.getBoundingClientRect().width;
      if (containerWidth <= 0) {
        setMeasuredVisible(tags.length);
        return;
      }

      const chipEls = Array.from(measureBox.querySelectorAll<HTMLElement>("[data-tag-measure]"));
      const overflowWidth = Math.ceil(
        overflowMeasureRef.current?.getBoundingClientRect().width || overflowMeasureRef.current?.offsetWidth || 36,
      );
      const gap = 4;
      let used = 0;
      let visible = 0;

      for (let index = 0; index < chipEls.length; index += 1) {
        const chipWidth = Math.ceil(chipEls[index].getBoundingClientRect().width || chipEls[index].offsetWidth);
        const separator = visible > 0 ? gap : 0;
        const remainingAfterThis = tags.length - index - 1;
        const overflowReserve = remainingAfterThis > 0 ? overflowWidth + gap : 0;
        if (used + separator + chipWidth + overflowReserve > containerWidth) break;
        used += separator + chipWidth;
        visible += 1;
      }

      setMeasuredVisible((prev) => prev === visible ? prev : visible);
    };

    const frame = window.requestAnimationFrame(measure);
    const container = containerRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && container) {
      resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(container);
    } else {
      window.addEventListener("resize", measure);
    }

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [fitToWidth, tags]);

  if (tags.length === 0) return empty;
  const visibleCount = fitToWidth
    ? Math.max(0, Math.min(tags.length, measuredVisible))
    : maxVisible == null ? tags.length : Math.max(0, Math.min(tags.length, Math.floor(maxVisible)));
  const visibleTags = tags.slice(0, visibleCount);
  const hiddenTags = tags.slice(visibleCount);
  const fullTagList = tags.map((tag) => tag.inherited ? `${tag.name} (inherited)` : tag.name).join(", ");
  return (
    <Box
      ref={containerRef}
      sx={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        flexWrap: fitToWidth ? "nowrap" : "wrap",
        minWidth: 0,
        width: fitToWidth ? "100%" : undefined,
        overflow: fitToWidth ? "hidden" : undefined,
      }}
    >
      {visibleTags.map((tag) => (
        <ResourceTagChip key={`${tag.id}:${tag.inherited ? "inherited" : "direct"}`} tag={tag} sx={chipSx} />
      ))}
      {hiddenTags.length > 0 ? (
        <Tooltip title={fullTagList} arrow>
          <Chip
            size="small"
            variant="outlined"
            label={`+${hiddenTags.length}`}
            sx={{ height: 24, flex: "0 0 auto" }}
          />
        </Tooltip>
      ) : null}
      {fitToWidth ? (
        <Box
          ref={measureRef}
          aria-hidden
          sx={{
            position: "absolute",
            visibility: "hidden",
            pointerEvents: "none",
            height: 0,
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            whiteSpace: "nowrap",
          }}
        >
          {tags.map((tag) => (
            <Box component="span" data-tag-measure key={`${tag.id}:${tag.inherited ? "inherited" : "direct"}:measure`}>
              <ResourceTagChip tag={tag} sx={chipSx} />
            </Box>
          ))}
          <Chip
            ref={overflowMeasureRef}
            size="small"
            variant="outlined"
            label={`+${tags.length}`}
            sx={{ height: 24, flex: "0 0 auto" }}
          />
        </Box>
      ) : null}
    </Box>
  );
}

export function ResourceTagsCell({ target }: { target: ResourceTagTarget }) {
  const { settings } = useUserSettings();
  const index = useMemo(() => buildResourceTagsIndex(settings.resourceTags), [settings.resourceTags]);
  const tags = useMemo(() => resourceTagsForTarget(settings.resourceTags, index, target), [index, settings.resourceTags, target]);
  return <ResourceTagsRow tags={tags} chipSx={{ maxWidth: 112 }} fitToWidth empty={<Typography variant="body2" color="text.secondary">-</Typography>} />;
}

export function ResourceTagsHeader({ target }: { target: ResourceTagTarget | null }) {
  const { settings } = useUserSettings();
  const index = useMemo(() => buildResourceTagsIndex(settings.resourceTags), [settings.resourceTags]);
  const tags = useMemo(
    () => target ? resourceTagsForTarget(settings.resourceTags, index, target) : [],
    [index, settings.resourceTags, target],
  );
  if (!settings.resourceTags.enabled || !target) return null;
  return <ResourceTagsRow tags={tags} />;
}

export function ResourceTagsEditorButton({ target }: { target: ResourceTagTarget | null }) {
  const { settings, setSettings } = useUserSettings();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const enabled = settings.resourceTags.enabled && target;
  const directTagIds = target ? assignmentTagIdsForTarget(settings.resourceTags, target) : [];
  const directSet = new Set(directTagIds);
  const index = useMemo(() => buildResourceTagsIndex(settings.resourceTags), [settings.resourceTags]);
  const inherited = target ? resourceTagsForTarget(settings.resourceTags, index, target).filter((tag) => tag.inherited) : [];

  if (!settings.resourceTags.enabled) return null;

  const setDirectTagIds = (tagIds: string[]) => {
    if (!target) return;
    setSettings((prev) => ({
      ...prev,
      resourceTags: withResourceTagAssignment(prev.resourceTags, target, tagIds),
    }));
  };

  const toggleTag = (tagId: string) => {
    const next = directSet.has(tagId)
      ? directTagIds.filter((id) => id !== tagId)
      : [...directTagIds, tagId];
    setDirectTagIds(next);
  };

  return (
    <>
      <AppIconButton tooltip="Edit resource tags" label="Edit resource tags" disabled={!enabled} onClick={(event) => setAnchorEl(event.currentTarget)}>
        <LocalOfferOutlinedIcon fontSize="small" />
      </AppIconButton>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        keepMounted
        slotProps={{ paper: { sx: { width: 320, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <MenuItem disabled sx={{ opacity: 1 }}>
          <ListItemText
            primary="Resource tags"
            secondary="Select direct tags for this drawer scope."
            slotProps={{
              primary: { variant: "body2", sx: { fontWeight: 600 } },
              secondary: { variant: "caption" },
            }}
          />
        </MenuItem>
        <Divider />
        {settings.resourceTags.definitions.length === 0 ? (
          <MenuItem disabled>
            <ListItemText primary="No tags defined" secondary="Create tags in Settings" />
          </MenuItem>
        ) : (
          settings.resourceTags.definitions.map((tag) => (
            <MenuItem key={tag.id} onClick={() => toggleTag(tag.id)} dense sx={{ minHeight: 34 }}>
              <Checkbox size="small" checked={directSet.has(tag.id)} />
              <Box
                aria-hidden
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  bgcolor: tag.color,
                  border: "1px solid",
                  borderColor: "divider",
                  mr: 1,
                }}
              />
              <ListItemText
                primary={tag.name}
                slotProps={{ primary: { variant: "body2", noWrap: true } }}
              />
            </MenuItem>
          ))
        )}
        {inherited.length > 0 ? (
          <>
            <Divider />
            <MenuItem disabled>
              <ListItemText
                primary="Inherited"
                secondary={inherited.map((tag) => tag.name).join(", ")}
                slotProps={{
                  primary: { variant: "body2", sx: { fontWeight: 600 } },
                  secondary: { variant: "caption", sx: { whiteSpace: "normal", overflowWrap: "anywhere" } },
                }}
              />
            </MenuItem>
          </>
        ) : null}
        <Divider />
        <Box sx={{ px: 1, py: 0.75, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            {directTagIds.length} assigned
          </Typography>
          <AppButton
            startIcon={<AddIcon />}
            onClick={() => setAnchorEl(null)}
            disabled
          >
            Create in Settings
          </AppButton>
        </Box>
      </Menu>
    </>
  );
}

export function ResourceDrawerTags({
  resource,
  namespace,
  name,
  mode = "row",
}: {
  resource: ListResourceKey;
  namespace?: string | null;
  name?: string | null;
  mode?: "row" | "edit";
}) {
  const context = useActiveContext();
  const target = name
    ? {
      context,
      resource,
      namespace: namespace || "",
      name,
    }
    : null;
  return mode === "edit" ? <ResourceTagsEditorButton target={target} /> : <ResourceTagsHeader target={target} />;
}
