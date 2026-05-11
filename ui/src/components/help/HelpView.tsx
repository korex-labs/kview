import React, { useEffect, useMemo, useState } from "react";
import {
  Box,
  Divider,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import GitHubIcon from "@mui/icons-material/GitHub";
import LanguageIcon from "@mui/icons-material/Language";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import ArticleOutlinedIcon from "@mui/icons-material/ArticleOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { AppIconButton } from "../shared/AppActions";
import { sideRailIconSx, sideRailListItemSx, sideRailListTextSx, sideRailPaperSx } from "../shared/sideRail";
import MarkdownContent from "./MarkdownContent";
import { featuredHelpPages, helpManifest, helpPages, helpPagesByCategory, type HelpPage } from "../../help/content";

const changelogUrl = "https://github.com/korex-labs/kview/blob/main/CHANGELOG.md";
type ProjectLink = { id: string; label: string; href: string; icon: React.ReactElement };

function pageMatches(page: HelpPage, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return `${page.title} ${page.category} ${page.body}`.toLowerCase().includes(q);
}

function bodyWithoutMatchingTitle(page: HelpPage): string {
  const lines = page.body.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim().toLowerCase() === `# ${page.title.toLowerCase()}`) {
    return lines.slice(1).join("\n").trimStart();
  }
  return page.body;
}

const helpShellSx = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  overflow: "hidden",
  backgroundColor: "var(--bg-primary)",
};

const helpMainSurfaceSx = {
  flex: 1,
  minWidth: 0,
  overflow: "auto",
  p: 1.25,
  backgroundColor: "background.paper",
  backgroundImage: (theme: Theme) =>
    theme.palette.mode === "dark" ? "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))" : "none",
  "& .MuiPaper-root": {
    backgroundColor: "background.paper",
    backgroundImage: (theme: Theme) =>
      theme.palette.mode === "dark" ? "linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))" : "none",
  },
};

export default function HelpView({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activePageId, setActivePageId] = useState(featuredHelpPages[0]?.id || helpPages[0]?.id || "");
  const filteredPages = useMemo(
    () => helpPages.filter((page) => pageMatches(page, query.trim())),
    [query],
  );
  const groups = useMemo(() => helpPagesByCategory(filteredPages), [filteredPages]);
  const activePage = helpPages.find((page) => page.id === activePageId) || filteredPages[0] || helpPages[0];
  const links = helpManifest.externalLinks;
  const projectLinks: ProjectLink[] = [
    links.github ? { id: "github", label: "GitHub", href: links.github, icon: <GitHubIcon fontSize="small" /> } : null,
    links.website ? { id: "website", label: "Website", href: links.website, icon: <LanguageIcon fontSize="small" /> } : null,
    links.patreon ? { id: "patreon", label: "Patreon", href: links.patreon, icon: <FavoriteBorderIcon fontSize="small" /> } : null,
  ].filter((item): item is ProjectLink => Boolean(item));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <Box data-testid="help-view" sx={helpShellSx}>
      <Paper
        variant="outlined"
        sx={sideRailPaperSx}
      >
        <Typography variant="overline" color="text.secondary" sx={{ display: "block", mb: 0.25 }}>
          Help
        </Typography>

        <TextField
          size="small"
          label="Search help"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ my: 1 }}
        />

        <Divider sx={{ mb: 1 }} />

        <Box>
          {groups.map((group) => (
            <Box key={group.category} sx={{ mb: 1 }}>
              <Typography variant="overline" color="text.secondary">
                {group.category}
              </Typography>
              <List dense disablePadding>
                {group.pages.map((page) => (
                  <ListItemButton
                    key={page.id}
                    selected={activePage?.id === page.id}
                    onClick={() => setActivePageId(page.id)}
                    sx={sideRailListItemSx}
                  >
                    <ListItemIcon sx={sideRailIconSx(activePage?.id === page.id)}>
                      <ArticleOutlinedIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={page.title}
                      slotProps={{ primary: { variant: "body2" } }}
                      sx={sideRailListTextSx}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>
          ))}
        </Box>

        {projectLinks.length ? (
          <>
            <Divider sx={{ my: 1 }} />
            <Typography variant="overline" color="text.secondary">
              Project
            </Typography>
            <List dense disablePadding>
              {projectLinks.map((item) => (
                <ListItemButton
                  key={item.id}
                  component="a"
                  href={item.href}
                  target="_blank"
                  rel="noreferrer"
                  sx={sideRailListItemSx}
                >
                  <ListItemIcon sx={sideRailIconSx(false)}>
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    slotProps={{ primary: { variant: "body2" } }}
                    sx={sideRailListTextSx}
                  />
                </ListItemButton>
              ))}
            </List>
          </>
        ) : null}
      </Paper>

      <Box sx={helpMainSurfaceSx}>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1.25 }}>
          <AppIconButton tooltip="Close help" label="Close help" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </AppIconButton>
        </Box>
        <Paper
          variant="outlined"
          sx={{
            maxWidth: 900,
            p: 1.5,
          }}
        >
          {activePage ? (
            <>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, minHeight: 36 }}>
                <Box sx={{ display: "flex", color: "primary.main", mr: 0.25 }}>
                  <ArticleOutlinedIcon fontSize="small" />
                </Box>
                <Typography variant="subtitle2" component="h1" sx={{ fontWeight: 600 }}>
                  {activePage.title}
                </Typography>
                {activePage.id === "whats-new" ? (
                  <Link href={changelogUrl} target="_blank" rel="noreferrer" variant="body2" sx={{ ml: "auto" }}>
                  Full changelog
                  </Link>
                ) : null}
              </Box>
              <Divider sx={{ mb: 1 }} />
              <MarkdownContent markdown={bodyWithoutMatchingTitle(activePage)} />
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No help pages matched the current search.
            </Typography>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
