import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Chip,
  Drawer,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  TextField,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Divider,
  Autocomplete,
  IconButton,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import { sortNamespaces, type Section } from "../state";
import ResourceIcon from "./icons/resources/ResourceIcon";
import { getResourceIcon, getResourceLabel, isClusterScopedSection, sidebarGroups } from "../utils/k8sResources";
import {
  getLatestReleaseWithCache,
  isComparableReleaseVersion,
  isUpdateAvailable,
  RELEASE_CHECK_INTERVAL_MS,
  type LatestRelease,
} from "../releaseCheck";

type Props = {
  contexts: Array<{ name: string }>;
  activeContext: string;
  onSelectContext: (name: string) => void;

  namespaces: string[];
  namespace: string;
  onSelectNamespace: (ns: string) => void;
  nsLimited: boolean;

  favourites: string[];
  recentNamespaces?: string[];
  smartNamespaceSorting?: boolean;
  onToggleFavourite: (ns: string) => void;

  section: Section;
  onSelectSection: (s: Section) => void;
  buildVersion?: string;
  releaseChecksEnabled?: boolean;
};

const drawerWidth = 320;

export default function Sidebar(props: Props) {
  const [nsInput, setNsInput] = useState("");
  const [latestRelease, setLatestRelease] = useState<LatestRelease | null>(null);
  const isClusterScoped = isClusterScopedSection(props.section);
  const currentVersion = props.buildVersion || "dev";

  const favSet = useMemo(() => new Set(props.favourites), [props.favourites]);

  const sortedNamespaces = useMemo(() => {
    return sortNamespaces(
      props.namespaces,
      props.favourites,
      props.recentNamespaces || [],
      Boolean(props.smartNamespaceSorting),
    );
  }, [props.favourites, props.namespaces, props.recentNamespaces, props.smartNamespaceSorting]);

  useEffect(() => {
    if (!props.releaseChecksEnabled) {
      setLatestRelease(null);
      return;
    }
    if (!isComparableReleaseVersion(currentVersion)) {
      setLatestRelease(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    const checkLatestRelease = async () => {
      try {
        const release = await getLatestReleaseWithCache(controller.signal);
        if (!cancelled) setLatestRelease(release);
      } catch {
        if (!cancelled) setLatestRelease(null);
      }
    };

    void checkLatestRelease();
    const id = window.setInterval(checkLatestRelease, RELEASE_CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(id);
    };
  }, [currentVersion, props.releaseChecksEnabled]);

  const updateAvailable = latestRelease
    ? isUpdateAvailable(currentVersion, latestRelease.latestTag)
    : false;
  const updateRelease = updateAvailable ? latestRelease : null;

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: "border-box", pt: 10, px: 2 },
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%", minHeight: 0 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="ctx-label">Context</InputLabel>
            <Select
              labelId="ctx-label"
              label="Context"
              value={props.activeContext || ""}
              onChange={(e) => props.onSelectContext(String(e.target.value))}
            >
              {props.contexts.map((c) => (
                <MenuItem key={c.name} value={c.name}>
                  {c.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {isClusterScoped ? (
            <TextField
              size="small"
              label="Namespace"
              value="-"
              disabled
              helperText="Cluster-scoped resource"
            />
          ) : !props.nsLimited ? (
            <Autocomplete
              size="small"
              options={sortedNamespaces}
              value={props.namespace || null}
              inputValue={nsInput}
              onInputChange={(_, v) => setNsInput(v)}
              onChange={(_, v) => props.onSelectNamespace(v || "")}
              renderInput={(params) => <TextField {...params} label="Namespace" />}
              renderOption={(optionProps, option) => {
                const isFav = favSet.has(option);
                return (
                  <li {...optionProps} key={option} style={{ display: "flex", alignItems: "center" }}>
                    <Box sx={{ flexGrow: 1 }}>{option}</Box>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        props.onToggleFavourite(option);
                      }}
                    >
                      {isFav ? <StarIcon fontSize="small" /> : <StarBorderIcon fontSize="small" />}
                    </IconButton>
                  </li>
                );
              }}
              filterOptions={(opts, state) => {
                const q = state.inputValue.trim().toLowerCase();
                if (!q) return opts;
                return opts.filter((n) => n.toLowerCase().includes(q));
              }}
            />
          ) : (
            <TextField
              size="small"
              label="Namespace (manual)"
              value={props.namespace}
              onChange={(e) => props.onSelectNamespace(e.target.value)}
              helperText="Namespace list is unavailable. Type it manually."
            />
          )}

          <Divider sx={{ my: 0.25 }} />
        </Box>

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", pr: 0.5 }}>
          {sidebarGroups.map((group, index) => (
            <Box key={group.id}>
              <Typography
                variant="overline"
                color="text.secondary"
                sx={{ display: "flex", alignItems: "center", gap: 0.75, lineHeight: 1.5, mb: 0.25 }}
              >
                <ResourceIcon name={group.icon} size={14} />
                {group.label}
              </Typography>
              <List dense disablePadding>
                {group.items.map((item) => (
                  <ListItemButton
                    key={item}
                    selected={props.section === item}
                    onClick={() => props.onSelectSection(item)}
                    sx={{ minHeight: 30, py: 0.25, px: 1 }}
                  >
                    <ListItemIcon sx={{ minWidth: 28, color: props.section === item ? "primary.main" : "text.secondary" }}>
                      <ResourceIcon name={getResourceIcon(item)} size={17} />
                    </ListItemIcon>
                    <ListItemText
                      primary={getResourceLabel(item)}
                      primaryTypographyProps={{ variant: "body2" }}
                      sx={{ my: 0 }}
                    />
                  </ListItemButton>
                ))}
              </List>
              {index < sidebarGroups.length - 1 ? <Divider sx={{ my: 0.5 }} /> : null}
            </Box>
          ))}
        </Box>

        <Box sx={{ pt: 0.5 }}>
          <Divider sx={{ mb: 1 }} />
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            kview {currentVersion}
          </Typography>
          {updateRelease ? (
            <Chip
              component="a"
              href={updateRelease.latestUrl}
              target="_blank"
              rel="noreferrer"
              clickable
              size="small"
              color="warning"
              variant="outlined"
              label={`Update ${updateRelease.latestTag}`}
              sx={{ mt: 0.75, maxWidth: "100%" }}
            />
          ) : null}
        </Box>
      </Box>
    </Drawer>
  );
}
