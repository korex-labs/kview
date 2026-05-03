import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ThemeProvider as MuiThemeProvider, createTheme } from "@mui/material/styles";
import { CHIP_BORDER_RADIUS } from "./sxTokens";

type ThemeMode = "light" | "dark" | "system";
type ChipTone = "default" | "success" | "warning" | "error" | "info" | "primary" | "secondary";

type ThemeContextValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "kview_theme";

function getInitialMode(): ThemeMode {
  if (typeof window === "undefined") {
    return "system";
  }

  const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }

  return "system";
}

function resolveEffectiveMode(mode: ThemeMode): Exclude<ThemeMode, "system"> {
  if (mode !== "system") return mode;

  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function chipToneVars(tone: ChipTone) {
  return {
    "--mui-chip-bg": `var(--chip-${tone}-bg)`,
    "--mui-chip-fg": `var(--chip-${tone}-fg)`,
    "--mui-chip-border": `var(--chip-${tone}-border)`,
  } as const;
}

function chipVariantStyle(tone: ChipTone, variant: "filled" | "outlined") {
  return {
    props: tone === "default" ? { variant } : { color: tone, variant },
    style: {
      ...chipToneVars(tone),
      color: "var(--mui-chip-fg)",
      borderColor: "var(--mui-chip-border)",
      backgroundColor: variant === "outlined" ? "color-mix(in srgb, var(--mui-chip-bg) 72%, transparent)" : "var(--mui-chip-bg)",
      "& .MuiChip-deleteIcon": {
        color: "color-mix(in srgb, var(--mui-chip-fg) 72%, transparent)",
      },
      "& .MuiChip-deleteIcon:hover": {
        color: "var(--mui-chip-fg)",
      },
      "& .MuiChip-icon": {
        color: "inherit",
        opacity: 0.8,
      },
      "&.Mui-disabled": {
        opacity: 0.55,
      },
    },
  };
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setModeState] = useState<ThemeMode>(() => getInitialMode());

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (mode === "system") {
        const effective = resolveEffectiveMode("system");
        document.documentElement.dataset.theme = effective;
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [mode]);

  useEffect(() => {
    const effective = resolveEffectiveMode(mode);
    document.documentElement.dataset.theme = effective;
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      setMode,
    }),
    [mode, setMode],
  );

  const effectiveMode = resolveEffectiveMode(mode);

  const muiTheme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: effectiveMode,
        },
        components: {
          MuiButton: {
            defaultProps: {
              disableElevation: true,
            },
            styleOverrides: {
              root: {
                borderRadius: 6,
                textTransform: "none",
                fontWeight: 700,
                letterSpacing: 0,
              },
              sizeSmall: {
                minHeight: 30,
              },
            },
          },
          MuiChip: {
            styleOverrides: {
              root: {
                borderRadius: CHIP_BORDER_RADIUS,
                borderWidth: 1,
                borderStyle: "solid",
                fontWeight: 600,
                letterSpacing: 0,
                transition: "background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease",
              },
              sizeSmall: {
                height: 24,
                fontSize: "0.75rem",
              },
              labelSmall: {
                paddingLeft: 8,
                paddingRight: 8,
              },
              clickable: {
                "&:hover": {
                  boxShadow: "0 0 0 1px color-mix(in srgb, var(--mui-chip-border) 55%, transparent) inset",
                },
              },
            },
            variants: [
              chipVariantStyle("default", "filled"),
              chipVariantStyle("success", "filled"),
              chipVariantStyle("warning", "filled"),
              chipVariantStyle("error", "filled"),
              chipVariantStyle("info", "filled"),
              chipVariantStyle("primary", "filled"),
              chipVariantStyle("secondary", "filled"),
              chipVariantStyle("default", "outlined"),
              chipVariantStyle("success", "outlined"),
              chipVariantStyle("warning", "outlined"),
              chipVariantStyle("error", "outlined"),
              chipVariantStyle("info", "outlined"),
              chipVariantStyle("primary", "outlined"),
              chipVariantStyle("secondary", "outlined"),
            ],
          },
        },
        zIndex: {
          modal: 1700,
          snackbar: 1750,
        },
      }),
    [effectiveMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      <MuiThemeProvider theme={muiTheme}>{children}</MuiThemeProvider>
    </ThemeContext.Provider>
  );
};

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useThemeMode must be used within ThemeProvider");
  }
  return ctx;
}
