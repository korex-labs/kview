import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { type ApiDataplaneListResponse, dataplaneListMetaFromResponse } from "../../../types/api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { pvcPhaseChipColor } from "../../../utils/k8sUi";
import PersistentVolumeClaimDrawer from "./PersistentVolumeClaimDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

type PersistentVolumeClaim = {
  name: string;
  namespace: string;
  phase?: string;
  storageClassName?: string;
  volumeName?: string;
  accessModes?: string[];
  requestedStorage?: string;
  capacity?: string;
  volumeMode?: string;
  ageSec: number;
};

type Row = PersistentVolumeClaim & { id: string };

const resourceLabel = getResourceLabel("persistentvolumeclaims");

function formatSize(requested?: string, capacity?: string) {
  if (!requested && !capacity) return "-";
  if (requested && capacity && requested !== capacity) return `${requested} / ${capacity}`;
  return requested || capacity || "";
}

function formatAccessModes(modes?: string[]) {
  if (!modes || modes.length === 0) return "-";
  return modes.join(", ");
}

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "phase",
    headerName: "Status",
    width: 140,
    renderCell: (p) => (
      <Chip
        size="small"
        label={valueOrDash(String(p.value || ""))}
        color={pvcPhaseChipColor(String(p.value || ""))}
      />
    ),
  },
  {
    field: "storageClassName",
    headerName: "StorageClass",
    width: 180,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "requestedStorage",
    headerName: "Size",
    width: 180,
    renderCell: (p) => formatSize(p.row.requestedStorage, p.row.capacity),
    sortable: false,
  },
  {
    field: "volumeName",
    headerName: "Volume",
    width: 200,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "accessModes",
    headerName: "Access Modes",
    width: 200,
    renderCell: (p) => formatAccessModes(p.row.accessModes),
    sortable: false,
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function PersistentVolumeClaimsTable({
  token,
  namespace,
}: {
  token: string;
  namespace: string;
}) {
  const fetchRows = useCallback(async () => {
    const res = await apiGet<ApiDataplaneListResponse<PersistentVolumeClaim>>(
      `/api/namespaces/${encodeURIComponent(namespace)}/persistentvolumeclaims`,
      token,
    );
    const items = res.items || [];
    return {
      rows: items.map((pvc) => ({ ...pvc, id: `${pvc.namespace}/${pvc.name}` })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token, namespace]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.phase || "").toLowerCase().includes(q) ||
      (row.storageClassName || "").toLowerCase().includes(q) ||
      (row.volumeName || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={<>{resourceLabel} — {namespace}</>}
      columns={columns}
      fetchRows={fetchRows}
      enabled={!!namespace}
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/status/storageClass/volume)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.persistentvolumeclaims}
      namespace={namespace}
      renderDrawer={({ selectedId, open, onClose }) => {
        const pvcName = selectedId ? selectedId.split("/").slice(1).join("/") : null;
        return (
          <PersistentVolumeClaimDrawer
            open={open}
            onClose={onClose}
            token={token}
            namespace={namespace}
            persistentVolumeClaimName={pvcName}
          />
        );
      }}
    />
  );
}
