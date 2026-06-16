import React, { useCallback } from "react";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import type { ApiDataplaneListResponse, NamespaceLimitRange } from "../../../types/api";
import { dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import { getResourceLabel } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import LimitRangeDrawer from "./LimitRangeDrawer";

type Row = NamespaceLimitRange & {
  id: string;
  itemCount: number;
  types: string;
};

const resourceLabel = getResourceLabel("limitranges");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  { field: "itemCount", headerName: "Items", width: 110, type: "number", renderCell: (p) => valueOrDash(p.value as number | undefined) },
  { field: "types", headerName: "Types", flex: 1, minWidth: 220, renderCell: (p) => valueOrDash(p.value as string | undefined) },
  { field: "ageSec", headerName: "Age", width: 130, type: "number", renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table") },
];

export default function LimitRangesTable({ token, namespace }: { token: string; namespace: string }) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<NamespaceLimitRange>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/limitranges`,
      token,
      contextName || "",
    );
    return {
      rows: (res.items || []).map((limitRange) => ({
        ...limitRange,
        id: `${limitRange.namespace}/${limitRange.name}`,
        itemCount: limitRange.items?.length || 0,
        types: Array.from(new Set((limitRange.items || []).map((item) => item.type).filter(Boolean))).join(", "),
      })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [namespace, token]);

  const filterPredicate = useCallback((row: Row, q: string) => (
    row.name.toLowerCase().includes(q) ||
    row.types.toLowerCase().includes(q)
  ), []);

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{ fetchRevision: dataplaneRevisionFetcher(token, "limitranges", namespace), pollSec: defaultRevisionPollSec }}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      resourceLabel={resourceLabel}
      resourceKey="limitranges"
      namespace={namespace}
      renderDrawer={({ selectedRow, open, onClose }) => (
        <LimitRangeDrawer
          open={open}
          onClose={onClose}
          token={token}
          namespace={namespace}
          limitRangeName={selectedRow?.name || null}
        />
      )}
    />
  );
}
