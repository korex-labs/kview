import React, { useMemo, useState } from "react";
import {
  Box,
  Drawer,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Typography,
  TextField,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  Autocomplete,
  IconButton,
} from "@mui/material";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import type { Section } from "../state";
import { getResourceLabel, isClusterScopedSection, sidebarGroups } from "../utils/k8sResources";

type Props = {
  contexts: any[];
  activeContext: string;
  onSelectContext: (name: string) => void;

  namespaces: string[];
  namespace: string;
  onSelectNamespace: (ns: string) => void;
  nsLimited: boolean;

  favourites: string[];
  onToggleFavourite: (ns: string) => void;

  section: Section;
  onSelectSection: (s: Section) => void;
};

const drawerWidth = 320;

export default function Sidebar(props: Props) {
  const [nsInput, setNsInput] = useState("");
  const isClusterScoped = isClusterScopedSection(props.section);

  const favSet = useMemo(() => new Set(props.favourites), [props.favourites]);

  const sortedNamespaces = useMemo(() => {
    const fav = props.namespaces.filter((n) => favSet.has(n)).sort((a, b) => a.localeCompare(b));
    const rest = props.namespaces.filter((n) => !favSet.has(n)).sort((a, b) => a.localeCompare(b));
    return [...fav, ...rest];
  }, [props.namespaces, favSet]);

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: "border-box", pt: 10, px: 2 },
      }}
    >
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
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
            helperText="No permission to list namespaces (RBAC). Type it manually."
          />
        )}

        <Divider />

        {sidebarGroups.map((group, index) => (
          <Box key={group.id}>
            <Typography variant="overline" color="text.secondary">
              {group.label}
            </Typography>
            <List dense disablePadding>
              {group.items.map((item) => (
                <ListItemButton
                  key={item}
                  selected={props.section === item}
                  onClick={() => props.onSelectSection(item)}
                >
                  <ListItemText primary={getResourceLabel(item)} />
                </ListItemButton>
              ))}
            </List>
            {index < sidebarGroups.length - 1 ? <Divider sx={{ my: 1 }} /> : null}
          </Box>
        ))}
      </Box>
    </Drawer>
  );
}

