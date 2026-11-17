import type { TabsProps } from "@mui/material/Tabs";

/** Navigation policy is independent of appearance and panel lifetime. */
export const overflowOnlyTabsProps = {
  variant: "scrollable",
  scrollButtons: "auto",
  allowScrollButtonsMobile: true,
} as const satisfies Partial<TabsProps>;

/** Dashboard keeps both arrow slots mounted, including when disabled. */
export const reservedSlotsTabsProps = {
  ...overflowOnlyTabsProps,
  scrollButtons: true,
} as const satisfies Partial<TabsProps>;

export const reservedSlotsTabsSx = {
  "& .MuiTabs-scrollButtons": { flexShrink: 0, width: 32 },
} as const;

/** Shared drawer/settings appearance; no overflow or mounting behavior. */
export const tabAppearanceSx = {
  "& .MuiTabs-flexContainer": { alignItems: "stretch" },
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
  "& .MuiTab-root.MuiTab-labelIcon": { minHeight: 40, pt: 0, pb: 0 },
  "& .MuiTab-root .MuiTab-iconWrapper": { mr: 0, mb: 0 },
} as const;
