import React, { useState } from "react";
import { Box, Button, Menu, MenuItem } from "@mui/material";
import { useActiveContext } from "../../activeContext";
import ActionButton from "./ActionButton";
import { useMutationDialog } from "./useMutationDialog";
import { useUserSettings } from "../../settingsContext";
import {
  useResourceCapabilities,
  canPatchOrUpdate,
  RBAC_DISABLED_REASON,
} from "./useResourceCapabilities";
import {
  buildDeleteDescriptor,
  buildRestartDescriptor,
  buildScaleDescriptor,
} from "../../lib/actions/builders";
import { customActionsForResource, type CustomActionDefinition } from "../../settings";
import type { ListResourceKey } from "../../utils/k8sResources";

function runtimeParamSpec(action: CustomActionDefinition) {
  if (!action.runtimeValue || action.action !== "set") return undefined;
  return [
    {
      kind: "string" as const,
      key: "value",
      label: action.target === "image" ? "Image" : "Value",
      required: true,
      defaultValue: action.value,
    },
  ];
}

function useCustomActionMenu(opts: {
  token: string;
  namespace: string;
  name: string;
  resourceKey: ListResourceKey;
  group: string;
  resource: string;
  kind: string;
  apiVersion: string;
  onSuccess: () => void;
}) {
  const activeContext = useActiveContext();
  const { settings } = useUserSettings();
  const { open } = useMutationDialog();
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const caps = useResourceCapabilities({
    token: opts.token,
    group: opts.group,
    resource: opts.resource,
    namespace: opts.namespace,
    name: opts.name,
  });
  const canPatch = canPatchOrUpdate(caps);
  const actions = customActionsForResource(settings.customActions.actions, opts.resourceKey);
  if (actions.length === 0) return null;

  const run = (action: CustomActionDefinition) => {
    setAnchor(null);
    const title = action.name || "Custom action";
    open({
      token: opts.token,
      targetRef: {
        context: activeContext,
        kind: opts.kind,
        name: opts.name,
        namespace: opts.namespace,
        apiVersion: opts.apiVersion,
      },
      descriptor: {
        id: "custom.workload",
        title,
        description:
          action.action === "patch"
            ? `Runs a ${action.patchType} patch on ${opts.kind}/${opts.name}.`
            : `${action.action === "unset" ? "Unsets" : "Sets"} ${action.target} on matching workload containers.`,
        group: opts.group,
        resource: opts.resource,
        apiVersion: opts.apiVersion,
        risk: action.safety === "dangerous" ? "high" : "medium",
        confirmSpec:
          action.safety === "dangerous"
            ? { mode: "typed", requiredValue: opts.name }
            : { mode: "simple" },
        paramSpecs: runtimeParamSpec(action),
      },
      params: {
        op: action.action,
        target: action.target,
        key: action.key,
        value: action.value,
        containerPattern: action.containerPattern,
        patchType: action.patchType,
        patchBody: action.patchBody,
      },
      initialParams: action.runtimeValue ? { value: action.value } : undefined,
      onSuccess: opts.onSuccess,
    });
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        disabled={!canPatch}
        onClick={(e) => setAnchor(e.currentTarget)}
      >
        Custom actions
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {actions.map((action) => (
          <MenuItem key={action.id} onClick={() => run(action)}>
            {action.name}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

// ---------------------------------------------------------------------------
// Namespaced or cluster-scoped delete-only actions
// ---------------------------------------------------------------------------

export type DeleteOnlyActionsConfig = {
  group: string;
  resource: string;
  kind: string;
  apiVersion: string;
  deleteId: string;
  deleteTitle: string;
  deleteDescription: string;
};

export type DeleteOnlyActionsProps = {
  token: string;
  /** Empty string for cluster-scoped resources. */
  namespace: string;
  name: string;
  config: DeleteOnlyActionsConfig;
  onDeleted: () => void;
};

/**
 * Reusable delete-only action block for any namespaced or cluster-scoped resource.
 * Preserves RBAC checks, targetRef, and descriptor labels.
 */
export function DeleteOnlyActions({
  token,
  namespace,
  name,
  config,
  onDeleted,
}: DeleteOnlyActionsProps) {
  const activeContext = useActiveContext();
  const caps = useResourceCapabilities({
    token,
    group: config.group,
    resource: config.resource,
    namespace,
    name,
  });

  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: config.kind,
    name,
    namespace,
    apiVersion: config.apiVersion,
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: config.deleteId,
          title: config.deleteTitle,
          description: config.deleteDescription,
          group: config.group,
          resource: config.resource,
          requiredValue: name,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canDelete}
        disabledReason={!canDelete && caps ? RBAC_DISABLED_REASON : ""}
        onSuccess={onDeleted}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Workload: scale + restart + delete (Deployment, StatefulSet)
// ---------------------------------------------------------------------------

export type WorkloadScaleRestartDeleteConfig = {
  group: string;
  resource: string;
  kind: string;
  apiVersion: string;
  scaleId: string;
  scaleTitle: string;
  scaleDescription: string;
  restartId: string;
  restartTitle: string;
  restartDescription: string;
  deleteId: string;
  deleteTitle: string;
  deleteDescription: string;
};

export type WorkloadScaleRestartDeleteProps = {
  token: string;
  namespace: string;
  name: string;
  currentReplicas: number;
  onRefresh: () => void;
  onDeleted: () => void;
  config: WorkloadScaleRestartDeleteConfig;
};

export function WorkloadScaleRestartDeleteActions({
  token,
  namespace,
  name,
  currentReplicas,
  onRefresh,
  onDeleted,
  config,
}: WorkloadScaleRestartDeleteProps) {
  const activeContext = useActiveContext();
  const custom = useCustomActionMenu({
    token,
    namespace,
    name,
    resourceKey: config.resource as ListResourceKey,
    group: config.group,
    resource: config.resource,
    kind: config.kind,
    apiVersion: config.apiVersion,
    onSuccess: onRefresh,
  });
  const caps = useResourceCapabilities({
    token,
    group: config.group,
    resource: config.resource,
    namespace,
    name,
  });

  const canScale = canPatchOrUpdate(caps);
  const canRestart = canPatchOrUpdate(caps);
  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: config.kind,
    name,
    namespace,
    apiVersion: config.apiVersion,
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Scale"
        descriptor={buildScaleDescriptor({
          id: config.scaleId,
          title: config.scaleTitle,
          description: config.scaleDescription,
          group: config.group,
          resource: config.resource,
          defaultReplicas: currentReplicas,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canScale}
        disabledReason={!canScale && caps ? RBAC_DISABLED_REASON : ""}
        initialParams={{ replicas: String(currentReplicas) }}
        onSuccess={onRefresh}
      />

      {custom}

      <ActionButton
        label="Restart"
        descriptor={buildRestartDescriptor({
          id: config.restartId,
          title: config.restartTitle,
          description: config.restartDescription,
          group: config.group,
          resource: config.resource,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canRestart}
        disabledReason={!canRestart && caps ? RBAC_DISABLED_REASON : ""}
        onSuccess={onRefresh}
      />

      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: config.deleteId,
          title: config.deleteTitle,
          description: config.deleteDescription,
          group: config.group,
          resource: config.resource,
          requiredValue: name,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canDelete}
        disabledReason={!canDelete && caps ? RBAC_DISABLED_REASON : ""}
        onSuccess={onDeleted}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Workload: restart + delete (DaemonSet)
// ---------------------------------------------------------------------------

export type WorkloadRestartDeleteConfig = {
  group: string;
  resource: string;
  kind: string;
  apiVersion: string;
  restartId: string;
  restartTitle: string;
  restartDescription: string;
  deleteId: string;
  deleteTitle: string;
  deleteDescription: string;
};

export type WorkloadRestartDeleteProps = {
  token: string;
  namespace: string;
  name: string;
  onRefresh: () => void;
  onDeleted: () => void;
  config: WorkloadRestartDeleteConfig;
};

export function WorkloadRestartDeleteActions({
  token,
  namespace,
  name,
  onRefresh,
  onDeleted,
  config,
}: WorkloadRestartDeleteProps) {
  const activeContext = useActiveContext();
  const custom = useCustomActionMenu({
    token,
    namespace,
    name,
    resourceKey: config.resource as ListResourceKey,
    group: config.group,
    resource: config.resource,
    kind: config.kind,
    apiVersion: config.apiVersion,
    onSuccess: onRefresh,
  });
  const caps = useResourceCapabilities({
    token,
    group: config.group,
    resource: config.resource,
    namespace,
    name,
  });

  const canRestart = canPatchOrUpdate(caps);
  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: config.kind,
    name,
    namespace,
    apiVersion: config.apiVersion,
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Restart"
        descriptor={buildRestartDescriptor({
          id: config.restartId,
          title: config.restartTitle,
          description: config.restartDescription,
          group: config.group,
          resource: config.resource,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canRestart}
        disabledReason={!canRestart && caps ? RBAC_DISABLED_REASON : ""}
        onSuccess={onRefresh}
      />

      {custom}

      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: config.deleteId,
          title: config.deleteTitle,
          description: config.deleteDescription,
          group: config.group,
          resource: config.resource,
          requiredValue: name,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canDelete}
        disabledReason={!canDelete && caps ? RBAC_DISABLED_REASON : ""}
        onSuccess={onDeleted}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Workload: scale + delete (ReplicaSet)
// ---------------------------------------------------------------------------

export type WorkloadScaleDeleteConfig = {
  group: string;
  resource: string;
  kind: string;
  apiVersion: string;
  scaleId: string;
  scaleTitle: string;
  scaleDescription: string;
  deleteId: string;
  deleteTitle: string;
  deleteDescription: string;
};

export type WorkloadScaleDeleteProps = {
  token: string;
  namespace: string;
  name: string;
  currentReplicas: number;
  onRefresh: () => void;
  onDeleted: () => void;
  config: WorkloadScaleDeleteConfig;
};

export function WorkloadScaleDeleteActions({
  token,
  namespace,
  name,
  currentReplicas,
  onRefresh,
  onDeleted,
  config,
}: WorkloadScaleDeleteProps) {
  const activeContext = useActiveContext();
  const custom = useCustomActionMenu({
    token,
    namespace,
    name,
    resourceKey: config.resource as ListResourceKey,
    group: config.group,
    resource: config.resource,
    kind: config.kind,
    apiVersion: config.apiVersion,
    onSuccess: onRefresh,
  });
  const caps = useResourceCapabilities({
    token,
    group: config.group,
    resource: config.resource,
    namespace,
    name,
  });

  const canScale = canPatchOrUpdate(caps);
  const canDelete = caps ? caps.delete : false;

  const targetRef = {
    context: activeContext,
    kind: config.kind,
    name,
    namespace,
    apiVersion: config.apiVersion,
  };

  return (
    <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, flexWrap: "wrap" }}>
      <ActionButton
        label="Scale"
        descriptor={buildScaleDescriptor({
          id: config.scaleId,
          title: config.scaleTitle,
          description: config.scaleDescription,
          group: config.group,
          resource: config.resource,
          defaultReplicas: currentReplicas,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canScale}
        disabledReason={!canScale && caps ? RBAC_DISABLED_REASON : ""}
        initialParams={{ replicas: String(currentReplicas) }}
        onSuccess={onRefresh}
      />

      {custom}

      <ActionButton
        label="Delete"
        color="error"
        descriptor={buildDeleteDescriptor({
          id: config.deleteId,
          title: config.deleteTitle,
          description: config.deleteDescription,
          group: config.group,
          resource: config.resource,
          requiredValue: name,
        })}
        targetRef={targetRef}
        token={token}
        disabled={!canDelete}
        disabledReason={!canDelete && caps ? RBAC_DISABLED_REASON : ""}
        onSuccess={onDeleted}
      />
    </Box>
  );
}
