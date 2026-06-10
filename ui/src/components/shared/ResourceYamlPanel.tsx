import React, { useState } from "react";
import { Box } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import CodeBlock from "./CodeBlock";
import DrawerActionStrip from "./DrawerActionStrip";
import YamlEditDialog from "./YamlEditDialog";
import { RBAC_DISABLED_REASON, useResourceCapabilities } from "../mutations/useResourceCapabilities";
import { useUserSettings } from "../../settingsContext";
import { AppButton } from "./AppActions";

type EditTarget = {
  kind: string;
  group: string;
  resource: string;
  apiVersion: string;
  namespace?: string;
  name: string;
};

type Props = {
  code: string;
  token: string;
  target?: EditTarget;
  onApplied?: () => void;
};

export default function ResourceYamlPanel({ code, token, target, onApplied }: Props) {
  const { settings } = useUserSettings();
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const caps = useResourceCapabilities({
    token,
    group: target?.group || "",
    resource: target?.resource || "",
    namespace: target?.namespace || "",
    name: target?.name || "",
  });
  const canEdit = target ? !!caps?.patch : false;

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%", minWidth: 0 }}>
      <DrawerActionStrip>
        <AppButton startIcon={<ContentCopyIcon />} onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </AppButton>
        {target && (
          <AppButton
            startIcon={<EditIcon />}
            disabled={!canEdit}
            tooltip={!canEdit && caps ? RBAC_DISABLED_REASON : "Patch live YAML"}
            onClick={() => setEditOpen(true)}
          >
            Patch
          </AppButton>
        )}
      </DrawerActionStrip>
      <Box sx={{ minHeight: 0, minWidth: 0, flex: 1 }}>
        <CodeBlock code={code} language="yaml" showCopy={false} smartCollapse={settings.appearance.yamlSmartCollapse} />
      </Box>
      {target && (
        <YamlEditDialog
          open={editOpen}
          onClose={() => setEditOpen(false)}
          token={token}
          target={target}
          initialYaml={code}
          onApplied={onApplied}
        />
      )}
    </Box>
  );
}
