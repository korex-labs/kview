import React, { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { AppButton, DialogActionButton } from "./AppActions";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { apiPostWithContext, toApiError } from "../../api";
import { useActiveContext } from "../../activeContext";

type YamlActionDetails = {
  warnings?: string[];
  normalizedYaml?: string;
  resourceVersion?: string;
  updatedResourceVersion?: string;
  namespaced?: boolean;
  risk?: {
    severity?: "success" | "info" | "warning" | "error";
    title?: string;
    reasons?: string[];
    changedPaths?: string[];
  };
};

type YamlActionResponse = {
  result?: {
    status?: string;
    message?: string;
    details?: YamlActionDetails;
  };
};

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  target: {
    kind: string;
    group: string;
    resource: string;
    apiVersion: string;
    namespace?: string;
    name: string;
  };
  initialYaml: string;
  onApplied?: () => void;
};

export default function YamlEditDialog({ open, onClose, token, target, initialYaml, onApplied }: Props) {
  const activeContext = useActiveContext();
  const [yamlText, setYamlText] = useState(initialYaml);
  const [typedName, setTypedName] = useState("");
  const [busy, setBusy] = useState<"validate" | "apply" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [immutableHints, setImmutableHints] = useState<string[]>([]);
  const [serverRisk, setServerRisk] = useState<null | {
    severity?: "success" | "info" | "warning" | "error";
    title?: string;
    reasons?: string[];
    changedPaths?: string[];
  }>(null);
  const [normalizedYaml, setNormalizedYaml] = useState("");
  const [validatedYaml, setValidatedYaml] = useState("");
  const [validatedVersion, setValidatedVersion] = useState("");

  useEffect(() => {
    if (!open) return;
    setYamlText(initialYaml);
    setTypedName("");
    setBusy(null);
    setError("");
    setMessage("");
    setWarnings([]);
    setImmutableHints([]);
    setServerRisk(null);
    setNormalizedYaml("");
    setValidatedYaml("");
    setValidatedVersion("");
  }, [open, initialYaml]);

  const dirtySinceValidation = validatedYaml !== "" && validatedYaml !== yamlText;
  const manifestLooksComplete = useMemo(() => {
    const text = yamlText;
    return (
      /\bapiVersion\s*:/m.test(text) &&
      /\bkind\s*:/m.test(text) &&
      /\bmetadata\s*:/m.test(text) &&
      /\bname\s*:/m.test(text)
    );
  }, [yamlText]);
  const canApply =
    !!validatedYaml &&
    !dirtySinceValidation &&
    manifestLooksComplete &&
    typedName === target.name &&
    busy === null;

  const normalizedDiffers = normalizedYaml !== "" && normalizedYaml !== yamlText;
  const diffLines = useMemo(() => buildYamlDiff(initialYaml, yamlText), [initialYaml, yamlText]);
  const normalizedDiffLines = useMemo(
    () => (normalizedYaml ? buildYamlDiff(yamlText, normalizedYaml) : []),
    [yamlText, normalizedYaml],
  );
  const riskSummary = useMemo(
    () =>
      buildRiskSummary({
        targetKind: target.kind,
        warnings,
        immutableHints,
        diffLines,
        serverRisk,
      }),
    [target.kind, warnings, immutableHints, diffLines, serverRisk],
  );
  const targetSummary = useMemo(() => {
    return [
      `${target.kind}/${target.name}`,
      target.namespace ? `namespace ${target.namespace}` : "cluster-scoped",
      activeContext ? `context ${activeContext}` : "",
    ]
      .filter(Boolean)
      .join("  |  ");
  }, [activeContext, target.kind, target.name, target.namespace]);

  async function runAction(action: "resource.yaml.validate" | "resource.yaml.apply") {
    if (!activeContext) {
      setError("Missing active context.");
      return null;
    }
    setBusy(action === "resource.yaml.validate" ? "validate" : "apply");
    setError("");
    setImmutableHints([]);
    setServerRisk(null);
    try {
      const response = await apiPostWithContext<YamlActionResponse>(
        "/api/actions",
        token,
        activeContext,
        {
          group: target.group,
          resource: target.resource,
          apiVersion: target.apiVersion,
          namespace: target.namespace || "",
          name: target.name,
          action,
          params: { manifest: yamlText, baseManifest: initialYaml },
        },
      );
      const result = response?.result;
      if (result?.status === "error") {
        throw new Error(result.message || "Action failed.");
      }
      const details = result?.details || {};
      setWarnings(Array.isArray(details.warnings) ? details.warnings.filter(Boolean) : []);
      setServerRisk(details.risk || null);
      setNormalizedYaml(typeof details.normalizedYaml === "string" ? details.normalizedYaml : "");
      setMessage(result?.message || "");
      return details;
    } catch (err) {
      const apiErr = toApiError(err);
      setError(apiErr.message);
      setImmutableHints(extractImmutableHints(apiErr.message));
      setMessage("");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleValidate() {
    const details = await runAction("resource.yaml.validate");
    if (!details) return;
    setValidatedYaml(yamlText);
    setValidatedVersion(details.resourceVersion || "");
  }

  async function handleApply() {
    if (!canApply) return;
    const details = await runAction("resource.yaml.apply");
    if (!details) return;
    setValidatedVersion(details.updatedResourceVersion || details.resourceVersion || validatedVersion);
    onApplied?.();
    onClose();
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="lg" fullWidth>
      <DialogTitle>Edit Live YAML</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Alert severity="warning">
            This updates the live cluster object directly. Reconcile the change later in Git, Helm, or your source of truth.
          </Alert>
          <Box>
            <Typography variant="body2" color="text.secondary">
              {targetSummary}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Validation requires a single object, matching identity, and the current `metadata.resourceVersion`.
            </Typography>
          </Box>

          <Alert severity={riskSummary.severity}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
              {riskSummary.title}
            </Typography>
            <Box component="ul" sx={{ m: 0, pl: 2 }}>
              {riskSummary.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </Box>
          </Alert>
          {Array.isArray(serverRisk?.changedPaths) && serverRisk!.changedPaths!.length > 0 && (
            <Accordion disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2">Risk Evidence</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Backend-detected changed field paths from the loaded object:
                </Typography>
                <Box
                  sx={{
                    border: "1px solid var(--code-border)",
                    borderRadius: 1,
                    backgroundColor: "var(--code-bg)",
                    p: 1.5,
                  }}
                >
                  <Box component="ul" sx={{ m: 0, pl: 2, fontFamily: "monospace", fontSize: "0.8rem" }}>
                    {serverRisk!.changedPaths!.map((path) => (
                      <li key={path}>{path}</li>
                    ))}
                  </Box>
                </Box>
              </AccordionDetails>
            </Accordion>
          )}

          {error && <Alert severity="error">{error}</Alert>}
          {!error && message && <Alert severity="success">{message}</Alert>}
          {warnings.length > 0 && (
            <Alert severity="warning">
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </Box>
            </Alert>
          )}
          {immutableHints.length > 0 && (
            <Alert severity="info">
              <Typography variant="body2" sx={{ mb: 0.75 }}>
                Kubernetes rejected one or more immutable fields in this edit.
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2 }}>
                {immutableHints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </Box>
            </Alert>
          )}
          {validatedYaml && dirtySinceValidation && (
            <Alert severity="info">
              YAML changed after the last validation. Validate again before applying.
            </Alert>
          )}
          {!manifestLooksComplete && (
            <Alert severity="info">
              The editor content does not yet look like a complete Kubernetes object. `apiVersion`, `kind`, and
              `metadata.name` need to be present before validation can run.
            </Alert>
          )}

          <TextField
            value={yamlText}
            onChange={(e) => {
              setYamlText(e.target.value);
              setError("");
              setMessage("");
            }}
            multiline
            minRows={24}
            fullWidth
            spellCheck={false}
            placeholder="Paste a single Kubernetes object YAML."
            slotProps={{
              input: {
                sx: {
                  fontFamily: "monospace",
                  alignItems: "stretch",
                  "& textarea": {
                    fontFamily: "monospace",
                    fontSize: "0.85rem",
                    lineHeight: 1.5,
                  },
                },
              },
            }}
          />

          <Accordion disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="body2">Diff from loaded YAML</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <YamlDiffPreview lines={diffLines} emptyLabel="No changes from the loaded YAML." />
            </AccordionDetails>
          </Accordion>

          {normalizedDiffers && (
            <Accordion disableGutters>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="body2">Sanitized diff after validation</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <YamlDiffPreview lines={normalizedDiffLines} emptyLabel="Sanitized YAML matches the editor content." />
              </AccordionDetails>
            </Accordion>
          )}

          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }} useFlexGap>
            <AppButton onClick={() => setYamlText(initialYaml)} disabled={busy !== null}>
              Reset to Loaded YAML
            </AppButton>
            {normalizedDiffers && (
              <AppButton onClick={() => setYamlText(normalizedYaml)} disabled={busy !== null}>
                Use Sanitized YAML
              </AppButton>
            )}
          </Stack>

          <Divider />

          <Box>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Type <Box component="span" sx={{ fontFamily: "monospace" }}>{target.name}</Box> to unlock apply.
            </Typography>
            <TextField
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              fullWidth
              placeholder={target.name}
              disabled={busy !== null}
            />
            {validatedVersion && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                Last validated resourceVersion: {validatedVersion}
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <DialogActionButton action="cancel" onClick={onClose} disabled={busy !== null}>
          Cancel
        </DialogActionButton>
        <DialogActionButton action="secondary" onClick={handleValidate} disabled={busy !== null || !manifestLooksComplete}>
          {busy === "validate" ? "Validating..." : "Validate"}
        </DialogActionButton>
        <DialogActionButton action="warning" onClick={handleApply} disabled={!canApply}>
          {busy === "apply" ? "Applying..." : "Apply Live Edit"}
        </DialogActionButton>
      </DialogActions>
    </Dialog>
  );
}

type DiffLine = {
  kind: "add" | "remove" | "same";
  text: string;
};

function buildYamlDiff(before: string, after: string): DiffLine[] {
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
      continue;
    }
    if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "remove", text: a[i] });
      i += 1;
    } else {
      out.push({ kind: "add", text: b[j] });
      j += 1;
    }
  }
  for (; i < a.length; i += 1) out.push({ kind: "remove", text: a[i] });
  for (; j < b.length; j += 1) out.push({ kind: "add", text: b[j] });
  return out;
}

function YamlDiffPreview({ lines, emptyLabel }: { lines: DiffLine[]; emptyLabel: string }) {
  if (lines.length === 0 || lines.every((line) => line.kind === "same")) {
    return <Typography variant="body2" color="text.secondary">{emptyLabel}</Typography>;
  }

  return (
    <Box
      sx={{
        border: "1px solid var(--code-border)",
        borderRadius: 1,
        backgroundColor: "var(--code-bg)",
        overflow: "auto",
      }}
    >
      <Box component="pre" sx={{ m: 0, p: 1.5, fontFamily: "monospace", fontSize: "0.8rem", lineHeight: 1.5 }}>
        {lines.map((line, idx) => {
          const prefix = line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " ";
          const bg =
            line.kind === "add"
              ? "rgba(46, 160, 67, 0.18)"
              : line.kind === "remove"
                ? "rgba(248, 81, 73, 0.18)"
                : "transparent";
          return (
            <Box
              key={`${prefix}-${idx}-${line.text}`}
              component="div"
              sx={{
                px: 1,
                backgroundColor: bg,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              <Box component="span" sx={{ color: "var(--code-line-number)", pr: 1 }}>
                {prefix}
              </Box>
              <Box component="span">{line.text || " "}</Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function extractImmutableHints(message: string): string[] {
  const lower = message.toLowerCase();
  if (
    !lower.includes("immutable") &&
    !lower.includes("field is immutable") &&
    !lower.includes("may not change") &&
    !lower.includes("updates to") &&
    !lower.includes("forbidden")
  ) {
    return [];
  }

  const hints = new Set<string>();
  const fieldMatches = [
    ...message.matchAll(/(?:field|updates to)\s+["']?([A-Za-z0-9_.[\]/-]+)["']?/g),
    ...message.matchAll(/([A-Za-z0-9_.[\]/-]+)\s*:?\s*field is immutable/gi),
  ];
  for (const match of fieldMatches) {
    const field = (match[1] || "").trim();
    if (!field) continue;
    hints.add(`Review ${field}; it may require recreating the resource instead of updating it live.`);
  }

  if (lower.includes("spec.selector")) {
    hints.add("`spec.selector` is immutable for many workload resources; keep it unchanged.");
  }
  if (lower.includes("clusterip")) {
    hints.add("Service cluster IP fields are immutable; keep `spec.clusterIP` and allocated IPs unchanged.");
  }
  if (lower.includes("volumeclaimtemplates")) {
    hints.add("StatefulSet volume claim templates are effectively immutable after creation.");
  }
  if (lower.includes("job") && lower.includes("template")) {
    hints.add("Job pod templates are commonly immutable once created; rerun or recreate the Job instead.");
  }
  if (hints.size === 0 && (lower.includes("immutable") || lower.includes("may not change"))) {
    hints.add("One of the edited fields is immutable on this resource; remove that change or recreate the object.");
  }
  return Array.from(hints);
}

type RiskSummary = {
  severity: "success" | "info" | "warning" | "error";
  title: string;
  items: string[];
};

function buildRiskSummary(opts: {
  targetKind: string;
  warnings: string[];
  immutableHints: string[];
  diffLines: DiffLine[];
  serverRisk: null | {
    severity?: "success" | "info" | "warning" | "error";
    title?: string;
    reasons?: string[];
    changedPaths?: string[];
  };
}): RiskSummary {
  if (opts.serverRisk?.title && Array.isArray(opts.serverRisk.reasons) && opts.serverRisk.reasons.length > 0) {
    return {
      severity: opts.serverRisk.severity || "info",
      title: opts.serverRisk.title,
      items: opts.serverRisk.reasons,
    };
  }
  const changedLines = opts.diffLines.filter((line) => line.kind !== "same").map((line) => line.text.trim());
  const changes = changedLines.join("\n").toLowerCase();
  const hasChanges = changedLines.length > 0;
  const controllerManaged = opts.warnings.some((warning) =>
    /helm-managed|owner references|controller/i.test(warning),
  );
  const immutableRisk =
    opts.immutableHints.length > 0 ||
    /spec\.selector|clusterip|clusterips|volumeclaimtemplates|jobtemplate|pod template|nodeport/.test(changes);

  const items: string[] = [];
  if (!hasChanges) {
    items.push("No live changes yet; validation should come back clean unless the object changed in the cluster.");
  } else {
    items.push(`${changedLines.length} changed YAML line${changedLines.length === 1 ? "" : "s"} from the loaded object.`);
  }

  const kind = opts.targetKind.toLowerCase();
  if (/deployment|statefulset|daemonset|job|ingress|service/.test(kind)) {
    items.push("This is a controller-managed resource; a live edit is fast, but make the durable fix in source control afterward.");
  }
  if (controllerManaged) {
    items.push("Another controller or Helm release may overwrite this live edit after it is applied.");
  }
  if (/secret/.test(kind)) {
    items.push("Secret values apply exactly as written; malformed base64 or accidental key edits are easy to miss.");
  }
  if (/service/.test(kind) && /clusterip|clusterips|ipfamilies|nodeport/.test(changes)) {
    items.push("Service networking fields are often immutable or allocation-sensitive.");
  }
  if (/statefulset/.test(kind) && /volumeclaimtemplates/.test(changes)) {
    items.push("StatefulSet storage template edits usually require recreation or a more deliberate migration.");
  }
  if (/job/.test(kind) && /template:|containers:|restartpolicy/.test(changes)) {
    items.push("Job pod template edits often cannot be patched in place once the Job exists.");
  }
  if (/deployment|daemonset|statefulset/.test(kind) && /selector:/.test(changes)) {
    items.push("Selector changes are high-risk and commonly immutable for workload controllers.");
  }
  if (opts.immutableHints.length > 0) {
    items.push("Kubernetes already reported immutable-field pressure for this edit shape.");
  }

  if (immutableRisk) {
    return { severity: "error", title: "Likely Recreate Needed", items };
  }
  if (controllerManaged || /secret|ingress|service/.test(kind)) {
    return { severity: "warning", title: "Guarded Live Edit", items };
  }
  if (hasChanges) {
    return { severity: "info", title: "Live Edit Looks Plausible", items };
  }
  return { severity: "success", title: "Ready To Review", items };
}
