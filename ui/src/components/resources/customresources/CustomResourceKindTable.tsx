import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Stack, Typography } from "@mui/material";
import type { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { useActiveContext } from "../../../activeContext";
import ResourceListPage from "../../shared/ResourceListPage";
import { AppButton } from "../../shared/AppActions";
import CustomResourceDrawer from "./CustomResourceDrawer";

export type ExactKind = { group: string; version: string; resource: string; scope: "Namespaced" | "Cluster" };
export type KindRow = {
  id: string; name: string; namespace?: string; uid: string; identityKnown: boolean; ageKnown: boolean;
  group: string; version: string; resource: string; kind: string; ageSec: number;
  cells: unknown[]; provenance?: "kubernetes" | "helmManifest";
};
type PrinterColumn = { name: string; type: string; format?: string; description?: string; priority?: number };
export type KindPage = ExactKind & { namespace?: string; kind: string; columns: PrinterColumn[]; items: KindRow[]; meta: {
  columnSource: "table" | "standard"; fallbackReason?: string; limit: number; pages: number;
  truncated: boolean; continue?: string; resourceVersion?: string; partial: boolean;
  unknownIdentityRows: number; incompleteCellRows: number;
} };
export const kindPreferenceKey = (kind: ExactKind) => JSON.stringify(["customresource-kind", kind.group, kind.version, kind.resource, kind.scope]);
export function kindPagePath(kind: ExactKind, namespace: string, continuation: string): string {
  if (!kind.group || !kind.version || !kind.resource || (kind.scope === "Namespaced" && !namespace)) throw new Error("Exact kind and namespace are required");
  const query = new URLSearchParams({ scope: kind.scope, limit: "200" });
  if (kind.scope === "Namespaced") query.set("namespace", namespace);
  if (continuation) query.set("continue", continuation);
  return `/api/customresource-kinds/${[kind.group, kind.version, kind.resource].map(encodeURIComponent).join("/")}?${query}`;
}
export function printerCell(value: unknown): string {
  if (value == null) return "Unknown";
  // Table printer values are scalar. Never recursively stringify arbitrary objects.
  if (typeof value === "object") return Array.isArray(value) ? "[structured array]" : "[structured object]";
  const text = String(value);
  return text.length > 2048 ? `${text.slice(0, 2048)}…` : text;
}
const actionable = (row: KindRow) => row.identityKnown === true && Boolean(row.uid && row.name);
type Props = { token: string; kind: ExactKind; namespace?: string; onBack: () => void };
export default function CustomResourceKindTable(props: Props) {
  const context = useActiveContext();
  const identity = JSON.stringify([context, props.token, props.kind.group, props.kind.version, props.kind.resource, props.kind.scope, props.namespace]);
  if (!props.kind.group || !props.kind.version || !props.kind.resource ||
      !["Namespaced", "Cluster"].includes(props.kind.scope) ||
      (props.kind.scope === "Namespaced" && !props.namespace)) {
    return <Stack spacing={1}><Typography>Select an exact kind and namespace before browsing.</Typography>
      <AppButton onClick={props.onBack}>Back to all custom resources</AppButton></Stack>;
  }
  return <KindTableContent key={identity} {...props} context={context} />;
}
function KindTableContent({ token, kind, namespace = "", onBack, context }: Props & { context: string }) {
  const [cursors, setCursors] = useState<string[]>([""]);
  const cursor = cursors[cursors.length - 1];
  // Cursor changes remount the page, dropping rows, selection and column metadata synchronously.
  return <KindTablePage key={cursor} token={token} kind={kind} namespace={namespace} context={context} cursor={cursor}
    pageNumber={cursors.length} onBack={onBack}
    onPrevious={() => setCursors((old) => old.slice(0, -1))}
    onNext={(next) => setCursors((old) => [...old, next])} />;
}
function KindTablePage({ token, kind, namespace, context, cursor, pageNumber, onBack, onPrevious, onNext }: Props & {
  namespace: string; context: string; cursor: string; pageNumber: number; onPrevious: () => void; onNext: (cursor: string) => void;
}) {
  const [page, setPage] = useState<KindPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(true);
  const generation = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const path = kindPagePath(kind, namespace, cursor);
  const fetchRows = useCallback(async (_context?: string, _reason?: unknown, signal?: AbortSignal) => {
    const request = ++generation.current;
    const current = () => alive.current && !signal?.aborted && generation.current === request;
    setPending(true);
    try {
      if (!context || !token) throw new Error("Authentication and explicit context are required");
      const result = await apiGetWithContext<KindPage>(path, token, context, { signal });
      if (!current()) throw new DOMException("Obsolete kind page", "AbortError");
      if (result.group !== kind.group || result.version !== kind.version || result.resource !== kind.resource ||
          result.scope !== kind.scope || (kind.scope === "Namespaced" && result.namespace !== namespace)) {
        throw new Error("The returned page does not match the requested kind and scope");
      }
      setPage(result);
      setFailed(false);
      return { rows: result.items.slice(0, 200).map((row, index) => ({ ...row, id: row.uid || `unknown:${index}` })) };
    } catch (error) {
      // The shared query retains rows on failure: retain their columns and evidence
      // too, and keep the stale warning until a successful retry replaces the page.
      if (current()) setFailed(true);
      throw error;
    } finally { if (current()) setPending(false); }
  }, [context, path, token, kind.group, kind.version, kind.resource, kind.scope, namespace]);
  const rowActionable = useCallback((row: KindRow) => actionable(row) &&
    (kind.scope === "Namespaced" ? row.namespace === namespace : !row.namespace), [kind.scope, namespace]);
  const columns = useMemo<GridColDef<KindRow>[]>(() => [
    { field: "identity", headerName: "Identity", width: 150, valueGetter: (_v, row) => rowActionable(row) ? "Verified object" : "Unknown — no actions" },
    ...(page?.columns || []).slice(0, 64).map((column, index): GridColDef<KindRow> => ({
      // Never use printer names as object keys: duplicates and builtin names are legal.
      field: `printer:${index}:${JSON.stringify([column.name, column.type, column.format || ""])}`,
      headerName: column.name.slice(0, 200), description: column.description?.slice(0, 2048), width: 180,
      valueGetter: (_value, row) => printerCell(row.cells[index]),
    })),
  ], [page?.columns, rowActionable]);
  return <ResourceListPage<KindRow>
    token={token} title={`${kind.resource}.${kind.group} · ${kind.version} · ${kind.scope}${kind.scope === "Namespaced" ? ` · ${namespace}` : ""}`}
    resourceKey={kind.scope === "Namespaced" ? "customresources" : "clusterresources"}
    columnPreferencesKey={kindPreferenceKey(kind)} namespace={kind.scope === "Namespaced" ? namespace : null}
    columns={columns} fetchRows={fetchRows} skipEmptyAccessCheck hideRefresh
    isRowActionable={rowActionable} getResourceTagTarget={() => null} disableResourceNotes
    defaultSortField={columns[1]?.field || "identity"} getRowInstance={(row) => row.uid}
    filterPredicate={(row, query) => row.cells.slice(0, 64).some((value) => printerCell(value).toLowerCase().includes(query))}
    dataplaneMetaPrefix={<Stack spacing={0.5}>
      <AppButton size="small" onClick={onBack}>Back to all custom resources</AppButton>
      {failed && <Alert severity="warning">
        {page ? "Reload failed — showing the last successful page; data may be stale." : "Load failed — no page is available."}
      </Alert>}
      {page && <Typography variant="caption">
        {page.meta.columnSource === "standard" ? `Standard columns — ${page.meta.fallbackReason || "Reason unavailable"}` : "Server printer columns"}
        {page.meta.partial ? " · Partial page" : ""}{page.meta.truncated ? " · Truncated / more data available" : ""}
        {` · ${page.meta.unknownIdentityRows} unknown identities · ${page.meta.incompleteCellRows} incomplete cell rows`}
      </Typography>}
    </Stack>}
    renderFooterExtra={(refetch) => <>
      <AppButton size="small" disabled={pending} onClick={() => void refetch()}>{failed ? "Retry" : "Reload page"}</AppButton>
      <AppButton size="small" disabled={pending || pageNumber === 1} onClick={onPrevious}>Previous page</AppButton>
      <Typography variant="caption">Page {pageNumber} · up to 200 rows · filter applies to this page</Typography>
      <AppButton size="small" disabled={pending || !page?.meta.continue || page.meta.continue === cursor || pageNumber >= 100}
        onClick={() => { if (page?.meta.continue) onNext(page.meta.continue); }}>Next page</AppButton>
      {pageNumber >= 100 && <Typography variant="caption">Navigation bound reached; return to all resources to restart.</Typography>}
    </>}
    renderDrawer={({ selectedRow, open, onClose }) => selectedRow && rowActionable(selectedRow) ? <CustomResourceDrawer
      token={token} open={open} onClose={onClose} crRef={{ group: kind.group, version: kind.version, resource: kind.resource,
        kind: selectedRow.kind, namespace: kind.scope === "Namespaced" ? namespace : "", scope: kind.scope === "Namespaced" ? "namespaced" : "cluster",
        name: selectedRow.name, uid: selectedRow.uid, provenance: selectedRow.provenance }} /> : null}
  />;
}
