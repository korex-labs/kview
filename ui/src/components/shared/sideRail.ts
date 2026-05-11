export const sideRailWidth = 320;

export const sideRailPaperSx = {
  width: sideRailWidth,
  flexShrink: 0,
  borderRadius: 0,
  borderTop: 0,
  borderBottom: 0,
  px: 2,
  py: 1.5,
  overflowY: "auto",
};

export const sideRailListItemSx = {
  minHeight: 30,
  py: 0.25,
  px: 1,
};

export const sideRailListTextSx = {
  my: 0,
};

export const sideRailIconSx = (selected: boolean) => ({
  minWidth: 28,
  color: selected ? "primary.main" : "text.secondary",
});
