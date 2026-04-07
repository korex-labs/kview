/** Identifies the Kubernetes target of an action. */
export type TargetRef = {
  context: string;
  kind: string;
  name: string;
  namespace?: string;
  apiVersion?: string;
};

/** Risk level for a mutation action. */
export type ActionRisk = "low" | "medium" | "high";

/** Confirmation mode for a mutation. */
export type ConfirmMode = "none" | "simple" | "typed";

/**
 * Specification for how the user must confirm a mutation before execution.
 *
 * - none:   execute is available immediately (low-risk actions)
 * - simple: user must explicitly check a confirmation checkbox
 * - typed:  user must type the exact requiredValue (case-sensitive) to unlock execution
 */
export type ConfirmSpec =
  | { mode: "none" }
  | { mode: "simple" }
  | { mode: "typed"; requiredValue: string };

/**
 * Specification for a single numeric input field rendered inside the mutation dialog.
 */
export type NumericParamSpec = {
  kind: "numeric";
  /** Key used in the params dict sent to the backend. */
  key: string;
  /** Human-readable label shown above the input field. */
  label: string;
  /** Minimum allowed value (inclusive). */
  min?: number;
  /** Default/initial value used when no initialParams override is provided. */
  defaultValue?: number;
  /** If true, the field must not be empty for execution to proceed. */
  required?: boolean;
};

/**
 * Specification for a single plain-text input field rendered inside the mutation dialog.
 */
export type StringParamSpec = {
  kind: "string";
  /** Key used in the params dict sent to the backend. */
  key: string;
  /** Human-readable label shown above the input field. */
  label: string;
  /** If true, the field must not be empty for execution to proceed. */
  required?: boolean;
  /** Placeholder hint shown when the field is empty. */
  placeholder?: string;
  /** Default/initial value. */
  defaultValue?: string;
};

/**
 * Specification for a multiline monospace text area (YAML / large text) rendered inside the
 * mutation dialog using canonical CodeBlock-style styling.
 */
export type TextAreaParamSpec = {
  kind: "textarea";
  /** Key used in the params dict sent to the backend. */
  key: string;
  /** Human-readable label shown above the input field. */
  label: string;
  /** If true, the field must not be empty for execution to proceed. */
  required?: boolean;
  /** Placeholder hint shown when the field is empty. */
  placeholder?: string;
  /** Default/initial value. */
  defaultValue?: string;
  /** Minimum visible rows (default 4). */
  minRows?: number;
};

/**
 * Specification for a boolean checkbox rendered inside the mutation dialog.
 */
export type BooleanParamSpec = {
  kind: "boolean";
  /** Key used in the params dict sent to the backend. */
  key: string;
  /** Human-readable label shown next to the checkbox. */
  label: string;
  /** Optional helper text shown below the checkbox. */
  helperText?: string;
  /** Default/initial value. */
  defaultValue?: boolean;
};

/** Union of all supported param spec kinds. */
export type ParamSpec =
  | NumericParamSpec
  | StringParamSpec
  | TextAreaParamSpec
  | BooleanParamSpec;

/**
 * Describes a mutation action that can be opened in the MutationDialog.
 *
 * `group` and `resource` are forwarded to the backend /api/actions endpoint.
 */
export type MutationActionDescriptor = {
  id: string;
  title: string;
  description?: string;
  risk?: ActionRisk;
  confirmSpec: ConfirmSpec;
  /** Kubernetes API group (e.g. "apps"). Forwarded to /api/actions. */
  group?: string;
  /** Kubernetes resource type (e.g. "deployments"). Forwarded to /api/actions. */
  resource?: string;
  /** Optional input fields rendered inside the dialog. */
  paramSpecs?: ParamSpec[];
};

/** Request body forwarded to the backend /api/actions endpoint. */
export type ExecuteActionRequest = {
  actionId: string;
  targetRef: TargetRef;
  params?: Record<string, unknown>;
  /** Forwarded from MutationActionDescriptor. */
  group?: string;
  /** Forwarded from MutationActionDescriptor. */
  resource?: string;
};

/** Result returned by executeAction(). Never throws — errors are encoded here. */
export type ExecuteActionResult =
  | { success: true; message?: string; details?: unknown }
  | { success: false; message: string; details?: unknown; status?: number };
