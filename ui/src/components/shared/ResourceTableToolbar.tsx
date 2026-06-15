import React from "react";
import {
  Box,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import { AppIconButton } from "./AppActions";
import { GridToolbarContainer } from "@mui/x-data-grid";
import type { QuickFilter } from "../../utils/listFilters";
import { refreshOptions } from "../../utils/listFilters";
import { actionRowSx } from "../../theme/sxTokens";
import ScopedCountChip, { activeChipSx } from "./ScopedCountChip";

function quickFilterChipSx(filter: QuickFilter, selected: boolean) {
  const color = /^#[0-9a-fA-F]{6}$/.test(filter.color || "") ? filter.color : "";
  if (!color) return selected ? activeChipSx("primary") : undefined;
  return {
    "--scoped-chip-bg": `${color}22`,
    "--scoped-chip-fg": color,
    "--scoped-chip-border": `${color}99`,
    ...(selected ? { border: `2px solid ${color}` } : {}),
  };
}

export type ResourceTableToolbarProps = {
  filterLabel: string;
  filter: string;
  onFilterChange: (value: string) => void;
  filterInputRef?: React.Ref<HTMLInputElement>;
  onFilterKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFilterFocus?: React.FocusEventHandler<HTMLInputElement>;
  selectedQuickFilter: string | null;
  onQuickFilterToggle: (value: string) => void;
  refreshSec: number;
  onRefreshChange: (value: number) => void;
  quickFilters: QuickFilter[];
  disabled?: boolean;
  showRefresh?: boolean;
};

export default function ResourceTableToolbar({
  filterLabel,
  filter,
  onFilterChange,
  filterInputRef,
  onFilterKeyDown,
  onFilterFocus,
  selectedQuickFilter,
  onQuickFilterToggle,
  refreshSec,
  onRefreshChange,
  quickFilters,
  disabled = false,
  showRefresh = true,
}: ResourceTableToolbarProps) {
  return (
    <GridToolbarContainer sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1 }}>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          size="small"
          label={filterLabel}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          inputRef={filterInputRef}
          onKeyDown={onFilterKeyDown}
          onFocus={onFilterFocus}
          sx={{ minWidth: 340 }}
          disabled={disabled}
          slotProps={{
            input: {
              endAdornment: filter ? (
                <InputAdornment position="end">
                  <AppIconButton tooltip="Clear filter" label="Clear filter" onClick={() => onFilterChange("")}>
                    <CloseIcon fontSize="small" />
                  </AppIconButton>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
        {showRefresh ? (
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel id="refresh-label">Refresh</InputLabel>
            <Select
              labelId="refresh-label"
              label="Refresh"
              value={refreshSec}
              onChange={(e) => onRefreshChange(Number(e.target.value))}
              disabled={disabled}
            >
              {refreshOptions.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : null}
        <Box sx={{ flexGrow: 1 }} />
      </Box>
      {quickFilters.length > 0 && (
        <Box sx={actionRowSx}>
          {quickFilters.map((q) => {
            const selected = selectedQuickFilter === q.value;
            const isTag = q.kind === "tag";
            return (
              <ScopedCountChip
                key={q.value}
                size="small"
                color={selected ? "primary" : "default"}
                variant={selected ? "filled" : "outlined"}
                label={q.label}
                count={q.count}
                icon={isTag ? <LocalOfferOutlinedIcon /> : <SearchOutlinedIcon />}
                onClick={() => onQuickFilterToggle(q.value)}
                clickable
                disabled={disabled}
                sx={quickFilterChipSx(q, selected)}
                title={isTag ? `Tag filter: ${q.label}` : `Search filter: ${q.label}`}
              />
            );
          })}
        </Box>
      )}
    </GridToolbarContainer>
  );
}
