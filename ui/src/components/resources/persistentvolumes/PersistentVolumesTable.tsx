import React, { useCallback } from "react";
import { Chip } from "@mui/material";
import { GridColDef } from "@mui/x-data-grid";
import { apiGet } from "../../../api";
import { fmtAge, valueOrDash } from "../../../utils/format";
import { pvPhaseChipColor } from "../../../utils/k8sUi";
import PersistentVolumeDrawer from "./PersistentVolumeDrawer";
import { getResourceLabel, listResourceAccess } from "../../../utils/k8sResources";
import ResourceListPage from "../../shared/ResourceListPage";

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
};

type Row = PersistentVolume & { id: string };

const resourceLabel = getResourceLabel("persistentvolumes");

const columns: GridColDef<Row>[] = [
  { field: "name", headerName: "Name", flex: 1, minWidth: 240 },
  {
    field: "phase",
    headerName: "Phase",
    width: 140,
    renderCell: (p) => (
      <Chip
        size="small"
        label={valueOrDash(String(p.value || ""))}
        color={pvPhaseChipColor(String(p.value || ""))}
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
    renderCell: (p) => valueOrDash(String(p.value || "")),
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
  const fetchRows = useCallback(async () => {
    const res = await apiGet<{ items: PersistentVolume[] }>("/api/persistentvolumes", token);
    const items = res.items || [];
    return { rows: items.map((pv) => ({ ...pv, id: pv.name })) };
  }, [token]);

  const filterPredicate = useCallback(
    (row: Row, q: string) =>
      row.name.toLowerCase().includes(q) ||
      (row.phase || "").toLowerCase().includes(q) ||
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
      filterPredicate={filterPredicate}
      filterLabel="Filter (name/phase/storageClass/claim)"
      resourceLabel={resourceLabel}
      accessResource={listResourceAccess.persistentvolumes}
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
