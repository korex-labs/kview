import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  defaultUserSettings,
  loadUserSettings,
  saveUserSettings,
  type KviewUserSettingsV2,
} from "./settings";

type SettingsContextValue = {
  settings: KviewUserSettingsV2;
  setSettings: React.Dispatch<React.SetStateAction<KviewUserSettingsV2>>;
  replaceSettings: (settings: KviewUserSettingsV2) => void;
  resetSettings: () => void;
};

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export function UserSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<KviewUserSettingsV2>(() => loadUserSettings());

  useEffect(() => {
    saveUserSettings(settings);
  }, [settings]);

  const replaceSettings = useCallback((next: KviewUserSettingsV2) => {
    setSettings(next);
  }, []);

  const resetSettings = useCallback(() => {
    setSettings(defaultUserSettings());
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, setSettings, replaceSettings, resetSettings }),
    [replaceSettings, resetSettings, settings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useUserSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    throw new Error("useUserSettings must be used within UserSettingsProvider");
  }
  return ctx;
}
