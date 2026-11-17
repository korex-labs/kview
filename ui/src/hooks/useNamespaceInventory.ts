import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiGetWithContext, toApiError } from "../api";
import { namespacesListApiPath, recordRecentNamespace, type AppStateV1 } from "../state";
import type { ApiNamespacesListResponse } from "../types/api";

type Inventory = { context: string; token: string; items: Array<{ name: string }> };
type Options = {
  token: string;
  activeContext: string;
  ready: boolean;
  contextSwitching: boolean;
  appState: AppStateV1;
  setAppState: Dispatch<SetStateAction<AppStateV1>>;
  onInventory: (inventory: Inventory) => void;
  recentLimit: number;
  favouriteLimit: number;
};

const INITIAL_NAMESPACE_RETRY_ATTEMPTS = 5;
const INITIAL_NAMESPACE_RETRY_DELAY_MS = 400;

function pickNamespace({ limited, items, preferred }: { limited: boolean; items: string[]; preferred: string }): string {
  if (limited) return preferred || "";
  if (preferred && items.includes(preferred)) return preferred;
  return items[0] || "";
}

async function fetchNamespaces(token: string, path: string, context: string, signal: AbortSignal) {
  try {
    const response = await apiGetWithContext<ApiNamespacesListResponse>(path, token, context, { signal });
    return { limited: !!response.limited, items: (response.items || []).map((item) => item.name) };
  } catch (err) {
    const apiErr = toApiError(err);
    if (apiErr.status === 401 || apiErr.status === 403) return { limited: true, items: [] as string[] };
    throw err;
  }
}

async function fetchNamespacesWithWarmup(token: string, path: string, context: string, current: () => boolean, signal: AbortSignal) {
  let result = await fetchNamespaces(token, path, context, signal);
  if (result.limited || result.items.length > 0) return result;
  for (let i = 0; i < INITIAL_NAMESPACE_RETRY_ATTEMPTS; i += 1) {
    if (!current()) return result;
    await new Promise<void>((resolve) => window.setTimeout(resolve, INITIAL_NAMESPACE_RETRY_DELAY_MS));
    if (!current()) return result;
    result = await fetchNamespaces(token, path, context, signal);
    if (result.limited || result.items.length > 0) break;
  }
  return result;
}

/** Context selection remains App-owned; inventory requests use its accepted selection snapshot. */
export default function useNamespaceInventory({
  token, activeContext, ready, contextSwitching, appState, setAppState, onInventory, recentLimit, favouriteLimit,
}: Options) {
  const [inventory, setInventory] = useState<{ context: string; token: string; items: string[]; limited: boolean }>();
  const currentInventory = inventory?.context === activeContext && inventory.token === token ? inventory : undefined;
  const namespaces = currentInventory?.items ?? [];
  const nsLimited = currentInventory?.limited ?? false;
  const [namespace, setNamespace] = useState("");
  const [namespaceLoading, setNamespaceLoading] = useState(false);
  const [namespaceError, setNamespaceError] = useState("");
  const [namespaceNonce, setNamespaceNonce] = useState(0);
  const generation = useRef(0);
  const selection = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const refreshQueued = useRef(false);
  const request = useRef({ state: appState, preferred: "", preserveSelection: false, background: false });

  const invalidateNamespaceInventory = useCallback(() => {
    ++generation.current;
    controller.current?.abort();
    controller.current = null;
    refreshQueued.current = false;
    setNamespaceLoading(false);
  }, []);

  const resetNamespaceInventory = useCallback((clearSelection = false) => {
    invalidateNamespaceInventory();
    setInventory(undefined);
    setNamespaceError("");
    if (clearSelection) setNamespace("");
  }, [invalidateNamespaceInventory]);

  const prepareNamespaceInventory = useCallback((state: AppStateV1, preferred: string) => {
    resetNamespaceInventory();
    request.current = { state, preferred, preserveSelection: false, background: false };
    setNamespace(preferred);
    setNamespaceLoading(true);
  }, [resetNamespaceInventory]);

  useEffect(() => {
    const currentGeneration = ++generation.current;
    refreshQueued.current = false;
    if (!activeContext || !ready) {
      setNamespaceLoading(false);
      return;
    }
    const pending = new AbortController();
    controller.current = pending;
    const currentSelection = selection.current;
    const current = () => !pending.signal.aborted && currentGeneration === generation.current;
    const { state, preferred, preserveSelection, background } = request.current;
    // Request activity is guarded by the controller, not the visible initial-load
    // state. A confirmed same-identity inventory (including empty) stays usable.
    setNamespaceLoading(!(background && currentInventory && !currentInventory.limited));
    setNamespaceError("");
    const path = namespacesListApiPath(state, activeContext, preferred);
    const loading = preserveSelection
      ? fetchNamespaces(token, path, activeContext, pending.signal)
      : fetchNamespacesWithWarmup(token, path, activeContext, current, pending.signal);
    void loading.then(({ limited, items }) => {
      if (!current()) return;
      setInventory({ context: activeContext, token, limited, items });
      onInventory({ context: activeContext, token, items: items.map(name => ({ name })) });
      if (!preserveSelection && currentSelection === selection.current) {
        const chosen = pickNamespace({ limited, items, preferred });
        setNamespace(chosen);
        setAppState((s) => {
          const next = { ...s, activeNamespace: chosen };
          return chosen ? recordRecentNamespace(next, activeContext, chosen) : next;
        });
      }
    }).catch((err) => {
      if (current()) setNamespaceError(String((err as Error)?.message || err || "Namespace loading failed"));
    }).finally(() => {
      if (current()) {
        controller.current = null;
        setNamespaceLoading(false);
      }
    });
    return () => pending.abort();
    // Requests use the context-selection snapshot, not changing navigation state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContext, ready, namespaceNonce, token]);

  function retryNamespaces() {
    if (!activeContext || !ready || contextSwitching || controller.current || refreshQueued.current) return;
    request.current.background = false;
    refreshQueued.current = true;
    setNamespaceNonce((n) => n + 1);
  }

  function onOpenNamespaceSelector() {
    if (!activeContext || !ready || contextSwitching || namespaceLoading || controller.current || refreshQueued.current) return;
    // A successful bootstrap inventory is not a lifetime cache. Re-read on use
    // without resetting operator scope or introducing a background polling loop.
    request.current = { state: appState, preferred: namespace, preserveSelection: true, background: true };
    refreshQueued.current = true;
    setNamespaceNonce((n) => n + 1);
  }

  function onSelectNamespace(ns: string) {
    ++selection.current;
    request.current.preferred = ns;
    setNamespace(ns);
    setAppState((s) => {
      let next: AppStateV1 = { ...s, activeNamespace: ns };
      if (activeContext) next = recordRecentNamespace(next, activeContext, ns);
      return next;
    });
  }

  const namespacesListPath = useMemo(
    () => namespacesListApiPath(appState, activeContext, namespace, recentLimit, favouriteLimit),
    [appState, activeContext, namespace, recentLimit, favouriteLimit],
  );

  return {
    namespace, namespaces, nsLimited, namespaceLoading, namespaceError, namespacesListPath,
    onSelectNamespace, onOpenNamespaceSelector, retryNamespaces,
    invalidateNamespaceInventory, resetNamespaceInventory, prepareNamespaceInventory,
  };
}
