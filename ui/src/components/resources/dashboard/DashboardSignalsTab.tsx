import { Box } from "@mui/material";
import type { ApiDashboardSignalsResponse } from "../../../types/api";
import MetricCard from "../../shared/MetricCard";
import DashboardSignalsPanel from "./DashboardSignalsPanel";
import type { InspectTarget } from "./dashboardTypes";

type Props = {
  token: string;
  item: NonNullable<ApiDashboardSignalsResponse["item"]>;
  metricsUsable: boolean;
  podRestartThreshold: number;
  signalFilter: string;
  signalFilters: string[];
  combinedSignalFilters: boolean;
  onSignalFilterChange: (filter: string) => void;
  signalsQuery: string;
  onSignalsQueryChange: (query: string) => void;
  signalsSort: string;
  onSignalsSortChange: (sort: string) => void;
  signalsPage: number;
  onSignalsPageChange: (page: number) => void;
  signalsRowsPerPage: number;
  onSignalsRowsPerPageChange: (rows: number) => void;
  onInspect: (target: InspectTarget) => void;
  loading: boolean;
};

export default function DashboardSignalsTab({
  token,
  item,
  metricsUsable,
  podRestartThreshold,
  signalFilter,
  signalFilters,
  combinedSignalFilters,
  onSignalFilterChange,
  signalsQuery,
  onSignalsQueryChange,
  signalsSort,
  onSignalsSortChange,
  signalsPage,
  onSignalsPageChange,
  signalsRowsPerPage,
  onSignalsRowsPerPageChange,
  onInspect,
  loading,
}: Props) {
  const signalPanel = item.signals;

  return (
    <>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
        <MetricCard
          label="Signals"
          value={signalPanel?.total ?? 0}
          color={(signalPanel?.high || 0) > 0 ? "error" : (signalPanel?.medium || 0) > 0 ? "warning" : "success"}
          hint="Heuristic signals from cached namespace snapshots."
        />
        <MetricCard
          label="Pod failure signals"
          value={signalPanel?.podRestartSignals ?? 0}
          color={(signalPanel?.podRestartSignals || 0) > 0 ? "warning" : "success"}
          hint={`Pod restart, CrashLoopBackOff, image pull, and unschedulable signals in cached scope; restart threshold is ${podRestartThreshold}.`}
        />
        <MetricCard
          label="Workload warnings"
          value={signalPanel?.workloadWarnings ?? 0}
          color={(signalPanel?.workloadWarnings || 0) > 0 ? "warning" : "success"}
          hint="Workload-level rollout or availability signals, such as deployments with no available replicas."
        />
        <MetricCard
          label="Quota pressure"
          value={signalPanel?.quotaWarnings ?? 0}
          color={(signalPanel?.quotaWarnings || 0) > 0 ? "warning" : "success"}
          hint="Namespace ResourceQuota usage nearing hard limits; available even when node capacity is not visible."
        />
        {metricsUsable ? (
          <>
            <MetricCard
              label="Container near limit"
              value={signalPanel?.containerNearLimit ?? 0}
              color={(signalPanel?.containerNearLimit || 0) > 0 ? "warning" : "success"}
              hint="Containers using a high percentage of CPU or memory limit, sourced from metrics.k8s.io."
            />
            <MetricCard
              label="Node resource pressure"
              value={signalPanel?.nodeResourcePressure ?? 0}
              color={(signalPanel?.nodeResourcePressure || 0) > 0 ? "error" : "success"}
              hint="Nodes whose CPU or memory usage exceeds the configured pressure threshold against allocatable."
            />
          </>
        ) : null}
      </Box>

      <DashboardSignalsPanel
        token={token}
        signalPanel={signalPanel}
        signalFilter={signalFilter}
        signalFilters={signalFilters}
        combinedSignalFilters={combinedSignalFilters}
        onSignalFilterChange={onSignalFilterChange}
        signalsQuery={signalsQuery}
        onSignalsQueryChange={onSignalsQueryChange}
        signalsSort={signalsSort}
        onSignalsSortChange={onSignalsSortChange}
        signalsPage={signalsPage}
        onSignalsPageChange={onSignalsPageChange}
        signalsRowsPerPage={signalsRowsPerPage}
        onSignalsRowsPerPageChange={onSignalsRowsPerPageChange}
        onInspect={onInspect}
        derived={item.derived}
        loading={loading}
      />
    </>
  );
}
