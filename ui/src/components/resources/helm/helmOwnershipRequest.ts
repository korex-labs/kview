// Exact session identity also resets history, group disclosure and nested drawers.
export function helmReleaseSessionKey(context: string, token: string, namespace: string, release: string | null, open: boolean, health: string): string {
  return JSON.stringify([context, token, namespace, release, open, health]);
}

// Cancellation must reject publication even if the transport ignores AbortSignal.
export function acceptsHelmOwnershipResponse(signal: AbortSignal, requestedContext: string, responseContext: string): boolean {
  return !signal.aborted && Boolean(requestedContext) && requestedContext === responseContext;
}
