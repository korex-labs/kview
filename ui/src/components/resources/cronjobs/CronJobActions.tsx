import React, { useState } from "react";
import { Box } from "@mui/material";
import PauseCircleOutlinedIcon from "@mui/icons-material/PauseCircleOutlined";
import PlayCircleOutlinedIcon from "@mui/icons-material/PlayCircleOutlined";
import { DeleteOnlyActions } from "../../mutations/ResourceActions";
import ActionButton from "../../mutations/ActionButton";
import { useActiveContext } from "../../../activeContext";
import {
  useResourceCapabilities,
  canPatchOrUpdate,
  RBAC_DISABLED_REASON,
} from "../../mutations/useResourceCapabilities";
import type { ExecuteActionResult, MutationActionDescriptor } from "../../../lib/actions/types";
import JobRunDebugDialog, { type DebugSession } from "../jobs/JobRunDebugDialog";
import { useMutationDialog } from "../../mutations/useMutationDialog";
import { executeAction } from "../../../lib/actions/executeAction";
import { apiPostWithContext } from "../../../api";

type Props = {
  token: string;
  namespace: string;
  cronJobName: string;
  currentSuspend: boolean;
  onRefresh: () => void;
  onDeleted: () => void;
};

export default function CronJobActions({
  token,
  namespace,
  cronJobName,
  currentSuspend,
  onRefresh,
  onDeleted,
}: Props) {
  const activeContext = useActiveContext();
  const { open } = useMutationDialog();
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const cronJobCaps = useResourceCapabilities({
    token,
    group: "batch",
    resource: "cronjobs",
    namespace,
    name: cronJobName,
  });
  const jobCaps = useResourceCapabilities({
    token,
    group: "batch",
    resource: "jobs",
    namespace,
    name: cronJobName,
  });
  const canCreateJob = jobCaps ? jobCaps.create : false;
  const targetRef = {
    context: activeContext,
    kind: "CronJob",
    name: cronJobName,
    namespace,
    apiVersion: "batch/v1",
  };
  const desiredSuspend = !currentSuspend;
  const suspendDescriptor: MutationActionDescriptor = {
    id: "cronjob.suspend",
    title: desiredSuspend ? "Suspend CronJob" : "Resume CronJob",
    description: desiredSuspend
      ? "Temporarily pauses new scheduled Jobs by setting spec.suspend=true. Helm or another reconciler may overwrite this change."
      : "Temporarily resumes scheduled Jobs by setting spec.suspend=false. Helm or another reconciler may overwrite this change.",
    risk: "medium",
    confirmSpec: { mode: "simple" },
    group: "batch",
    resource: "cronjobs",
    apiVersion: "batch/v1",
  };
  const runDescriptor: MutationActionDescriptor = {
    id: "cronjob.run",
    title: "Run CronJob",
    description: "Creates a one-off Job from this CronJob's job template.",
    risk: "low",
    confirmSpec: { mode: "simple" },
    group: "batch",
    resource: "cronjobs",
    apiVersion: "batch/v1",
    paramSpecs: [
      {
        kind: "boolean",
        key: "debug",
        label: "Open debug run",
        helperText: "Streams this run's events and container logs until the dialog is closed.",
        defaultValue: false,
      },
    ],
  };

  async function runCronJob(params?: Record<string, unknown>): Promise<ExecuteActionResult> {
    if (params?.debug === true) {
      const started = await apiPostWithContext<DebugSession>(
        `/api/namespaces/${encodeURIComponent(namespace)}/job-runs/debug`,
        token,
        activeContext,
        { kind: "CronJob", name: cronJobName },
      );
      return {
        success: true,
        message: `Started debug job ${started.namespace}/${started.jobName || ""}`,
        details: started,
      };
    }
    return executeAction(token, activeContext, {
      actionId: runDescriptor.id,
      targetRef,
      group: runDescriptor.group,
      resource: runDescriptor.resource,
      apiVersion: runDescriptor.apiVersion,
    });
  }

  function openSuspendDialog() {
    open({
      token,
      targetRef,
      descriptor: suspendDescriptor,
      params: { suspend: desiredSuspend },
      onSuccess: onRefresh,
    });
  }

  function openRunDialog() {
    open({
      token,
      targetRef,
      descriptor: runDescriptor,
      execute: runCronJob,
      closeOnSuccess: true,
      onSuccess: (result) => {
        const details = result.details as DebugSession | undefined;
        if (details?.id) {
          setDebugSession(details);
          setDebugOpen(true);
        }
      },
    });
  }

  const canPatchCronJob = canPatchOrUpdate(cronJobCaps);

  return (
    <>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <ActionButton
          label={desiredSuspend ? "Suspend" : "Resume"}
          color={desiredSuspend ? "warning" : "success"}
          startIcon={desiredSuspend ? <PauseCircleOutlinedIcon /> : <PlayCircleOutlinedIcon />}
          descriptor={suspendDescriptor}
          targetRef={targetRef}
          token={token}
          disabled={!canPatchCronJob}
          disabledReason={!canPatchCronJob && cronJobCaps ? RBAC_DISABLED_REASON : ""}
          onClickOverride={openSuspendDialog}
        />
        <ActionButton
          label="Run now"
          descriptor={runDescriptor}
          targetRef={targetRef}
          token={token}
          disabled={!canCreateJob}
          disabledReason={!canCreateJob && jobCaps ? RBAC_DISABLED_REASON : ""}
          onClickOverride={openRunDialog}
        />
        <DeleteOnlyActions
          token={token}
          namespace={namespace}
          name={cronJobName}
          onDeleted={onDeleted}
          config={{
            group: "batch",
            resource: "cronjobs",
            kind: "CronJob",
            apiVersion: "batch/v1",
            deleteId: "cronjob.delete",
            deleteTitle: "Delete CronJob",
            deleteDescription: "Permanently removes the cronjob and its active jobs.",
          }}
        />
      </Box>
      <JobRunDebugDialog
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        token={token}
        namespace={namespace}
        sourceKind="CronJob"
        sourceName={cronJobName}
        session={debugSession}
      />
    </>
  );
}
