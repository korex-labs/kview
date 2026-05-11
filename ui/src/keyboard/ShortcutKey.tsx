import { Chip } from "@mui/material";

export default function ShortcutKey({ label }: { label: string }) {
  return (
    <Chip
      component="kbd"
      size="small"
      variant="outlined"
      label={label}
      sx={{
        height: 22,
        borderRadius: 1,
        fontFamily: "monospace",
        fontSize: "0.72rem",
        verticalAlign: "middle",
        "& .MuiChip-label": { px: 0.75 },
      }}
    />
  );
}
