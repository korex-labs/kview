import React from "react";
import { Box, FormControlLabel, Switch } from "@mui/material";
import InfoHint from "../../shared/InfoHint";
import ScopeTag from "./ScopeTag";

/**
 * Toggle row: optional ScopeTag above (left-aligned), then Switch + label on
 * the row below. Vertical stacking means the chip appearing/disappearing only
 * changes height, not horizontal layout.
 */

type Props = {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Only supply when the parent is in context-editing mode. */
  overrideState?: "inherited" | "overridden";
  onReset?: () => void;
};

export default function SettingRow({
  label,
  hint,
  checked,
  onChange,
  disabled,
  overrideState,
  onReset,
}: Props) {
  const labelNode = (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
      {label}
      {hint && <InfoHint title={hint} />}
    </Box>
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
      {overrideState && (
        <ScopeTag
          state={overrideState}
          onReset={overrideState === "overridden" ? onReset : undefined}
        />
      )}
      <Box sx={{ minHeight: 36, display: "flex", alignItems: "center" }}>
        <FormControlLabel
          sx={{ m: 0, flexShrink: 0 }}
          control={
            <Switch
              size="small"
              checked={checked}
              onChange={(e) => onChange(e.target.checked)}
              disabled={disabled}
            />
          }
          label={labelNode}
        />
      </Box>
    </Box>
  );
}
