export type DashboardSignalViewSnapshot = {
  signalFilter: string;
  signalFilters: string[];
  signalsQuery: string;
  signalsSort: string;
  signalsRowsPerPage: number;
};

export type DashboardSignalViewProfile = {
  id: string;
  name: string;
  snapshot: DashboardSignalViewSnapshot;
  createdAt: number;
  updatedAt: number;
};

export type DashboardSignalViewProfilesState = {
  activeProfileId: string;
  definitions: DashboardSignalViewProfile[];
};

export type DashboardSignalViewInitialState = {
  profiles: DashboardSignalViewProfilesState;
  snapshot: DashboardSignalViewSnapshot;
};

export const DASHBOARD_SIGNAL_VIEW_PROFILES_KEY = "kview:dashboardSignalViewProfiles:v1";

const defaultDashboardSignalViewProfilesState = (): DashboardSignalViewProfilesState => ({
  activeProfileId: "",
  definitions: [],
});

function cleanName(input: string): string {
  return input.trim().replace(/\s+/g, " ").slice(0, 64);
}

function cleanFilter(input: unknown, fallback = "top"): string {
  if (typeof input !== "string") return fallback;
  const value = input.trim();
  return value || fallback;
}

function cleanFilters(input: unknown, fallback: string): string[] {
  if (!Array.isArray(input)) return [fallback];
  const filters = Array.from(new Set(input.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
  return filters.length > 0 ? filters.slice(0, 12) : [fallback];
}

function cleanRowsPerPage(input: unknown): number {
  if (typeof input !== "number" || !Number.isFinite(input)) return 10;
  const rounded = Math.round(input);
  return [10, 25, 50, 100].includes(rounded) ? rounded : 10;
}

function normalizeSnapshot(input: unknown): DashboardSignalViewSnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Partial<DashboardSignalViewSnapshot>;
  const signalFilter = cleanFilter(raw.signalFilter);
  return {
    signalFilter,
    signalFilters: cleanFilters(raw.signalFilters, signalFilter),
    signalsQuery: typeof raw.signalsQuery === "string" ? raw.signalsQuery.trim().slice(0, 256) : "",
    signalsSort: cleanFilter(raw.signalsSort, "priority"),
    signalsRowsPerPage: cleanRowsPerPage(raw.signalsRowsPerPage),
  };
}

function normalizeProfile(input: unknown, fallbackId: string): DashboardSignalViewProfile | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Partial<DashboardSignalViewProfile>;
  const name = typeof raw.name === "string" ? cleanName(raw.name) : "";
  const snapshot = normalizeSnapshot(raw.snapshot);
  if (!name || !snapshot) return null;
  const createdAt = typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt) && raw.createdAt > 0
    ? Math.floor(raw.createdAt)
    : Date.now();
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0
    ? Math.floor(raw.updatedAt)
    : createdAt;
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 96) : fallbackId,
    name,
    snapshot,
    createdAt,
    updatedAt,
  };
}

export function normalizeDashboardSignalViewProfiles(input: unknown): DashboardSignalViewProfilesState {
  if (!input || typeof input !== "object" || Array.isArray(input)) return defaultDashboardSignalViewProfilesState();
  const raw = input as Partial<DashboardSignalViewProfilesState>;
  const seen = new Set<string>();
  const definitions: DashboardSignalViewProfile[] = [];
  (Array.isArray(raw.definitions) ? raw.definitions : []).forEach((profile, index) => {
    const normalized = normalizeProfile(profile, `dashboard-view-${index + 1}`);
    if (!normalized || seen.has(normalized.id)) return;
    seen.add(normalized.id);
    definitions.push(normalized);
  });
  return {
    activeProfileId: typeof raw.activeProfileId === "string" && seen.has(raw.activeProfileId) ? raw.activeProfileId : "",
    definitions: definitions.slice(0, 25),
  };
}

export function loadDashboardSignalViewProfiles(): DashboardSignalViewProfilesState {
  try {
    const raw = window.localStorage.getItem(DASHBOARD_SIGNAL_VIEW_PROFILES_KEY);
    if (!raw) return defaultDashboardSignalViewProfilesState();
    return normalizeDashboardSignalViewProfiles(JSON.parse(raw));
  } catch {
    return defaultDashboardSignalViewProfilesState();
  }
}

export function saveDashboardSignalViewProfiles(state: DashboardSignalViewProfilesState) {
  window.localStorage.setItem(DASHBOARD_SIGNAL_VIEW_PROFILES_KEY, JSON.stringify(normalizeDashboardSignalViewProfiles(state)));
}

export function dashboardSignalViewSnapshot(input: DashboardSignalViewSnapshot): DashboardSignalViewSnapshot {
  return normalizeSnapshot(input) || {
    signalFilter: "top",
    signalFilters: ["top"],
    signalsQuery: "",
    signalsSort: "priority",
    signalsRowsPerPage: 10,
  };
}

export function loadDashboardSignalViewInitialState(): DashboardSignalViewInitialState {
  const profiles = loadDashboardSignalViewProfiles();
  const activeProfile = profiles.definitions.find((profile) => profile.id === profiles.activeProfileId);
  return {
    profiles,
    snapshot: activeProfile ? activeProfile.snapshot : dashboardSignalViewSnapshot({
      signalFilter: "top",
      signalFilters: ["top"],
      signalsQuery: "",
      signalsSort: "priority",
      signalsRowsPerPage: 10,
    }),
  };
}

export function addDashboardSignalViewProfile(
  state: DashboardSignalViewProfilesState,
  nameInput: string,
  snapshotInput: DashboardSignalViewSnapshot,
  now = Date.now(),
): DashboardSignalViewProfilesState {
  const name = cleanName(nameInput);
  if (!name) return state;
  const id = `dashboard-view-${Math.floor(now)}-${Math.random().toString(36).slice(2, 8)}`;
  const profile: DashboardSignalViewProfile = {
    id,
    name,
    snapshot: dashboardSignalViewSnapshot(snapshotInput),
    createdAt: Math.floor(now),
    updatedAt: Math.floor(now),
  };
  return {
    activeProfileId: id,
    definitions: [...state.definitions, profile].slice(-25),
  };
}

export function updateDashboardSignalViewProfile(
  state: DashboardSignalViewProfilesState,
  profileId: string,
  snapshotInput: DashboardSignalViewSnapshot,
  now = Date.now(),
  nameInput?: string,
): DashboardSignalViewProfilesState {
  if (!state.definitions.some((profile) => profile.id === profileId)) return state;
  const name = typeof nameInput === "string" ? cleanName(nameInput) : "";
  return {
    activeProfileId: profileId,
    definitions: state.definitions.map((profile) =>
      profile.id === profileId
        ? {
            ...profile,
            name: name || profile.name,
            snapshot: dashboardSignalViewSnapshot(snapshotInput),
            updatedAt: Math.floor(now),
          }
        : profile,
    ),
  };
}

export function removeDashboardSignalViewProfile(
  state: DashboardSignalViewProfilesState,
  profileId: string,
): DashboardSignalViewProfilesState {
  return {
    activeProfileId: state.activeProfileId === profileId ? "" : state.activeProfileId,
    definitions: state.definitions.filter((profile) => profile.id !== profileId),
  };
}
