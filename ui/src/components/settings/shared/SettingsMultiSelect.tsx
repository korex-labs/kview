import {
  Checkbox,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material/Select";
import type React from "react";

export type SettingsMultiSelectOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  renderValueLabel?: string;
};

export default function SettingsMultiSelect<T extends string>({
  id,
  label,
  value,
  options,
  onChange,
  emptyLabel = "None",
  menuProps,
}: {
  id: string;
  label: React.ReactNode;
  value: T[];
  options: Array<SettingsMultiSelectOption<T>>;
  onChange: (value: T[]) => void;
  emptyLabel?: string;
  menuProps?: React.ComponentProps<typeof Select<T[]>>["MenuProps"];
}) {
  const labelByValue = new Map(options.map((option) => [
    option.value,
    option.renderValueLabel ?? (typeof option.label === "string" ? option.label : option.value),
  ]));
  return (
    <FormControl size="small" fullWidth>
      <InputLabel id={`${id}-label`} shrink>
        {label}
      </InputLabel>
      <Select<T[]>
        labelId={`${id}-label`}
        label={typeof label === "string" ? label : undefined}
        multiple
        displayEmpty
        MenuProps={menuProps}
        value={value}
        onChange={(event: SelectChangeEvent<T[]>) => {
          const next = event.target.value;
          onChange(typeof next === "string" ? next.split(",") as T[] : next);
        }}
        renderValue={(selected) =>
          selected.length === 0 ? emptyLabel : selected.map((item) => labelByValue.get(item) || item).join(", ")
        }
      >
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            <Checkbox size="small" checked={value.includes(option.value)} />
            <ListItemText primary={option.label} />
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
