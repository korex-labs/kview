import React, { createContext, useContext, useMemo, useState } from "react";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import { apiPostWithContext } from "../../api";
import { useActiveContext } from "../../activeContext";
import { useUserSettings } from "../../settingsContext";
import type { DashboardSignalItem } from "../../types/api";
import {
  applySignalExclusionsToSettings,
  buildQuickSignalExclusionDraft,
  quickSignalExclusionTarget,
  type QuickSignalExclusionTarget,
  type SignalExclusionScope,
} from "../../signalExclusions";
import type { SignalExclusionSet } from "../../settings";
import SignalExclusionsDialog, { type SignalExclusionPreview } from "../settings/SignalExclusionsDialog";
import { AppIconButton } from "./AppActions";

const QuickSignalExclusionContext = createContext<(signal: DashboardSignalItem) => void>(() => undefined);

export function QuickSignalExclusionProvider({ token, children }: { token: string; children: React.ReactNode }) {
  const activeContext = useActiveContext();
  const { settings, setSettings } = useUserSettings();
  const [target, setTarget] = useState<QuickSignalExclusionTarget | null>(null);
  const [scope, setScope] = useState<SignalExclusionScope>("context");
  const [ruleID, setRuleID] = useState("");

  const draft = useMemo(() => {
    if (!target) return undefined;
    return buildQuickSignalExclusionDraft(settings, target, scope, activeContext, ruleID || undefined);
  }, [activeContext, ruleID, scope, settings, target]);

  const open = (signal: DashboardSignalItem) => {
    const nextTarget = quickSignalExclusionTarget(signal);
    if (!nextTarget) return;
    setTarget(nextTarget);
    setScope(activeContext ? "context" : "global");
    setRuleID(`exclude-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  };

  const close = () => {
    setTarget(null);
    setRuleID("");
  };

  const save = (exclusions: SignalExclusionSet) => {
    if (!target) return;
    setSettings((current) => applySignalExclusionsToSettings(current, target.signalType, scope, activeContext, exclusions));
  };

  const preview = async (exclusions: SignalExclusionSet): Promise<SignalExclusionPreview> => {
    if (!target || !activeContext) throw new Error("Missing active context");
    return apiPostWithContext<SignalExclusionPreview>(
      "/api/dataplane/signals/exclusions/preview",
      token,
      activeContext,
      { signalType: target.signalType, exclusions },
    );
  };

  return (
    <QuickSignalExclusionContext.Provider value={open}>
      {children}
      {target && draft ? (
        <SignalExclusionsDialog
          open
          signalLabel={target.signalLabel}
          scope={scope}
          contextName={activeContext}
          inheritedRules={settings.dataplane.global.signals.overrides[target.signalType]?.exclusions?.rules || []}
          exclusions={draft}
          onClose={close}
          onSave={save}
          onUseInherited={() => undefined}
          onPreview={preview}
          onScopeChange={setScope}
          showUseInherited={false}
        />
      ) : null}
    </QuickSignalExclusionContext.Provider>
  );
}

export function QuickSignalExclusionButton({ signal }: { signal: DashboardSignalItem }) {
  const open = useContext(QuickSignalExclusionContext);
  if (!quickSignalExclusionTarget(signal)) return null;
  return (
    <AppIconButton
      tooltip="Exclude this signal"
      label="Exclude this signal"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        open(signal);
      }}
      sx={{ p: 0.25 }}
    >
      <VisibilityOffOutlinedIcon fontSize="inherit" />
    </AppIconButton>
  );
}
