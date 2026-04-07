import React, { createContext, useCallback, useContext, useState } from "react";
import MutationDialog from "./MutationDialog";
import type { MutationActionDescriptor, TargetRef } from "../../lib/actions/types";

/** Parameters passed to useMutationDialog().open(). */
export type OpenMutationParams = {
  descriptor: MutationActionDescriptor;
  targetRef: TargetRef;
  token: string;
  /** Called immediately after a successful execution (before user closes). */
  onSuccess?: () => void;
  /** Pre-populated values for paramSpecs fields. */
  initialParams?: Record<string, string | boolean>;
};

export type MutationContextValue = {
  open: (params: OpenMutationParams) => void;
};

export const MutationCtx = createContext<MutationContextValue>({
  open: () => undefined,
});

/** Returns the mutation dialog controller. Must be used inside MutationProvider. */
export function useMutationDialog(): MutationContextValue {
  return useContext(MutationCtx);
}

type ActiveDialog = {
  params: OpenMutationParams;
  isOpen: boolean;
};

/**
 * MutationProvider mounts the singleton MutationDialog at the application root
 * and exposes the `open` controller via React Context.
 *
 * Wrap your application (or the portion that needs mutations) with this provider:
 *
 * ```tsx
 * <MutationProvider>
 *   <App />
 * </MutationProvider>
 * ```
 */
export default function MutationProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [active, setActive] = useState<ActiveDialog | null>(null);

  const open = useCallback((params: OpenMutationParams) => {
    setActive({ params, isOpen: true });
  }, []);

  function handleClose() {
    setActive((prev) => (prev ? { ...prev, isOpen: false } : null));
  }

  return (
    <MutationCtx.Provider value={{ open }}>
      {children}
      {active && (
        <MutationDialog
          open={active.isOpen}
          onClose={handleClose}
          descriptor={active.params.descriptor}
          targetRef={active.params.targetRef}
          token={active.params.token}
          onSuccess={active.params.onSuccess}
          initialParams={active.params.initialParams}
        />
      )}
    </MutationCtx.Provider>
  );
}
