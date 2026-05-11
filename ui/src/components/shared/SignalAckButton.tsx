import React, { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { apiDelete, apiPost } from "../../api";
import type { DashboardSignalItem } from "../../types/api";

type Props = {
  token: string;
  signal: DashboardSignalItem;
  onChanged?: (acknowledged: boolean) => void;
};

export default function SignalAckButton({ token, signal, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState(signal.acknowledgementComment || "");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(!!signal.acknowledged);

  const historyKey = signal.historyKey || "";
  if (!historyKey) return null;

  const title = acknowledged
    ? signal.acknowledgementComment || comment.trim()
      ? `Acknowledged: ${signal.acknowledgementComment || comment.trim()}`
      : "Edit acknowledgement"
    : "Acknowledge signal";

  async function acknowledge() {
    setBusy(true);
    try {
      await apiPost("/api/dataplane/signals/ack", token, { historyKey, comment });
      setAcknowledged(true);
      setOpen(false);
      onChanged?.(true);
    } finally {
      setBusy(false);
    }
  }

  async function clearAcknowledgement() {
    setBusy(true);
    try {
      await apiDelete("/api/dataplane/signals/ack", token, { historyKey });
      setAcknowledged(false);
      setComment("");
      setOpen(false);
      onChanged?.(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Tooltip title={title}>
        <IconButton
          size="small"
          aria-label={acknowledged ? "Clear signal acknowledgement" : "Acknowledge signal"}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          disabled={busy}
          color={acknowledged ? "success" : "default"}
          sx={{ p: 0.25 }}
        >
          {acknowledged ? <CheckCircleIcon fontSize="inherit" /> : <CheckCircleOutlineIcon fontSize="inherit" />}
        </IconButton>
      </Tooltip>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        onClick={(event) => event.stopPropagation()}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>{acknowledged ? "Edit acknowledgement" : "Acknowledge signal"}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {signal.reason}
            </Typography>
            <TextField
              autoFocus
              multiline
              minRows={3}
              label="Comment"
              placeholder="Optional context for later"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          {acknowledged ? (
            <Button color="error" onClick={clearAcknowledgement} disabled={busy}>Clear acknowledgement</Button>
          ) : null}
          <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button variant="contained" onClick={acknowledge} disabled={busy}>
            {acknowledged ? "Save" : "Acknowledge"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
