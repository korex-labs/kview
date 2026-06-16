import React, { useState } from "react";
import { Box } from "@mui/material";
import { DeleteOnlyActions } from "../../mutations/ResourceActions";
import { useActiveContext } from "../../../activeContext";
import { useResourceCapabilities, RBAC_DISABLED_REASON } from "../../mutations/useResourceCapabilities";
import type { ExecuteActionResult, MutationActionDescriptor } from "../../../lib/actions/types";
import JobRunDebugDialog, { type DebugSession } from "./JobRunDebugDialog";
import { useMutationDialog } from "../../mutations/useMutationDialog";
import { executeAction } from "../../../lib/actions/executeAction";
import { apiPostWithContext } from "../../../api";
import ActionButton from "../../mutations/ActionButton";

type Props = {
  token: string;
  namespace: string;
  jobName: string;
  onDeleted: () => void;
};

export default function JobActions({ token, namespace, jobName, onDeleted }: Props) {
  const activeContext = useActiveContext();
  const { open } = useMutationDialog();
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugSession, setDebugSession] = useState<DebugSession | null>(null);
  const caps = useResourceCapabilities({
    token,
    group: "batch",
    resource: "jobs",
    namespace,
    name: jobName,
  });
  const canCreate = caps ? caps.create : false;
  const targetRef = {
    context: activeContext,
    kind: "Job",
    name: jobName,
    namespace,
    apiVersion: "batch/v1",
  };
  const rerunDescriptor: MutationActionDescriptor = {
    id: "job.rerun",
    title: "Rerun Job",
    description: "Creates a fresh Job from this Job's pod template.",
    risk: "low",
    confirmSpec: { mode: "simple" },
    group: "batch",
    resource: "jobs",
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

  async function runJob(params?: Record<string, unknown>): Promise<ExecuteActionResult> {
    if (params?.debug === true) {
      const started = await apiPostWithContext<DebugSession>(
        `/api/namespaces/${encodeURIComponent(namespace)}/job-runs/debug`,
        token,
        activeContext,
        { kind: "Job", name: jobName },
      );
      return {
        success: true,
        message: `Started debug job ${started.namespace}/${started.jobName || ""}`,
        details: started,
      };
    }
    return executeAction(token, activeContext, {
      actionId: rerunDescriptor.id,
      targetRef,
      group: rerunDescriptor.group,
      resource: rerunDescriptor.resource,
      apiVersion: rerunDescriptor.apiVersion,
    });
  }

  function openRunDialog() {
    open({
      token,
      targetRef,
      descriptor: rerunDescriptor,
      execute: runJob,
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

  return (
    <>
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
        <ActionButton
          descriptor={rerunDescriptor}
          targetRef={targetRef}
          token={token}
          disabled={!canCreate}
          disabledReason={!canCreate && caps ? RBAC_DISABLED_REASON : ""}
          onClickOverride={openRunDialog}
        />
        <DeleteOnlyActions
          token={token}
          namespace={namespace}
          name={jobName}
          onDeleted={onDeleted}
          config={{
            group: "batch",
            resource: "jobs",
            kind: "Job",
            apiVersion: "batch/v1",
            deleteId: "job.delete",
            deleteTitle: "Delete Job",
            deleteDescription: "Permanently removes the job and its pods.",
          }}
        />
      </Box>
      <JobRunDebugDialog
        open={debugOpen}
        onClose={() => setDebugOpen(false)}
        token={token}
        namespace={namespace}
        sourceKind="Job"
        sourceName={jobName}
        session={debugSession}
      />
    </>
  );
}
