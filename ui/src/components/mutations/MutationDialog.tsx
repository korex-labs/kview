import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  TextField,
  Typography,
} from "@mui/material";
import { executeAction } from "../../lib/actions/executeAction";
import type {
  ExecuteActionResult,
  MutationActionDescriptor,
  ParamSpec,
  TargetRef,
} from "../../lib/actions/types";
import { useConnectionState } from "../../connectionState";

type DialogPhase = "confirm" | "running" | "success" | "error";

export type MutationDialogProps = {
  open: boolean;
  onClose: () => void;
  descriptor: MutationActionDescriptor;
  targetRef: TargetRef;
  token: string;
  onSuccess?: () => void;
  /** Pre-populated values for paramSpecs fields (keyed by spec.key). */
  initialParams?: Record<string, string | boolean>;
};

const RISK_CHIP_COLOR: Record<string, "default" | "warning" | "error"> = {
  low: "default",
  medium: "warning",
  high: "error",
};

/** Returns true if the given value is valid for the param spec. */
function isParamValid(spec: ParamSpec, value: string): boolean {
  if (spec.kind === "boolean") return true;
  const trimmed = value.trim();
  if (spec.kind === "numeric") {
    if (trimmed === "") return !spec.required;
    const n = parseInt(trimmed, 10);
    if (isNaN(n) || String(n) !== trimmed) return false;
    if (spec.min !== undefined && n < spec.min) return false;
    return true;
  }
  // string / textarea: only check required
  if (trimmed === "") return !spec.required;
  return true;
}

export default function MutationDialog({
  open,
  onClose,
  descriptor,
  targetRef,
  token,
  onSuccess,
  initialParams,
}: MutationDialogProps) {
  const { health } = useConnectionState();
  const offline = health === "unhealthy";
  const [phase, setPhase] = useState<DialogPhase>("confirm");
  const [typedValue, setTypedValue] = useState("");
  const [simpleChecked, setSimpleChecked] = useState(false);
  const [result, setResult] = useState<ExecuteActionResult | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [params, setParams] = useState<Record<string, string | boolean>>({});

  // Reset all state each time the dialog opens.
  useEffect(() => {
    if (open) {
      setPhase("confirm");
      setTypedValue("");
      setSimpleChecked(false);
      setResult(null);
      setDetailsOpen(false);
      // Initialize params from initialParams, falling back to defaultValue from spec.
      const initial: Record<string, string | boolean> = {};
      for (const spec of descriptor.paramSpecs ?? []) {
        if (initialParams && initialParams[spec.key] !== undefined) {
          initial[spec.key] = initialParams[spec.key];
        } else if (spec.kind === "boolean") {
          initial[spec.key] = spec.defaultValue ?? false;
        } else if (spec.defaultValue !== undefined) {
          initial[spec.key] = String(spec.defaultValue);
        } else {
          initial[spec.key] = "";
        }
      }
      setParams(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const confirmSpec = descriptor.confirmSpec;

  const paramsValid = (descriptor.paramSpecs ?? []).every((spec) =>
    isParamValid(spec, String(params[spec.key] ?? ""))
  );

  const canExecute =
    phase !== "running" &&
    !offline &&
    paramsValid &&
    (confirmSpec.mode === "none" ||
      (confirmSpec.mode === "simple" && simpleChecked) ||
      (confirmSpec.mode === "typed" && typedValue === confirmSpec.requiredValue));

  async function handleExecute() {
    if (!canExecute) return;
    setPhase("running");

    // Collect params to pass to the backend.
    let execParams: Record<string, unknown> | undefined;
    if (descriptor.paramSpecs && descriptor.paramSpecs.length > 0) {
      execParams = {};
      for (const spec of descriptor.paramSpecs) {
        const value = params[spec.key];
        if (spec.kind === "numeric") {
          execParams[spec.key] = parseInt(String(value ?? "").trim(), 10);
        } else if (spec.kind === "boolean") {
          execParams[spec.key] = value === true;
        } else if (spec.kind === "textarea") {
          // Preserve raw value (e.g. YAML indentation must not be trimmed).
          execParams[spec.key] = String(value ?? "");
        } else {
          // string: trim whitespace
          execParams[spec.key] = String(value ?? "").trim();
        }
      }
    }

    const res = await executeAction(token, targetRef.context, {
      actionId: descriptor.id,
      targetRef,
      group: descriptor.group,
      resource: descriptor.resource,
      params: execParams,
    });
    setResult(res);
    if (res.success) {
      setPhase("success");
      onSuccess?.();
    } else {
      setPhase("error");
    }
  }

  function handleRetry() {
    setResult(null);
    setDetailsOpen(false);
    setPhase("confirm");
  }

  // Block backdrop/escape close while running.
  function handleDialogClose() {
    if (phase === "running") return;
    onClose();
  }

  const riskColor =
    descriptor.risk && descriptor.risk !== "low"
      ? (RISK_CHIP_COLOR[descriptor.risk] ?? "default")
      : undefined;

  return (
    <Dialog open={open} onClose={handleDialogClose} maxWidth="sm" fullWidth>
      {/* ── 1. Header ── */}
      <DialogTitle sx={{ pb: 0.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <span>{descriptor.title}</span>
          {riskColor && (
            <Chip
              label={
                descriptor.risk!.charAt(0).toUpperCase() +
                descriptor.risk!.slice(1) +
                " Risk"
              }
              size="small"
              color={riskColor}
            />
          )}
        </Box>
        {descriptor.description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {descriptor.description}
          </Typography>
        )}
      </DialogTitle>

      <DialogContent>
        {offline && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Cluster connection is unavailable. Actions are disabled until connectivity recovers.
          </Alert>
        )}

        {/* ── 2. Target Summary ── */}
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            bgcolor: "action.hover",
            borderRadius: 1,
          }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mb: 0.75, fontWeight: 600 }}
          >
            Target
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              rowGap: 1,
              columnGap: 2,
            }}
          >
            <Box>
              <Typography variant="caption" color="text.secondary">
                Kind
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {targetRef.kind}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Name
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {targetRef.name}
              </Typography>
            </Box>
            {targetRef.namespace && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Namespace
                </Typography>
                <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                  {targetRef.namespace}
                </Typography>
              </Box>
            )}
            <Box>
              <Typography variant="caption" color="text.secondary">
                Context
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: "monospace" }}>
                {targetRef.context}
              </Typography>
            </Box>
          </Box>
        </Box>

        {/* ── 3. Inputs Section ── */}
        {(phase === "confirm" || phase === "running") &&
          descriptor.paramSpecs &&
          descriptor.paramSpecs.length > 0 && (
            <>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                {descriptor.paramSpecs.map((spec) => {
                  const rawValue = params[spec.key];
                  const val = String(rawValue ?? "");

                  if (spec.kind === "numeric") {
                    const showError = val !== "" && !isParamValid(spec, val);
                    return (
                      <Box key={spec.key}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mb: 0.5 }}
                        >
                          {spec.label}
                        </Typography>
                        <TextField
                          size="small"
                          type="number"
                          inputProps={{ min: spec.min ?? 0, step: 1 }}
                          value={val}
                          onChange={(e) =>
                            setParams((prev) => ({
                              ...prev,
                              [spec.key]: e.target.value,
                            }))
                          }
                          disabled={phase === "running" || offline}
                          error={showError}
                          helperText={
                            showError
                              ? `Must be an integer${spec.min !== undefined ? ` ≥ ${spec.min}` : ""}`
                              : ""
                          }
                          fullWidth
                        />
                      </Box>
                    );
                  }

                  if (spec.kind === "textarea") {
                    return (
                      <Box key={spec.key}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mb: 0.5 }}
                        >
                          {spec.label}
                        </Typography>
                        <TextField
                          size="small"
                          multiline
                          minRows={spec.minRows ?? 4}
                          maxRows={12}
                          value={val}
                          placeholder={spec.placeholder}
                          onChange={(e) =>
                            setParams((prev) => ({
                              ...prev,
                              [spec.key]: e.target.value,
                            }))
                          }
                          disabled={phase === "running" || offline}
                          fullWidth
                          InputProps={{
                            sx: { fontFamily: "monospace", fontSize: "0.85rem" },
                          }}
                        />
                      </Box>
                    );
                  }

                  if (spec.kind === "boolean") {
                    return (
                      <Box key={spec.key}>
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={rawValue === true}
                              onChange={(e) =>
                                setParams((prev) => ({
                                  ...prev,
                                  [spec.key]: e.target.checked,
                                }))
                              }
                              disabled={phase === "running" || offline}
                            />
                          }
                          label={spec.label}
                        />
                        {spec.helperText ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block", ml: 4 }}
                          >
                            {spec.helperText}
                          </Typography>
                        ) : null}
                      </Box>
                    );
                  }

                  // kind === "string"
                  return (
                    <Box key={spec.key}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 0.5 }}
                      >
                        {spec.label}
                      </Typography>
                      <TextField
                        size="small"
                        value={val}
                        placeholder={spec.placeholder}
                        onChange={(e) =>
                          setParams((prev) => ({
                            ...prev,
                            [spec.key]: e.target.value,
                          }))
                        }
                        disabled={phase === "running" || offline}
                        fullWidth
                      />
                    </Box>
                  );
                })}
              </Box>
            </>
          )}

        {/* ── 4. Confirmation Section ── */}
        {(phase === "confirm" || phase === "running") &&
          confirmSpec.mode !== "none" && (
            <>
              <Divider sx={{ mb: 2 }} />
              {confirmSpec.mode === "simple" && (
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={simpleChecked}
                      onChange={(e) => setSimpleChecked(e.target.checked)}
                      disabled={phase === "running" || offline}
                    />
                  }
                  label="I confirm this action"
                />
              )}
              {confirmSpec.mode === "typed" && (
                <>
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    This action cannot be undone.
                  </Alert>
                  <Typography variant="body2" sx={{ mb: 1 }}>
                    Type <strong>{confirmSpec.requiredValue}</strong> to
                    confirm.
                  </Typography>
                  <TextField
                    autoFocus
                    fullWidth
                    size="small"
                    label="Confirmation"
                    value={typedValue}
                    onChange={(e) => setTypedValue(e.target.value)}
                    disabled={phase === "running" || offline}
                    error={
                      typedValue.length > 0 &&
                      typedValue !== confirmSpec.requiredValue
                    }
                    helperText={
                      typedValue.length > 0 &&
                      typedValue !== confirmSpec.requiredValue
                        ? "Does not match"
                        : ""
                    }
                  />
                </>
              )}
            </>
          )}

        {/* ── 5. Execution State (running indicator) handled via button ── */}

        {/* ── 6. Result Surface ── */}
        {phase === "error" && result && !result.success && (
          <>
            <Divider sx={{ mb: 2 }} />
            <Alert severity="error">
              <AlertTitle>Action failed</AlertTitle>
              {result.status === 403
                ? `Forbidden: not permitted to perform "${descriptor.id}" on ${targetRef.kind}/${targetRef.name}`
                : result.status === 404
                  ? `Not found: ${targetRef.kind}/${targetRef.name} no longer exists`
                  : result.status === 409
                    ? "Conflict: resource changed — refresh and retry"
                    : result.message}
            </Alert>
            {result.details && (
              <Box sx={{ mt: 1 }}>
                <Button
                  size="small"
                  onClick={() => setDetailsOpen((v) => !v)}
                >
                  {detailsOpen ? "Hide details" : "Show details"}
                </Button>
                <Collapse in={detailsOpen}>
                  <Box
                    component="pre"
                    sx={{
                      mt: 1,
                      p: 1,
                      fontSize: "0.75rem",
                      fontFamily: "monospace",
                      bgcolor: "action.hover",
                      borderRadius: 1,
                      overflow: "auto",
                      maxHeight: 160,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {typeof result.details === "string"
                      ? result.details
                      : JSON.stringify(result.details, null, 2)}
                  </Box>
                </Collapse>
              </Box>
            )}
          </>
        )}

        {phase === "success" && (
          <>
            <Divider sx={{ mb: 2 }} />
            <Alert severity="success">
              {result && result.success && result.message
                ? result.message
                : "Action completed successfully."}
            </Alert>
          </>
        )}
      </DialogContent>

      {/* ── Dialog Actions ── */}
      <DialogActions>
        {phase === "success" ? (
          <Button onClick={onClose} variant="contained">
            Close
          </Button>
        ) : phase === "error" ? (
          <>
            <Button onClick={handleRetry}>Retry</Button>
            <Button onClick={onClose}>Cancel</Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} disabled={phase === "running"}>
              Cancel
            </Button>
            <Button
              onClick={handleExecute}
              disabled={!canExecute}
              variant="contained"
              color={descriptor.risk === "high" ? "error" : "primary"}
            >
              {phase === "running" ? (
                <CircularProgress size={20} color="inherit" />
              ) : (
                descriptor.title
              )}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
