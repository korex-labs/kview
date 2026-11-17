import { useEffect, useRef } from "react";
import { isSection, saveListTextFilter, saveQuickFilterSelection, type Section } from "../state";
import { APPLY_SAVED_RESOURCE_VIEW_EVENT, isDashboardSavedView } from "../savedViews";
import { APPLY_FOCUSED_RESOURCE_VIEW_EVENT, type FocusedResourceViewIntent } from "../focusedResourceViews";
import type { SavedResourceViewDefinition } from "../settings";

type Options = {
  activeContext: string;
  onSelectContext: (name: string, namespace?: string) => Promise<boolean>;
  onSelectNamespace: (namespace: string) => void;
  onSelectSection: (section: Section) => void;
};

/** Only shell navigation is shared; each destination still consumes its own pending view payload. */
export default function useViewNavigation({ activeContext, onSelectContext, onSelectNamespace, onSelectSection }: Options) {
  const generation = useRef(0);
  useEffect(() => () => { ++generation.current; }, []);

  function cancelPendingViewNavigation() {
    ++generation.current;
  }

  useEffect(() => {
    function applyResourceView(intent: FocusedResourceViewIntent) {
      if (!isSection(intent.resource)) return;
      const section = intent.resource;
      const currentGeneration = ++generation.current;
      const apply = () => {
        if (currentGeneration !== generation.current) return;
        saveListTextFilter(intent.filter || "");
        saveQuickFilterSelection([]);
        onSelectSection(section);
      };
      if (intent.context && intent.context !== activeContext) {
        // Do not mount the destination against the old context while selection
        // is pending/denied. App owns errors and context-generation validation.
        void onSelectContext(intent.context, intent.namespace).then((selected) => {
          if (selected) apply();
        });
      } else {
        if (intent.namespace) onSelectNamespace(intent.namespace);
        apply();
      }
    }
    const handleApplySavedView = (event: Event) => {
      const view = (event as CustomEvent<SavedResourceViewDefinition>).detail;
      if (!view) return;
      if (isDashboardSavedView(view)) {
        cancelPendingViewNavigation();
        onSelectSection("dashboard");
        return;
      }
      applyResourceView(view);
    };
    const handleApplyFocusedView = (event: Event) => {
      const intent = (event as CustomEvent<FocusedResourceViewIntent>).detail;
      if (intent) applyResourceView(intent);
    };
    window.addEventListener(APPLY_SAVED_RESOURCE_VIEW_EVENT, handleApplySavedView);
    window.addEventListener(APPLY_FOCUSED_RESOURCE_VIEW_EVENT, handleApplyFocusedView);
    return () => {
      window.removeEventListener(APPLY_SAVED_RESOURCE_VIEW_EVENT, handleApplySavedView);
      window.removeEventListener(APPLY_FOCUSED_RESOURCE_VIEW_EVENT, handleApplyFocusedView);
    };
  });

  return cancelPendingViewNavigation;
}
