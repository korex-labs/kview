import React, { useState } from "react";
import { Box, Button } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import CodeBlock from "./CodeBlock";
import DrawerActionStrip from "./DrawerActionStrip";
import YamlEditDialog from "./YamlEditDialog";
import { canPatchOrUpdate, RBAC_DISABLED_REASON, useResourceCapabilities } from "../mutations/useResourceCapabilities";
import { useUserSettings } from "../../settingsContext";

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
  const canEdit = target ? canPatchOrUpdate(caps) : false;

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1, height: "100%" }}>
      <DrawerActionStrip>
        <Button size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </Button>
        {target && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<EditIcon />}
            disabled={!canEdit}
            title={!canEdit && caps ? RBAC_DISABLED_REASON : "Edit live YAML"}
            onClick={() => setEditOpen(true)}
          >
            Edit
          </Button>
        )}
      </DrawerActionStrip>
      <Box sx={{ minHeight: 0, flex: 1 }}>
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
