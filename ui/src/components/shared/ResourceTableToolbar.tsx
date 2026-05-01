import React from "react";
import {
  Box,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { GridToolbarContainer } from "@mui/x-data-grid";
import type { QuickFilter } from "../../utils/listFilters";
import { refreshOptions } from "../../utils/listFilters";
import { actionRowSx } from "../../theme/sxTokens";
import ScopedCountChip, { activeChipSx } from "./ScopedCountChip";

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
          InputProps={{
            endAdornment: filter ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => onFilterChange("")}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ) : undefined,
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
            return (
              <ScopedCountChip
                key={q.value}
                size="small"
                density="toolbar"
                color={selected ? "primary" : "default"}
                variant={selected ? "filled" : "outlined"}
                label={q.label}
                count={q.count}
                onClick={() => onQuickFilterToggle(q.value)}
                clickable
                disabled={disabled}
                sx={selected ? activeChipSx("primary") : undefined}
              />
            );
          })}
        </Box>
      )}
    </GridToolbarContainer>
  );
}
