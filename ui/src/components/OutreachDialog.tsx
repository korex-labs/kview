import { useEffect, useState, useSyncExternalStore } from "react";
import { Dialog, DialogTitle, DialogContent, DialogActions, FormControlLabel, Switch, Typography, Box } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { AppIconButton, DialogActionButton } from "./shared/AppActions";
import { useUserSettings } from "../settingsContext";
import { setStatisticsConsent, useStatisticsConsent } from "../installationStatistics";

// Not a release version: keep this key stable across upgrades. Never part of settings transfers.
const DECISION_KEY = "kview:outreachInvitationDecision:v1";
const CHANGED = "kview:outreachInvitationDecisionChanged";
let storageFailed = false;
function decided() {
  try { return storageFailed || localStorage.getItem(DECISION_KEY) !== null; }
  catch { return true; } // No reliable storage: no invitation or implicit opt-in.
}
function rememberDecision(): boolean {
  try {
    localStorage.setItem(DECISION_KEY, "done");
    if (localStorage.getItem(DECISION_KEY) !== "done") storageFailed = true;
  }
  catch { storageFailed = true; }
  window.dispatchEvent(new Event(CHANGED));
  return !storageFailed;
}
function subscribe(callback: () => void) {
  window.addEventListener(CHANGED, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGED, callback);
    window.removeEventListener("storage", callback);
  };
}

export default function OutreachDialog({ ready }: { ready: boolean }) {
  const { settings, setSettings } = useUserSettings();
  const statisticsEnabled = useStatisticsConsent();
  const hasDecision = useSyncExternalStore(subscribe, decided, () => true);
  const [releases, setReleases] = useState(false);
  const [statistics, setStatistics] = useState(false);
  const alreadyEnabled = settings.appearance.releaseChecksEnabled || statisticsEnabled;

  useEffect(() => {
    if (alreadyEnabled && !hasDecision) rememberDecision();
  }, [alreadyEnabled, hasDecision]);

  function apply() {
    // Persist the one-time decision before enabling either side effect. Fail closed.
    if (!rememberDecision()) return;
    if (releases) setSettings((previous) => ({
      ...previous, appearance: { ...previous.appearance, releaseChecksEnabled: true },
    }));
    if (statistics) setStatisticsConsent(true);
  }

  return (
    <Dialog open={ready && !hasDecision && !alreadyEnabled} onClose={rememberDecision}
      maxWidth="sm" fullWidth aria-labelledby="outreach-title" aria-describedby="outreach-description">
      <DialogTitle id="outreach-heading">
        <span id="outreach-title">Optional updates and statistics</span>
        <Box sx={{ position: "absolute", right: 12, top: 12 }}>
          <AppIconButton label="Close optional updates and statistics" tooltip="No thanks" onClick={rememberDecision}>
            <CloseIcon />
          </AppIconButton>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography id="outreach-description" sx={{ mb: 2 }}>
          Both options are off by default and independent. You can change them later in Settings → Appearance.
          All Kubernetes features remain available with both off.
        </Typography>
        <FormControlLabel control={<Switch checked={releases} onChange={(_, checked) => setReleases(checked)} />}
          label="Check for kview updates" />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Fetch release metadata through your backend from korex-labs.com, with GitHub as a fallback.
          Update checks do not create an installation ID or send installation statistics.
        </Typography>
        <FormControlLabel control={<Switch checked={statistics} onChange={(_, checked) => setStatistics(checked)} />}
          label="Share anonymous installation statistics" />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Send the kview version and a random, stable installation UUID to korex-labs.com.
          Country is derived from your backend connection (possibly a server or VPN exit).
          No Kubernetes data, kubeconfig, hostname, or user data is included.
        </Typography>
        <Box component="details">
          <Typography component="summary" sx={{ cursor: "pointer" }}>Privacy and retention details</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>
            The backend creates the UUID only after you enable statistics. Raw daily activity is kept for 90 days
            (cleanup backlogs may take longer). The pseudonymous UUID registry with first/last report times and
            latest version/country, and non-identifying daily aggregate counts, are retained indefinitely.
            A random ID is not irreversible anonymity. The HTTPS provider sees the source IP; the statistics
            database does not store IPs or user agents. Turning statistics off cancels pending requests and
            stops future reports, but does not delete previously reported data or the local ID.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <DialogActionButton action="cancel" onClick={rememberDecision}>No thanks</DialogActionButton>
        <DialogActionButton action="primary" onClick={apply}>Apply selected</DialogActionButton>
      </DialogActions>
    </Dialog>
  );
}
