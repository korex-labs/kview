import React, { useMemo, useState } from "react";
import {
  Box,
  Checkbox,
  Divider,
  ListItemText,
  Menu,
  MenuItem,
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
}: {
  tags: ResolvedResourceTag[];
  empty?: React.ReactNode;
  chipSx?: SxProps<Theme>;
}) {
  if (tags.length === 0) return empty;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", minWidth: 0 }}>
      {tags.map((tag) => (
        <ResourceTagChip key={`${tag.id}:${tag.inherited ? "inherited" : "direct"}`} tag={tag} sx={chipSx} />
      ))}
    </Box>
  );
}

export function ResourceTagsCell({ target }: { target: ResourceTagTarget }) {
  const { settings } = useUserSettings();
  const index = useMemo(() => buildResourceTagsIndex(settings.resourceTags), [settings.resourceTags]);
  const tags = useMemo(() => resourceTagsForTarget(settings.resourceTags, index, target), [index, settings.resourceTags, target]);
  return <ResourceTagsRow tags={tags} chipSx={{ maxWidth: 112 }} empty={<Typography variant="body2" color="text.secondary">-</Typography>} />;
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
