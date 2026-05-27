import React, { useMemo } from "react";
import { Box, Chip, Tooltip } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { useActiveContext } from "../../activeContext";
import { dynamicLinksForResource, type ResourceMacroTarget } from "../../resourceMacros";
import { useUserSettings } from "../../settingsContext";
import { CHIP_BORDER_RADIUS } from "../../theme/sxTokens";
import type { ListResourceKey } from "../../utils/k8sResources";

export default function ResourceDynamicLinks({
  resource,
  namespace,
  name,
  nodeName,
  labels,
  annotations,
}: {
  resource: ListResourceKey;
  namespace?: string | null;
  name?: string | null;
  nodeName?: string | null;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}) {
  const context = useActiveContext();
  const { settings } = useUserSettings();
  const target = useMemo<ResourceMacroTarget | null>(() => {
    if (!name) return null;
    return {
      context,
      resource,
      namespace: namespace || "",
      name,
      nodeName: nodeName || "",
      labels,
      annotations,
    };
  }, [annotations, context, labels, name, namespace, nodeName, resource]);
  const links = useMemo(
    () => target ? dynamicLinksForResource(settings.resourceMacros, settings.dynamicLinks, target) : [],
    [settings.dynamicLinks, settings.resourceMacros, target],
  );
  if (!target || links.length === 0) return null;

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", minWidth: 0 }}>
      {links.map((link) => (
        <Tooltip key={link.id} title={link.url}>
          <Chip
            component="a"
            href={link.url}
            target="_blank"
            rel="noreferrer"
            size="small"
            variant="outlined"
            icon={<OpenInNewIcon />}
            label={link.label}
            clickable
            sx={{
              borderRadius: CHIP_BORDER_RADIUS,
              height: 24,
              minWidth: 0,
              maxWidth: 180,
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: "primary.main",
              color: "primary.main",
              textDecoration: "none",
              bgcolor: "transparent",
              "&:hover": {
                borderColor: "primary.dark",
                bgcolor: "action.hover",
              },
              "& .MuiChip-icon": {
                fontSize: 15,
                color: "primary.main",
              },
              "& .MuiChip-label": {
                px: 0.75,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
              },
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}
