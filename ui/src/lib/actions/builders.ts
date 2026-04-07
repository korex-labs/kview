import type { MutationActionDescriptor } from "./types";

/**
 * Builds a high-risk typed-confirmation Delete descriptor.
 * The caller provides all human-facing strings (title, description) to preserve per-kind wording.
 */
export function buildDeleteDescriptor(opts: {
  id: string;
  title: string;
  description?: string;
  group: string;
  resource: string;
  requiredValue: string;
}): MutationActionDescriptor {
  return {
    id: opts.id,
    title: opts.title,
    description: opts.description,
    risk: "high",
    confirmSpec: { mode: "typed", requiredValue: opts.requiredValue },
    group: opts.group,
    resource: opts.resource,
    paramSpecs: [
      {
        kind: "boolean",
        key: "force",
        label: "Force delete immediately",
        helperText:
          "Uses grace period 0, similar to kubectl --force --grace-period=0. Use only when normal deletion is stuck.",
        defaultValue: false,
      },
    ],
  };
}

/**
 * Builds a low-risk simple-confirmation Scale descriptor with a numeric replicas param.
 * The caller provides all human-facing strings (title, description) to preserve per-kind wording.
 */
export function buildScaleDescriptor(opts: {
  id: string;
  title: string;
  description?: string;
  group: string;
  resource: string;
  defaultReplicas: number;
}): MutationActionDescriptor {
  return {
    id: opts.id,
    title: opts.title,
    description: opts.description,
    risk: "low",
    confirmSpec: { mode: "simple" },
    group: opts.group,
    resource: opts.resource,
    paramSpecs: [
      {
        kind: "numeric",
        key: "replicas",
        label: "Replicas",
        min: 0,
        defaultValue: opts.defaultReplicas,
        required: true,
      },
    ],
  };
}

/**
 * Builds a low-risk simple-confirmation Restart descriptor.
 * The caller provides all human-facing strings (title, description) to preserve per-kind wording.
 */
export function buildRestartDescriptor(opts: {
  id: string;
  title: string;
  description?: string;
  group: string;
  resource: string;
}): MutationActionDescriptor {
  return {
    id: opts.id,
    title: opts.title,
    description: opts.description,
    risk: "low",
    confirmSpec: { mode: "simple" },
    group: opts.group,
    resource: opts.resource,
  };
}
