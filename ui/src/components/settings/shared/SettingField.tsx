import React, { useId } from "react";
import { Box, InputAdornment, TextField, Typography } from "@mui/material";
import InfoHint from "../../shared/InfoHint";
import ScopeTag from "./ScopeTag";

/**
 * Two rendering modes:
 *
 * 1. Managed TextField (pass `value` + `onChange`): SettingField renders a
 *    TextField whose label is embedded in the outlined border, matching the
 *    standard MUI floating-label look. Unit renders as an end adornment.
 *
 * 2. Wrapper (pass `children`): the label is injected into the single child
 *    element via React.cloneElement, so the child's own border carries the
 *    label. Use this for TextField-select children. For FormControl+Select
 *    (multiselect) children that cannot receive a `label` prop, use
 *    FormControl + InputLabel + Select directly instead of this wrapper.
 *
 * `onChange` always receives a raw string — callers convert with Number(v)
 * as needed, matching MUI's own TextField API.
 */

type SettingFieldBase = {
  label: string;
  hint?: string;
  required?: boolean;
  helperText?: string;
  error?: string;
  /** Only supply when the parent is in context-editing mode. */
  overrideState?: "inherited" | "overridden";
  onReset?: () => void;
  /** Shown as "Global: X" in helperText when overrideState is "inherited". */
  globalValue?: string;
};

type ManagedProps = SettingFieldBase & {
  value: string | number;
  onChange: (v: string) => void;
  type?: "text" | "number";
  unit?: string;
  min?: number;
  max?: number;
  multiline?: boolean;
  minRows?: number;
  disabled?: boolean;
  placeholder?: string;
  children?: never;
};

type WrapperProps = SettingFieldBase & {
  children: React.ReactNode;
  value?: never;
  onChange?: never;
  type?: never;
  unit?: never;
  min?: never;
  max?: never;
  multiline?: never;
  minRows?: never;
  disabled?: never;
  placeholder?: never;
};

type SettingFieldProps = ManagedProps | WrapperProps;

export default function SettingField(props: SettingFieldProps) {
  const { label, hint, required, helperText, error, overrideState, onReset, globalValue } = props;

  const id = useId();

  const effectiveHelper =
    error ??
    (overrideState === "inherited" && globalValue !== undefined
      ? `Global: ${globalValue}`
      : helperText);

  // ReactNode label: text + required marker + hint icon, used as MUI's label prop
  // so it renders embedded in the outlined input border (floating label).
  const labelNode: React.ReactNode =
    hint || required ? (
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
        {label}
        {required && (
          <Box component="span" sx={{ color: "error.main", ml: 0.25 }}>
            *
          </Box>
        )}
        {hint && <InfoHint title={hint} />}
      </Box>
    ) : (
      label
    );

  const scopeRow = overrideState ? (
    <ScopeTag
      state={overrideState}
      onReset={overrideState === "overridden" ? onReset : undefined}
    />
  ) : null;

  const helperNode = effectiveHelper ? (
    <Typography variant="caption" sx={{ color: error ? "error.main" : "text.secondary" }}>
      {effectiveHelper}
    </Typography>
  ) : null;

  if (props.children) {
    const child = props.children as React.ReactElement<Record<string, unknown>>;
    const childWithLabel = React.cloneElement(child, {
      label: labelNode,
      InputLabelProps: { shrink: true },
    });
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        {scopeRow}
        {childWithLabel}
        {helperNode}
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
      {scopeRow}
      <TextField
        id={id}
        size="small"
        type={props.type}
        label={labelNode}
        InputLabelProps={{ shrink: true }}
        value={props.value ?? ""}
        onChange={(e) => props.onChange?.(e.target.value)}
        placeholder={props.placeholder}
        multiline={props.multiline}
        minRows={props.minRows}
        disabled={props.disabled}
        error={Boolean(error)}
        inputProps={{
          min: props.min,
          max: props.max,
          ...(required ? { "aria-required": true } : {}),
        }}
        InputProps={
          props.unit
            ? {
                endAdornment: (
                  <InputAdornment position="end">
                    <Typography variant="caption" color="text.secondary">
                      {props.unit}
                    </Typography>
                  </InputAdornment>
                ),
              }
            : undefined
        }
        fullWidth
      />
      {helperNode}
    </Box>
  );
}
