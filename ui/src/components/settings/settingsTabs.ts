export const settingsTabsSx = {
  minHeight: 40,
  borderBottom: "1px solid",
  borderColor: "divider",
  "& .MuiTabs-flexContainer": {
    alignItems: "stretch",
  },
  "& .MuiTabs-scrollButtons.Mui-disabled": {
    width: 0,
    minWidth: 0,
    opacity: 0,
  },
  "& .MuiTab-root": {
    minHeight: 40,
    py: 0,
    px: 1.5,
    alignItems: "center",
    flexDirection: "row",
    gap: 1.25,
    lineHeight: 1.2,
    textTransform: "none",
    whiteSpace: "nowrap",
  },
  "& .MuiTab-root.Mui-selected": {
    fontWeight: 600,
  },
  "& .MuiTab-root.MuiTab-labelIcon": {
    minHeight: 40,
    pt: 0,
    pb: 0,
  },
  "& .MuiTab-root .MuiTab-iconWrapper": {
    mr: 0,
    mb: 0,
  },
} as const;
