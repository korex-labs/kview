import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Box,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlineOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import type {
  SignalExclusionCondition,
  SignalExclusionRule,
  SignalExclusionSet,
} from "../../settings";
import { AppButton, AppIconButton } from "../shared/AppActions";

export type SignalExclusionsDialogProps = {
  open: boolean;
  signalLabel: string;
  scope: "global" | "context";
  contextName?: string;
  inheritedRules: SignalExclusionRule[];
  exclusions?: SignalExclusionSet;
  onClose: () => void;
  onSave: (exclusions: SignalExclusionSet) => void;
  onUseInherited: () => void;
  onPreview?: (exclusions: SignalExclusionSet) => Promise<SignalExclusionPreview>;
  onScopeChange?: (scope: "global" | "context") => void;
  showUseInherited?: boolean;
};

export type SignalExclusionPreview = {
  candidateCount: number;
  matchedCount: number;
  items: Array<{ resourceKind: string; namespace?: string; resourceName: string; reason?: string }>;
  itemsTruncated?: boolean;
};

export function canAddSignalExclusionRule(ruleCount: number): boolean {
  return ruleCount < 50;
}

function newID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `exclude-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function newCondition(): SignalExclusionCondition {
  return { source: "name", operator: "regex", pattern: "^" };
}

function newRule(): SignalExclusionRule {
  return {
    id: newID(),
    enabled: true,
    description: "",
    match: "all",
    conditions: [newCondition()],
  };
}

function cloneRules(rules: SignalExclusionRule[]): SignalExclusionRule[] {
  return rules.map((rule) => ({ ...rule, conditions: rule.conditions.map((condition) => ({ ...condition })) }));
}

function conditionError(condition: SignalExclusionCondition): string {
  const metadata = condition.source === "label" || condition.source === "annotation";
  if (metadata && !condition.key?.trim()) return `${condition.source} key is required`;
  if ((condition.key?.length || 0) > 253) return "Metadata key must be 253 characters or fewer";
  if ((condition.operator || "regex") === "regex") {
    if (!condition.pattern) return "Regex pattern is required";
    if (condition.pattern.length > 512) return "Regex pattern must be 512 characters or fewer";
    if (/\\[1-9]|\(\?(?:[=!]|<[=!]|>)/.test(condition.pattern)) {
      return "Lookarounds, backreferences, and atomic groups are not supported by RE2";
    }
    try {
      new RegExp(condition.pattern, condition.flags || "");
    } catch (error) {
      return error instanceof Error ? error.message : "Invalid regular expression";
    }
  }
  return "";
}

export default function SignalExclusionsDialog({
  open,
  signalLabel,
  scope,
  contextName,
  inheritedRules,
  exclusions,
  onClose,
  onSave,
  onUseInherited,
  onPreview,
  onScopeChange,
  showUseInherited = true,
}: SignalExclusionsDialogProps) {
  const inherited = scope === "context" && exclusions === undefined;
  const [rules, setRules] = useState<SignalExclusionRule[]>([]);
  const [preview, setPreview] = useState<SignalExclusionPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewRequest = useRef(0);
  const scopeDirty = !!onScopeChange && JSON.stringify(rules) !== JSON.stringify(exclusions?.rules ?? inheritedRules);

  useEffect(() => {
    if (!open) return;
    setRules(cloneRules(exclusions?.rules ?? inheritedRules));
    setPreview(null);
    setPreviewError("");
  }, [exclusions, inheritedRules, open]);

  const errors = useMemo(() => {
    const seen = new Set<string>();
    const limitErrors = rules.length > 50 ? ["No more than 50 exclusion rules are allowed"] : [];
    return [...limitErrors, ...rules.flatMap((rule, ruleIndex) => {
      const prefix = `Rule ${ruleIndex + 1}`;
      const ruleErrors: string[] = [];
      const id = rule.id.trim();
      if (!id) ruleErrors.push(`${prefix} needs an ID`);
      else if (id.length > 80) ruleErrors.push(`${prefix} ID must be 80 characters or fewer`);
      else if (seen.has(id)) ruleErrors.push(`${prefix} has a duplicate ID`);
      seen.add(id);
      if ((rule.description?.length || 0) > 200) ruleErrors.push(`${prefix} description must be 200 characters or fewer`);
      if (!rule.conditions.length) ruleErrors.push(`${prefix} needs at least one condition`);
      if (rule.conditions.length > 8) ruleErrors.push(`${prefix} has more than 8 conditions`);
      const conditionErrors = rule.conditions
        .map((condition, conditionIndex) => {
          const error = conditionError(condition);
          return error ? `${prefix}, condition ${conditionIndex + 1}: ${error}` : "";
        })
        .filter(Boolean);
      return [...ruleErrors, ...conditionErrors];
    })];
  }, [rules]);

  useEffect(() => {
    previewRequest.current += 1;
    setPreview(null);
    setPreviewError("");
    setPreviewBusy(false);
  }, [rules]);

  const patchRule = (index: number, patch: Partial<SignalExclusionRule>) => {
    setRules((current) => current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  };

  const patchCondition = (ruleIndex: number, conditionIndex: number, patch: Partial<SignalExclusionCondition>) => {
    setRules((current) => current.map((rule, i) => {
      if (i !== ruleIndex) return rule;
      return {
        ...rule,
        conditions: rule.conditions.map((condition, j) => {
          if (j !== conditionIndex) return condition;
          const next = { ...condition, ...patch };
          const metadata = next.source === "label" || next.source === "annotation";
          if (!metadata) delete next.key;
          if (!metadata && next.operator === "exists") next.operator = "regex";
          if (next.operator === "exists") {
            delete next.pattern;
            delete next.flags;
          }
          return next;
        }),
      };
    }));
  };

  const runPreview = async (saveAfterValidation: boolean) => {
    if (!onPreview) {
      if (saveAfterValidation) {
        onSave({ rules: cloneRules(rules) });
        onClose();
      }
      return;
    }
    const request = ++previewRequest.current;
    setPreviewBusy(true);
    setPreviewError("");
    try {
      const result = await onPreview({ rules: cloneRules(rules) });
      if (request !== previewRequest.current) return;
      if (saveAfterValidation) {
        onSave({ rules: cloneRules(rules) });
        onClose();
      } else {
        setPreview(result);
      }
    } catch (error) {
      if (request !== previewRequest.current) return;
      setPreview(null);
      setPreviewError(error instanceof Error ? error.message : "Preview failed");
    } finally {
      if (request === previewRequest.current) setPreviewBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{signalLabel} exclusions</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 0.5 }}>
          <Alert severity="info">
            A signal is hidden when any enabled rule matches. Conditions within a rule use the selected All/Any mode. Exclusions suppress new observations but do not delete existing signal history or saved investigations.
          </Alert>
          {onScopeChange ? (
            <TextField
              select
              size="small"
              label="Apply to"
              value={scope}
              disabled={scopeDirty}
              helperText={scopeDirty ? "Scope is locked after editing; reopen the dialog to change it." : "Choose scope before editing the rule."}
              onChange={(event) => onScopeChange(event.target.value as "global" | "context")}
              sx={{ width: { xs: "100%", sm: 280 } }}
            >
              <MenuItem value="context">Current context</MenuItem>
              <MenuItem value="global">Global default</MenuItem>
            </TextField>
          ) : null}
          {scope === "global" && onPreview ? (
            <Alert severity="info">
              Preview evaluates cached candidates in {contextName || "the current context"} only. The saved global default applies to contexts that inherit it.
            </Alert>
          ) : null}
          {scope === "context" ? (
            <Alert severity={inherited ? "info" : "warning"}>
              {inherited
                ? `Using ${inheritedRules.length} global rule${inheritedRules.length === 1 ? "" : "s"} for ${contextName || "this context"}. Saving creates a context-specific replacement.`
                : `These rules replace the global exclusions for ${contextName || "this context"}.`}
            </Alert>
          ) : null}
          {errors.length ? <Alert severity="error">{errors[0]}</Alert> : null}
          {previewError ? <Alert severity="error">{previewError}</Alert> : null}
          {preview ? (
            <Alert severity={preview.matchedCount > 0 ? "warning" : "info"}>
              Matches {preview.matchedCount} of {preview.candidateCount} cached candidate{preview.candidateCount === 1 ? "" : "s"}.
              {preview.items.length ? (
                <Box component="ul" sx={{ my: 0.5, pl: 2.5 }}>
                  {preview.items.slice(0, 10).map((item) => (
                    <li key={`${item.resourceKind}:${item.namespace || ""}:${item.resourceName}`}>
                      {item.resourceKind} {item.namespace ? `${item.namespace}/` : ""}{item.resourceName}
                    </li>
                  ))}
                </Box>
              ) : null}
              {preview.itemsTruncated || preview.items.length > 10 ? "Only the first matches are shown." : ""}
            </Alert>
          ) : null}

          {rules.length === 0 ? (
            <Typography variant="body2" color="text.secondary">No resources are excluded from this signal.</Typography>
          ) : rules.map((rule, ruleIndex) => (
            <Box key={rule.id} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1.5, display: "flex", flexDirection: "column", gap: 1 }}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
                <FormControlLabel
                  control={<Checkbox size="small" checked={rule.enabled !== false} onChange={(event) => patchRule(ruleIndex, { enabled: event.target.checked })} />}
                  label="Enabled"
                />
                <TextField
                  size="small"
                  label="Description"
                  value={rule.description || ""}
                  onChange={(event) => patchRule(ruleIndex, { description: event.target.value.slice(0, 200) })}
                  sx={{ flex: "1 1 260px" }}
                />
                <TextField
                  select
                  size="small"
                  label="Conditions"
                  value={rule.match === "any" ? "any" : "all"}
                  onChange={(event) => patchRule(ruleIndex, { match: event.target.value as "all" | "any" })}
                  sx={{ width: 130 }}
                >
                  <MenuItem value="all">Match all</MenuItem>
                  <MenuItem value="any">Match any</MenuItem>
                </TextField>
                <AppIconButton
                  label="Duplicate exclusion rule"
                  tooltip="Duplicate rule"
                  disabled={!canAddSignalExclusionRule(rules.length)}
                  onClick={() => setRules((current) => [...current, { ...rule, id: newID(), conditions: cloneRules([rule])[0].conditions }])}
                >
                  <ContentCopyIcon fontSize="inherit" />
                </AppIconButton>
                <AppIconButton
                  label="Delete exclusion rule"
                  tooltip="Delete rule"
                  color="error"
                  onClick={() => setRules((current) => current.filter((_, i) => i !== ruleIndex))}
                >
                  <DeleteOutlineIcon fontSize="inherit" />
                </AppIconButton>
              </Box>

              {rule.conditions.map((condition, conditionIndex) => {
                const metadata = condition.source === "label" || condition.source === "annotation";
                const exists = condition.operator === "exists";
                const error = conditionError(condition);
                const keyError = error.toLowerCase().includes("key") ? error : "";
                const patternError = keyError ? "" : error;
                return (
                  <Box key={`${rule.id}-${conditionIndex}`} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "150px minmax(160px, 1fr) 120px minmax(180px, 1.5fr) auto" }, gap: 1, alignItems: "start" }}>
                    <TextField
                      select
                      size="small"
                      label="Source"
                      value={condition.source}
                      onChange={(event) => patchCondition(ruleIndex, conditionIndex, { source: event.target.value as SignalExclusionCondition["source"] })}
                    >
                      <MenuItem value="name">Name</MenuItem>
                      <MenuItem value="namespace">Namespace</MenuItem>
                      <MenuItem value="label">Label</MenuItem>
                      <MenuItem value="annotation">Annotation</MenuItem>
                    </TextField>
                    <TextField
                      size="small"
                      label={metadata ? "Metadata key" : "Metadata key"}
                      disabled={!metadata}
                      value={condition.key || ""}
                      error={!!keyError}
                      helperText={keyError}
                      onChange={(event) => patchCondition(ruleIndex, conditionIndex, { key: event.target.value })}
                    />
                    <TextField
                      select
                      size="small"
                      label="Operator"
                      value={condition.operator || "regex"}
                      onChange={(event) => patchCondition(ruleIndex, conditionIndex, { operator: event.target.value as "regex" | "exists" })}
                    >
                      <MenuItem value="regex">Regex</MenuItem>
                      {metadata ? <MenuItem value="exists">Exists</MenuItem> : null}
                    </TextField>
                    <TextField
                      size="small"
                      label="RE2 pattern"
                      disabled={exists}
                      value={condition.pattern || ""}
                      error={!!patternError}
                      helperText={patternError || (condition.flags?.includes("i") ? "Case insensitive" : "Case sensitive")}
                      onChange={(event) => patchCondition(ruleIndex, conditionIndex, { pattern: event.target.value.slice(0, 512) })}
                    />
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                      <FormControlLabel
                        control={<Checkbox size="small" disabled={exists} checked={condition.flags?.includes("i") || false} onChange={(event) => patchCondition(ruleIndex, conditionIndex, { flags: event.target.checked ? "i" : "" })} />}
                        label="Case insensitive"
                      />
                      <AppIconButton
                        label="Delete condition"
                        tooltip="Delete condition"
                        color="error"
                        onClick={() => patchRule(ruleIndex, { conditions: rule.conditions.filter((_, i) => i !== conditionIndex) })}
                      >
                        <DeleteOutlineIcon fontSize="inherit" />
                      </AppIconButton>
                    </Box>
                  </Box>
                );
              })}
              <Box>
                <AppButton variant="text" size="small" disabled={rule.conditions.length >= 8} onClick={() => patchRule(ruleIndex, { conditions: [...rule.conditions, newCondition()] })}>
                  Add condition
                </AppButton>
              </Box>
            </Box>
          ))}

          <Box>
            <AppButton variant="outlined" disabled={!canAddSignalExclusionRule(rules.length)} onClick={() => setRules((current) => [...current, newRule()])}>
              Add exclusion rule
            </AppButton>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        {showUseInherited && scope === "context" && !inherited ? (
          <AppButton color="inherit" onClick={() => { onUseInherited(); onClose(); }}>Use global rules</AppButton>
        ) : null}
        <Box sx={{ flex: 1 }} />
        {onPreview ? (
          <AppButton
            color="inherit"
            disabled={errors.length > 0 || previewBusy}
            onClick={() => void runPreview(false)}
          >
            {previewBusy ? "Previewing…" : "Preview matches"}
          </AppButton>
        ) : null}
        <AppButton color="inherit" onClick={onClose}>Cancel</AppButton>
        <AppButton variant="contained" disabled={errors.length > 0 || previewBusy} onClick={() => void runPreview(true)}>
          Save exclusions
        </AppButton>
      </DialogActions>
    </Dialog>
  );
}
