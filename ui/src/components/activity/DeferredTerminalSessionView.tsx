import React, { lazy, Suspense } from "react";
import type TerminalSessionView from "./TerminalSessionView";

const LazyTerminalSessionView = lazy(() => import("./TerminalSessionView"));

// Render only for an opened session. The parent keeps each keyed session mounted
// while hidden: tab switches must not reconnect its WebSocket or lose scrollback.
export default function DeferredTerminalSessionView(props: React.ComponentProps<typeof TerminalSessionView>) {
  return (
    <Suspense fallback={<div role="status">Loading terminal...</div>}>
      <LazyTerminalSessionView {...props} />
    </Suspense>
  );
}
