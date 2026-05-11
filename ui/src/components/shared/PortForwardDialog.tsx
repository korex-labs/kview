import React from "react";
import {
  Box,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { DialogActionButton } from "./AppActions";

export type PortForwardOption = {
  value: string;
  label: string;
};

type Props = {
  open: boolean;
  busy?: boolean;
  targetLabel: string;
  remotePort: string;
  localPort: string;
  error?: string;
  disabled?: boolean;
  disabledReason?: string;
  remotePortOptions?: PortForwardOption[];
  onChangeRemotePort: (value: string) => void;
  onChangeLocalPort: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export default function PortForwardDialog({
  open,
  busy,
  targetLabel,
  remotePort,
  localPort,
  error,
  disabled,
  disabledReason,
  remotePortOptions,
  onChangeRemotePort,
  onChangeLocalPort,
  onClose,
  onSubmit,
}: Props) {
  const options = remotePortOptions || [];
  const hasOptions = options.length > 0;

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle>Port forward</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 0.5 }}>
          <Typography variant="body2" color="text.secondary">
            {targetLabel}
          </Typography>
          {disabled && disabledReason ? (
            <Typography variant="caption" color="error">
              {disabledReason}
            </Typography>
          ) : null}
          {hasOptions ? (
            <FormControl size="small" fullWidth>
              <InputLabel id="pf-remote-port-label">Remote port</InputLabel>
              <Select
                labelId="pf-remote-port-label"
                label="Remote port"
                value={remotePort}
                onChange={(e) => onChangeRemotePort(String(e.target.value))}
                disabled={disabled || busy}
                autoFocus
              >
                {options.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <TextField
              label="Remote port"
              type="number"
              size="small"
              value={remotePort}
              onChange={(e) => onChangeRemotePort(e.target.value)}
              helperText="Container port to forward"
              disabled={disabled || busy}
              fullWidth
              autoFocus
            />
          )}
          <TextField
            label="Local port (optional)"
            type="number"
            size="small"
            value={localPort}
            onChange={(e) => onChangeLocalPort(e.target.value)}
            helperText="Empty = try same as remote first, then pick free port"
            disabled={disabled || busy}
            fullWidth
          />
          {error && (
            <Typography variant="caption" color="error">
              {error}
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <DialogActionButton
          action="cancel"
          onClick={() => {
            if (busy) return;
            onClose();
          }}
        >
          Cancel
        </DialogActionButton>
        <DialogActionButton action="primary" onClick={onSubmit} disabled={busy || disabled}>
          {busy ? "Starting..." : "Start"}
        </DialogActionButton>
      </DialogActions>
    </Dialog>
  );
}
