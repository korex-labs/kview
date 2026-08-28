import React, { useRef, useState } from "react";
import NotificationsPausedOutlinedIcon from "@mui/icons-material/NotificationsPausedOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import { Alert, Box, Menu, MenuItem, TextField } from "@mui/material";
import { apiDelete, apiPost } from "../../api";
import { dispatchSignalSuppressionsChanged } from "../../signalSuppressions";
import type { DashboardSignalItem, SignalSuppressionMetadata } from "../../types/api";
import { AppIconButton } from "./AppActions";

type Props = {
  token: string;
  signal: DashboardSignalItem;
  onChanged?: () => void;
};

const VALID_STATE_FINGERPRINT = /^v1:[0-9a-f]{64}$/;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Signal suppression request failed";
}

function suppressionDescription(suppression: SignalSuppressionMetadata): string {
  const mode = suppression.mode === "until_changed" ? "Ignored until changed" : "Snoozed";
  const expiry = suppression.expiresAt
    ? ` until ${new Date(suppression.expiresAt * 1000).toLocaleString()}`
    : "";
  const comment = suppression.comment?.trim() ? `. Comment: ${suppression.comment.trim()}` : "";
  return `${mode}${expiry}${comment}`;
}

export default function SignalSuppressionButton({ token, signal, onChanged }: Props) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const busyRef = useRef(false);
  const historyKey = signal.clientSynthesizedHistoryKey ? "" : signal.historyKey?.trim() || "";

  if (!historyKey) return null;

  const finishSuccess = () => {
    setAnchorEl(null);
    setError("");
    dispatchSignalSuppressionsChanged();
    onChanged?.();
  };

  const postSuppression = async (body: Record<string, unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await apiPost("/api/dataplane/signals/suppress", token, body);
      finishSuccess();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const showNow = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await apiDelete("/api/dataplane/signals/suppress", token, { historyKey });
      finishSuccess();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (signal.suppression) {
    const description = suppressionDescription(signal.suppression);
    return (
      <Box component="span" sx={{ display: "inline-flex", alignItems: "center" }} onClick={(event) => event.stopPropagation()}>
        <AppIconButton
          tooltip={`Show signal now. ${description}`}
          label={`Show signal now. ${description}`}
          disabled={busy}
          color="warning"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            void showNow();
          }}
          sx={{ p: 0.25 }}
        >
          <VisibilityOutlinedIcon fontSize="inherit" />
        </AppIconButton>
        {error ? <Alert severity="error" sx={{ py: 0, px: 0.5, ml: 0.5 }}>{error}</Alert> : null}
      </Box>
    );
  }

  const trimmedComment = comment.trim();
  const validFingerprint = typeof signal.stateFingerprint === "string"
    && VALID_STATE_FINGERPRINT.test(signal.stateFingerprint);

  return (
    <>
      <AppIconButton
        tooltip="Suppress signal"
        label="Suppress signal"
        disabled={busy}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setError("");
          setAnchorEl(event.currentTarget);
        }}
        sx={{ p: 0.25 }}
      >
        <NotificationsPausedOutlinedIcon fontSize="inherit" />
      </AppIconButton>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => {
          if (!busy) setAnchorEl(null);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        slotProps={{ paper: { sx: { width: 300, maxWidth: "calc(100vw - 32px)" } } }}
      >
        <Box sx={{ px: 1.5, pt: 0.5, pb: 1 }}>
          <TextField
            fullWidth
            size="small"
            label="Comment (optional)"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
            disabled={busy}
          />
        </Box>
        <MenuItem
          disabled={busy}
          onClick={() => void postSuppression({ historyKey, mode: "snooze", durationSeconds: 3600, comment: trimmedComment })}
        >
          Snooze 1 hour
        </MenuItem>
        <MenuItem
          disabled={busy}
          onClick={() => void postSuppression({ historyKey, mode: "snooze", durationSeconds: 86400, comment: trimmedComment })}
        >
          Snooze 1 day
        </MenuItem>
        <MenuItem
          disabled={busy || !validFingerprint}
          title={validFingerprint ? undefined : "Ignore until changed requires a valid state fingerprint"}
          onClick={() => {
            if (!validFingerprint) return;
            void postSuppression({
              historyKey,
              mode: "until_changed",
              baselineFingerprint: signal.stateFingerprint,
              comment: trimmedComment,
            });
          }}
        >
          Ignore until changed
        </MenuItem>
        {error ? <Alert severity="error" sx={{ m: 1, py: 0 }}>{error}</Alert> : null}
      </Menu>
    </>
  );
}
