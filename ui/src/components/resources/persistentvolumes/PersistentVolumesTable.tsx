import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGetWithContext } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { pvPhaseChipColor } from "../../../utils/k8sUi";
import PersistentVolumeDrawer from "./PersistentVolumeDrawer";
import { getResourceLabel } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";
import { dataplaneListMetaFromResponse, type ApiDataplaneListResponse } from "../../../types/api";
import { dataplaneRevisionFetcher, defaultRevisionPollSec } from "../../../utils/dataplaneRevisionPoll";
import ListSignalChip from "../../shared/ListSignalChip";
import StatusChip from "../../shared/StatusChip";

type PersistentVolume = {
  name: string;
  phase?: string;
  capacity?: string;
  accessModes?: string[];
  storageClassName?: string;
  reclaimPolicy?: string;
  volumeMode?: string;
  claimRef?: string;
  ageSec: number;
  bindingHint?: string;
  listStatus?: string;
  listSignalSeverity?: string;
  listSignalCount?: number;
};

type Row = PersistentVolume & { id: string };

const resourceLabel = getResourceLabel("persistentvolumes");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "listSignalSeverity",
    headerName: "Signal",
    width: 130,
    renderCell: (p) => {
      const severity = p.row.listSignalSeverity;
      return <ListSignalChip severity={severity} count={p.row.listSignalCount} />;
    },
  },
  {
    field: "phase",
    headerName: "Status",
    width: 140,
    renderCell: (p) => (
      <StatusChip
        size="small"
        label={valueOrDash(String(p.row.listStatus || p.value || ""))}
        color={pvPhaseChipColor(String(p.row.listStatus || p.value || ""))}
      />
    ),
  },
  {
    field: "capacity",
    headerName: "Capacity",
    width: 140,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "storageClassName",
    headerName: "StorageClass",
    width: 180,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "reclaimPolicy",
    headerName: "ReclaimPolicy",
    width: 150,
    renderCell: (p) => valueOrDash(String(p.value || "")),
  },
  {
    field: "claimRef",
    headerName: "Claim",
    width: 220,
    renderCell: (p) => (
      <StatusChip
        size="small"
        label={p.row.claimRef || p.row.bindingHint || "unbound"}
        color={p.row.bindingHint === "released" ? "warning" : p.row.claimRef ? "success" : "default"}
        variant={p.row.claimRef ? "outlined" : "filled"}
      />
    ),
  },
  {
    field: "ageSec",
    headerName: "Age",
    width: 130,
    type: "number",
    renderCell: (p) => fmtAge(Number(p.row?.ageSec), "table"),
  },
];

export default function PersistentVolumesTable({ token }: { token: string }) {
  const fetchRows = useCallback(async (contextName?: string) => {
    const res = await apiGetWithContext<ApiDataplaneListResponse<PersistentVolume>>("/api/persistentvolumes", token, contextName || "");
    const items = res.items || [];
    return {
      rows: items.map((pv) => ({ ...pv, id: pv.name })),
      dataplaneMeta: dataplaneListMetaFromResponse({ meta: res.meta, observed: res.observed }),
    };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.phase || "").toLowerCase().includes(q) ||
      (row.listSignalSeverity || "").toLowerCase().includes(q) ||
      (row.bindingHint || "").toLowerCase().includes(q) ||
      (row.storageClassName || "").toLowerCase().includes(q) ||
      (row.reclaimPolicy || "").toLowerCase().includes(q) ||
      (row.claimRef || "").toLowerCase().includes(q),
    [],
  );

  return (
    <ResourceListPage<Row>
      token={token}
      title={resourceLabel}
      columns={columns}
      fetchRows={fetchRows}
      dataplaneRevisionPoll={{
        fetchRevision: dataplaneRevisionFetcher(token, "persistentvolumes"),
        pollSec: defaultRevisionPollSec,
      }}
      filterPredicate={filterPredicate}
      resourceLabel={resourceLabel}
      resourceKey="persistentvolumes"
      namespace={null}
      renderDrawer={({ selectedId, open, onClose }) => (
        <PersistentVolumeDrawer
          open={open}
          onClose={onClose}
          token={token}
          persistentVolumeName={selectedId}
        />
      )}
    />
  );
}
