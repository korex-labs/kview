import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import DataObjectIcon from "@mui/icons-material/DataObject";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import FactCheckIcon from "@mui/icons-material/FactCheck";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import InsightsIcon from "@mui/icons-material/Insights";
import ManageSearchIcon from "@mui/icons-material/ManageSearch";
import RuleIcon from "@mui/icons-material/Rule";
import TravelExploreIcon from "@mui/icons-material/TravelExplore";
import { apiPost } from "../../api";
import type {
  DashboardSignalItem,
  SignalInvestigationHelperRun,
  SignalInvestigationItem,
  SignalInvestigationResourceRef,
  SignalInvestigationResult,
} from "../../types/api";
import { DialogActionButton } from "./AppActions";
import CodeBlock from "./CodeBlock";
import EmptyState from "./EmptyState";
import StatusChip from "./StatusChip";
import { signalCalculatedText, signalSeverityColor } from "./signalFormat";

type Props = {
  token: string;
  signal: DashboardSignalItem | null;
  onClose: () => void;
};

type InvestigationResponse = {
  active?: string;
  item?: SignalInvestigationResult;
};

const panelSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 1,
  p: 1.25,
  backgroundColor: "background.paper",
};

const subtlePanelSx = {
  border: "1px solid var(--panel-border)",
  borderRadius: 1,
  p: 1.25,
  backgroundColor: "action.hover",
};

const sectionColumnSx = {
  display: "flex",
  flexDirection: "column",
  gap: 1,
};

function resourceLabel(ref?: SignalInvestigationResourceRef): string {
  if (!ref) return "-";
  if (ref.namespace) return `${ref.namespace}/${ref.name}`;
  return ref.name || "-";
}

function signalKey(signal: DashboardSignalItem): string {
  return [
    signal.historyKey,
    signal.signalType,
    signal.kind,
    signal.namespace,
    signal.name,
    signal.reason,
  ].filter(Boolean).join("/");
}

function hasItems(items?: SignalInvestigationItem[]) {
  return Array.isArray(items) && items.length > 0;
}

function helperHasDetails(helper: SignalInvestigationHelperRun) {
  return hasItems(helper.evidence) || hasItems(helper.nextSteps) || hasItems(helper.unknowns) || !!helper.summary;
}

function helperIcon(name: string): SvgIconComponent {
  switch (name) {
    case "events": return TravelExploreIcon;
    case "logs": return ErrorOutlineIcon;
    case "yaml": return DataObjectIcon;
    default: return RuleIcon;
  }
}

function helperTone(status: string): "default" | "success" | "warning" | "error" | "info" {
  switch (status) {
    case "ok": return "success";
    case "error": return "error";
    case "skipped":
    case "unavailable": return "warning";
    default: return "info";
  }
}

function PanelHeader({
  icon: Icon,
  title,
  meta,
}: {
  icon: SvgIconComponent;
  title: string;
  meta?: React.ReactNode;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}>
      <Icon fontSize="small" color="primary" />
      <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 0 }}>
        {title}
      </Typography>
      {meta ? <Box sx={{ ml: "auto", display: "flex", alignItems: "center", gap: 0.5 }}>{meta}</Box> : null}
    </Box>
  );
}

function ItemList({ items }: { items?: SignalInvestigationItem[] }) {
  if (!hasItems(items)) return null;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.85 }}>
      {items?.map((item) => (
        <Box
          key={`${item.label}-${item.value}`}
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", sm: "140px minmax(0, 1fr)" },
            gap: { xs: 0.25, sm: 1 },
            alignItems: "start",
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {item.label}
          </Typography>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere", lineHeight: 1.45 }}>
            {item.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

function EvidencePanel({
  icon,
  title,
  items,
}: {
  icon: SvgIconComponent;
  title: string;
  items?: SignalInvestigationItem[];
}) {
  if (!hasItems(items)) return null;
  return (
    <Box sx={panelSx}>
      <Box sx={{ ...sectionColumnSx, gap: 1 }}>
        <PanelHeader icon={icon} title={title} />
        <ItemList items={items} />
      </Box>
    </Box>
  );
}

function SignalHero({ signal }: { signal: DashboardSignalItem }) {
  const calculated = signalCalculatedText(signal);
  return (
    <Box sx={subtlePanelSx}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          <StatusChip size="small" color={signalSeverityColor(signal.severity)} label={signal.severity} />
          <Chip size="small" variant="outlined" label={signal.resourceKind || signal.kind} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {signal.resourceName || signal.name || signal.namespace || "-"}
          </Typography>
        </Box>
        <Typography variant="body2" sx={{ overflowWrap: "anywhere", lineHeight: 1.45 }}>
          {signal.reason}
        </Typography>
        {calculated ? (
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {calculated}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}

function ResourceRefRow({ ref }: { ref: SignalInvestigationResourceRef }) {
  return (
    <Box sx={panelSx}>
      <Box sx={{ display: "flex", gap: 0.75, alignItems: "center", flexWrap: "wrap" }}>
        <Chip size="small" variant="outlined" label={ref.kind} />
        <Typography variant="body2" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
          {resourceLabel(ref)}
        </Typography>
        <Chip size="small" label={ref.relation} color="info" variant="outlined" />
      </Box>
      {ref.evidence ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75, overflowWrap: "anywhere" }}>
          {ref.evidence}
        </Typography>
      ) : null}
    </Box>
  );
}

function SignalCard({ signal }: { signal: DashboardSignalItem }) {
  return <SignalHero signal={signal} />;
}

function HelperCard({ helper }: { helper: SignalInvestigationHelperRun }) {
  const Icon = helperIcon(helper.name);
  return (
    <Box sx={panelSx}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <PanelHeader
          icon={Icon}
          title={helper.name}
          meta={<Chip size="small" color={helperTone(helper.status)} label={helper.status} />}
        />
        {helper.summary ? (
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere", lineHeight: 1.45 }}>
            {helper.summary}
          </Typography>
        ) : null}
        <ItemList items={helper.evidence} />
        {hasItems(helper.nextSteps) ? (
          <Box sx={{ borderTop: "1px solid var(--panel-border)", pt: 1 }}>
            <PanelHeader icon={FactCheckIcon} title="Targeted checks" />
            <Box sx={{ mt: 1 }}>
              <ItemList items={helper.nextSteps} />
            </Box>
          </Box>
        ) : null}
        {hasItems(helper.unknowns) ? (
          <Box sx={{ borderTop: "1px solid var(--panel-border)", pt: 1 }}>
            <PanelHeader icon={HelpOutlineIcon} title="Unavailable checks" />
            <Box sx={{ mt: 1 }}>
              <ItemList items={helper.unknowns} />
            </Box>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

export default function SignalInvestigationDialog({ token, signal, onClose }: Props) {
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SignalInvestigationResult | null>(null);
  const requestKey = useMemo(() => (signal ? signalKey(signal) : ""), [signal]);
  const usefulHelpers = useMemo(() => (result?.helpers || []).filter(helperHasDetails), [result?.helpers]);
  const hasEvidence =
    usefulHelpers.length > 0 ||
    (result?.relatedSignals?.length || 0) > 0 ||
    (result?.relatedResources?.length || 0) > 0;

  useEffect(() => {
    if (!signal || !token) {
      setResult(null);
      setError("");
      setLoading(false);
      return;
    }
    let cancelled = false;
    setTab(0);
    setLoading(true);
    setError("");
    setResult(null);
    apiPost<InvestigationResponse>("/api/dataplane/signals/investigate", token, { signal })
      .then((res) => {
        if (!cancelled) setResult(res.item || null);
      })
      .catch((err) => {
        if (!cancelled) setError(String((err as Error | undefined)?.message || err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, signal, token]);

  return (
    <Dialog open={!!signal} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        <ManageSearchIcon fontSize="small" color="primary" />
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" component="span" sx={{ fontWeight: 700 }}>
            Signal investigation
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.25, minHeight: 560 }}>
        {loading ? <LinearProgress /> : null}
        {error ? <EmptyState message={`Could not build investigation bundle: ${error}`} /> : null}
        {result ? (
          <>
            <SignalHero signal={result.signal} />
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="scrollable"
              allowScrollButtonsMobile
              sx={{ minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }}
            >
              <Tab icon={<InsightsIcon fontSize="small" />} iconPosition="start" label="Summary" />
              <Tab icon={<FactCheckIcon fontSize="small" />} iconPosition="start" label="Evidence" />
              <Tab icon={<TravelExploreIcon fontSize="small" />} iconPosition="start" label="Context" />
              <Tab icon={<DataObjectIcon fontSize="small" />} iconPosition="start" label="Export" />
            </Tabs>
            <Divider />
            {tab === 0 ? (
              <Box sx={sectionColumnSx}>
                <Box sx={panelSx}>
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <PanelHeader
                      icon={InsightsIcon}
                      title="Diagnosis"
                      meta={<Chip size="small" color="info" variant="outlined" label={result.diagnosis.confidence || "unknown"} />}
                    />
                    <Typography variant="body2" sx={{ overflowWrap: "anywhere", lineHeight: 1.5 }}>
                      {result.diagnosis.summary}
                    </Typography>
                  </Box>
                </Box>
                <ResourceRefRow ref={result.primaryResource} />
                <EvidencePanel icon={RuleIcon} title="Findings" items={result.diagnosis.evidence} />
                <EvidencePanel icon={FactCheckIcon} title="Targeted checks" items={result.diagnosis.nextSteps} />
                <EvidencePanel icon={HelpOutlineIcon} title="Unavailable checks" items={result.diagnosis.unknowns} />
              </Box>
            ) : null}
            {tab === 1 ? (
              !hasEvidence ? (
                <EmptyState message="No concrete findings were produced by the current helpers." />
              ) : (
                <Box sx={sectionColumnSx}>
                  {usefulHelpers.length > 0 ? (
                    <Box sx={sectionColumnSx}>
                      <PanelHeader icon={FactCheckIcon} title="Helper findings" />
                      {usefulHelpers.map((helper) => <HelperCard key={helper.name} helper={helper} />)}
                    </Box>
                  ) : null}
                  {(result.relatedSignals || []).length > 0 || (result.relatedResources || []).length > 0 ? (
                    <Box sx={sectionColumnSx}>
                      {(result.relatedResources || []).length > 0 ? (
                        <>
                          <PanelHeader icon={TravelExploreIcon} title="Strongly related resources" />
                          {result.relatedResources?.map((ref) => (
                            <ResourceRefRow key={`${ref.kind}-${ref.namespace || ""}-${ref.name}`} ref={ref} />
                          ))}
                        </>
                      ) : null}
                      {(result.relatedSignals || []).length > 0 ? (
                        <>
                          <PanelHeader icon={InsightsIcon} title="Same-resource signals" />
                          {result.relatedSignals?.map((item) => <SignalCard key={signalKey(item)} signal={item} />)}
                        </>
                      ) : null}
                    </Box>
                  ) : null}
                </Box>
              )
            ) : null}
            {tab === 2 ? (
              <Box sx={sectionColumnSx}>
                <PanelHeader icon={TravelExploreIcon} title="Weak context signals" />
                {(result.contextSignals || []).length === 0 ? (
                  <EmptyState message="No namespace or same-type context signals were found." />
                ) : (
                  result.contextSignals?.map((item) => <SignalCard key={signalKey(item)} signal={item} />)
                )}
              </Box>
            ) : null}
            {tab === 3 ? <CodeBlock code={result.exportMarkdown || ""} language="markdown" /> : null}
          </>
        ) : null}
      </DialogContent>
      <Box sx={{ display: "flex", justifyContent: "flex-end", p: 1.5, pt: 0 }}>
        <DialogActionButton action="cancel" onClick={onClose}>Close</DialogActionButton>
      </Box>
    </Dialog>
  );
}
