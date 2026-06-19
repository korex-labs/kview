import React from "react";
import {
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  type SxProps,
  type Theme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import type { SavedResourceViewDefinition } from "../../settings";
import { isDashboardSavedView } from "../../savedViews";
import { AppIconButton } from "./AppActions";

export type SavedViewPickerProps = {
  savedViews: SavedResourceViewDefinition[];
  selectedSavedViewId?: string;
  selectedSavedViewDirty?: boolean;
  onSavedViewApply?: (id: string) => void;
  onSavedViewClear?: () => void;
  onSavedViewSave?: () => void;
  onSavedViewDelete?: (id: string) => void;
  disabled?: boolean;
  sx?: SxProps<Theme>;
  clearTooltip?: string;
  saveTooltip?: string;
  saveSelectedTooltip?: string;
  modifiedTooltip?: string;
};

function savedViewOptionLabel(view: SavedResourceViewDefinition): string {
  const kind = isDashboardSavedView(view) ? "Dashboard" : "Resource";
  return `${kind}: ${view.name}`;
}

export default function SavedViewPicker({
  savedViews,
  selectedSavedViewId = "",
  selectedSavedViewDirty = false,
  onSavedViewApply,
  onSavedViewClear,
  onSavedViewSave,
  onSavedViewDelete,
  disabled = false,
  sx,
  clearTooltip = "Clear saved view and reset view",
  saveTooltip = "Save current view",
  saveSelectedTooltip = "Update selected saved view",
  modifiedTooltip = "The current view differs from the selected saved view. Save to update it or reselect the view to restore it.",
}: SavedViewPickerProps) {
  const labelId = React.useId();
  const selectedExists = savedViews.some((view) => view.id === selectedSavedViewId);
  const value = selectedExists ? selectedSavedViewId : "";

  return (
    <>
      <FormControl size="small" sx={[{ minWidth: { xs: "100%", sm: 220 } }, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])]}>
        <InputLabel id={labelId}>Saved view</InputLabel>
        <Select
          labelId={labelId}
          label="Saved view"
          value={value}
          onChange={(event) => {
            const id = String(event.target.value);
            if (!id) {
              onSavedViewClear?.();
              return;
            }
            onSavedViewApply?.(id);
          }}
          disabled={disabled || savedViews.length === 0}
        >
          <MenuItem value="">
            {savedViews.length === 0 ? "No saved views" : "No saved view"}
          </MenuItem>
          {savedViews.map((view) => (
            <MenuItem key={view.id} value={view.id}>
              {savedViewOptionLabel(view)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {selectedSavedViewId ? (
        <AppIconButton
          tooltip={clearTooltip}
          label={clearTooltip}
          onClick={onSavedViewClear}
          disabled={disabled}
        >
          <CloseIcon fontSize="small" />
        </AppIconButton>
      ) : null}
      {selectedSavedViewDirty ? (
        <Chip
          size="small"
          color="warning"
          variant="outlined"
          label="Modified"
          title={modifiedTooltip}
          sx={{ height: 24 }}
        />
      ) : null}
      <AppIconButton
        tooltip={selectedSavedViewId ? saveSelectedTooltip : saveTooltip}
        label={selectedSavedViewId ? saveSelectedTooltip : saveTooltip}
        onClick={onSavedViewSave}
        disabled={disabled}
      >
        <BookmarkAddOutlinedIcon fontSize="small" />
      </AppIconButton>
      <AppIconButton
        tooltip="Delete selected saved view"
        label="Delete selected saved view"
        onClick={() => selectedSavedViewId && onSavedViewDelete?.(selectedSavedViewId)}
        disabled={disabled || !selectedSavedViewId}
        intent="destructive"
      >
        <DeleteOutlineIcon fontSize="small" />
      </AppIconButton>
    </>
  );
}
