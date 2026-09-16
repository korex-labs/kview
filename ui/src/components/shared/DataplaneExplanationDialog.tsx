import { useEffect, useId, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from "@mui/material";
import { apiGetWithContext } from "../../api";
import type {
  ApiDataplaneExplanationResponse,
  DataplaneExplanationItem,
} from "../../types/api";
import { DialogActionButton } from "./AppActions";
import {
  buildDataplaneExplanationModel,
  type DataplaneExplanationSurface,
} from "./dataplaneExplanationModel";

export type DataplaneExplanationDialogProps = {
  open: boolean;
  onClose: () => void;
  token: string;
  activeContext: string;
  surface: DataplaneExplanationSurface;
};

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");
}

export default function DataplaneExplanationDialog({
  open,
  onClose,
  token,
  activeContext,
  surface,
}: DataplaneExplanationDialogProps) {
  const idPrefix = useId();
  const titleId = `${idPrefix}-dataplane-explanation-title`;
  const [runtime, setRuntime] = useState<DataplaneExplanationItem | undefined>();
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRuntime(undefined);
    setRuntimeError(null);
    setLoading(false);
    if (!open) return undefined;

    const requestedContext = activeContext.trim();
    if (!requestedContext) {
      setRuntimeError("Runtime explanation unavailable: select an active context.");
      return undefined;
    }

    const controller = new AbortController();
    let current = true;
    setLoading(true);
    void apiGetWithContext<ApiDataplaneExplanationResponse>(
      "/api/dataplane/explanation",
      token,
      requestedContext,
      { signal: controller.signal },
    ).then((response) => {
      if (!current) return;
      if (response.active !== requestedContext) {
        setRuntimeError("Runtime explanation unavailable");
        return;
      }
      setRuntime(response.item);
    }).catch((error: unknown) => {
      if (!current || isAbortError(error)) return;
      setRuntimeError("Runtime explanation unavailable");
    }).finally(() => {
      if (current) setLoading(false);
    });

    return () => {
      current = false;
      controller.abort();
    };
  }, [activeContext, open, token]);

  const model = useMemo(
    () => buildDataplaneExplanationModel(surface, runtime, { loading }),
    [loading, runtime, surface],
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" aria-labelledby={titleId}>
      <DialogTitle component="h2" id={titleId}>Dataplane explanation</DialogTitle>
      <DialogContent sx={{ overflowX: "hidden" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25, pt: 0.5, minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary">
            Surface snapshot facts stay authoritative. Runtime evidence only explains the active context.
          </Typography>
          {runtimeError ? <Alert severity="info" role="alert">{runtimeError}</Alert> : null}
          {loading ? (
            <Box
              role="status"
              aria-live="polite"
              aria-label="Loading runtime explanation"
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
            >
              <CircularProgress size={16} aria-hidden="true" />
              <Typography variant="caption" color="text.secondary">Loading runtime explanation…</Typography>
            </Box>
          ) : null}
          {model.sections.map((section, sectionIndex) => {
            const headingId = `${idPrefix}-dataplane-explanation-section-${sectionIndex}-heading`;
            return (
              <Box
              component="section"
              key={`${idPrefix}:${section.key}:${sectionIndex}`}
              aria-labelledby={headingId}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1, minWidth: 0 }}
            >
              <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
                <Typography
                  component="h3"
                  id={headingId}
                  variant="subtitle2"
                  sx={{ flexGrow: 1 }}
                >
                  {section.label}
                </Typography>
                <Chip size="small" variant="outlined" label={section.status} />
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: "anywhere" }}>
                {section.summary}
              </Typography>
              {section.details.length > 0 ? (
                <Box component="details" sx={{ mt: 0.5 }}>
                  <Typography component="summary" variant="caption" sx={{ cursor: "pointer" }}>Evidence</Typography>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25, mt: 0.5 }}>
                    {section.details.map((detail, detailIndex) => (
                      <Typography key={`${idPrefix}:${section.key}:${detail.label}:${detailIndex}`} variant="caption" sx={{ overflowWrap: "anywhere" }}>
                        <Box component="span" sx={{ color: "text.secondary" }}>{detail.label}: </Box>
                        {detail.value}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              ) : null}
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <DialogActionButton action="cancel" onClick={onClose}>Close</DialogActionButton>
      </DialogActions>
    </Dialog>
  );
}
