export const DEFAULT_TEXT_VIEWER_FONT_SIZE_PX = 13;
export const MIN_TEXT_VIEWER_FONT_SIZE_PX = 10;
export const MAX_TEXT_VIEWER_FONT_SIZE_PX = 24;

/** Missing/invalid values use the default; numeric imports clamp to whole pixels. */
export function normalizeTextViewerFontSize(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_TEXT_VIEWER_FONT_SIZE_PX;
  return Math.min(MAX_TEXT_VIEWER_FONT_SIZE_PX, Math.max(MIN_TEXT_VIEWER_FONT_SIZE_PX, Math.round(value)));
}
