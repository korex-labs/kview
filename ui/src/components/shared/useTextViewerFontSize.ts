import { useState } from "react";
import { useOptionalUserSettings } from "../../settingsContext";
import { DEFAULT_TEXT_VIEWER_FONT_SIZE_PX, normalizeTextViewerFontSize } from "../../textViewerPreferences";

export function useTextViewerFontSize() {
  const context = useOptionalUserSettings();
  // Standalone consumers remain usable without requiring an application provider.
  const [localSize, setLocalSize] = useState(DEFAULT_TEXT_VIEWER_FONT_SIZE_PX);
  const fontSize = context ? normalizeTextViewerFontSize(context.settings.appearance.textViewerFontSizePx) : localSize;
  const update = (change: (current: number) => number) => {
    if (context) {
      context.setSettings((previous) => ({
        ...previous,
        appearance: {
          ...previous.appearance,
          textViewerFontSizePx: normalizeTextViewerFontSize(change(normalizeTextViewerFontSize(previous.appearance.textViewerFontSizePx))),
        },
      }));
    } else {
      setLocalSize((previous) => normalizeTextViewerFontSize(change(previous)));
    }
  };
  return {
    fontSize,
    decrease: () => update((size) => size - 1),
    increase: () => update((size) => size + 1),
    reset: () => update(() => DEFAULT_TEXT_VIEWER_FONT_SIZE_PX),
  };
}
