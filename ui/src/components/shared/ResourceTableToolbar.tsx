import React from "react";
import {
  Box,
  Button,
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

type ResourceTableToolbarProps = {
  filterLabel: string;
  filter: string;
  onFilterChange: (value: string) => void;
  selectedQuickFilter: string | null;
  onQuickFilterToggle: (value: string) => void;
  onOpenSelected: () => void;
  hasSelection: boolean;
  refreshSec: number;
  onRefreshChange: (value: number) => void;
  quickFilters: QuickFilter[];
};

export default function ResourceTableToolbar({
  filterLabel,
  filter,
  onFilterChange,
  selectedQuickFilter,
  onQuickFilterToggle,
  onOpenSelected,
  hasSelection,
  refreshSec,
  onRefreshChange,
  quickFilters,
}: ResourceTableToolbarProps) {
  return (
    <GridToolbarContainer sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1 }}>
      <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          size="small"
          label={filterLabel}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
          sx={{ minWidth: 340 }}
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
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="refresh-label">Refresh</InputLabel>
          <Select
            labelId="refresh-label"
            label="Refresh"
            value={refreshSec}
            onChange={(e) => onRefreshChange(Number(e.target.value))}
          >
            {refreshOptions.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ flexGrow: 1 }} />
        <Button variant="contained" onClick={onOpenSelected} disabled={!hasSelection}>
          Open
        </Button>
      </Box>
      {quickFilters.length > 0 && (
        <Box sx={actionRowSx}>
          {quickFilters.map((q) => (
            <Button
              key={q.value}
              size="small"
              variant={selectedQuickFilter === q.value ? "contained" : "outlined"}
              onClick={() => onQuickFilterToggle(q.value)}
            >
              {q.label}
            </Button>
          ))}
        </Box>
      )}
    </GridToolbarContainer>
  );
}
