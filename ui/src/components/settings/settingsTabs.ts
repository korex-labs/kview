import { tabAppearanceSx } from "../../theme/tabTokens";

export const settingsTabsSx = {
  ...tabAppearanceSx,
  minHeight: 40,
  borderBottom: "1px solid",
  borderColor: "divider",
  // Preserve Settings’ existing collapse-at-the-end geometry (not Dashboard slots).
  "& .MuiTabs-scrollButtons.Mui-disabled": {
    width: 0,
    minWidth: 0,
    opacity: 0,
  },
  "& .MuiTab-root.Mui-selected": {
    fontWeight: 600,
  },
} as const;
