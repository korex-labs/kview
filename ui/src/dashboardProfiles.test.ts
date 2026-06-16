// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addDashboardSignalViewProfile,
  dashboardSignalViewSnapshot,
  DASHBOARD_SIGNAL_VIEW_PROFILES_KEY,
  loadDashboardSignalViewInitialState,
  loadDashboardSignalViewProfiles,
  normalizeDashboardSignalViewProfiles,
  removeDashboardSignalViewProfile,
  saveDashboardSignalViewProfiles,
  updateDashboardSignalViewProfile,
  type DashboardSignalViewProfilesState,
} from "./dashboardProfiles";

const snapshot = {
  signalFilter: "severity:high",
  signalFilters: ["severity:high", "namespace:prod"],
  signalsQuery: "api",
  signalsSort: "last_seen_desc",
  signalsRowsPerPage: 25,
};

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("dashboard signal view profiles", () => {
  it("normalizes snapshots", () => {
    expect(dashboardSignalViewSnapshot({
      signalFilter: "",
      signalFilters: ["", "tag:prod", "tag:prod"],
      signalsQuery: " x ".repeat(200),
      signalsSort: "",
      signalsRowsPerPage: 999,
    })).toMatchObject({
      signalFilter: "top",
      signalFilters: ["tag:prod"],
      signalsSort: "priority",
      signalsRowsPerPage: 10,
    });
  });

  it("adds, updates, and removes profiles", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.123456);
    const added = addDashboardSignalViewProfile({ activeProfileId: "", definitions: [] }, " Prod incidents ", snapshot, 100);
    const profile = added.definitions[0];

    expect(profile).toMatchObject({
      id: "dashboard-view-100-4fzyo8",
      name: "Prod incidents",
      snapshot,
      createdAt: 100,
      updatedAt: 100,
    });
    expect(added.activeProfileId).toBe(profile.id);

    const updated = updateDashboardSignalViewProfile(added, profile.id, {
      ...snapshot,
      signalFilter: "newest",
      signalFilters: ["newest"],
    }, 200, " Latest incidents ");
    expect(updated.activeProfileId).toBe(profile.id);
    expect(updated.definitions[0].name).toBe("Latest incidents");
    expect(updated.definitions[0].updatedAt).toBe(200);
    expect(updated.definitions[0].snapshot.signalFilters).toEqual(["newest"]);

    expect(removeDashboardSignalViewProfile(updated, profile.id)).toEqual({ activeProfileId: "", definitions: [] });
  });

  it("loads and saves local profiles defensively", () => {
    const state: DashboardSignalViewProfilesState = {
      activeProfileId: "prod",
      definitions: [
        {
          id: "prod",
          name: "Prod",
          snapshot,
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    };

    saveDashboardSignalViewProfiles(state);

    expect(JSON.parse(window.localStorage.getItem(DASHBOARD_SIGNAL_VIEW_PROFILES_KEY) || "{}")).toMatchObject(state);
    expect(loadDashboardSignalViewProfiles()).toEqual(state);
  });

  it("uses the active profile snapshot as the initial dashboard signal view", () => {
    const state: DashboardSignalViewProfilesState = {
      activeProfileId: "prod",
      definitions: [
        {
          id: "prod",
          name: "Prod",
          snapshot,
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    };
    saveDashboardSignalViewProfiles(state);

    expect(loadDashboardSignalViewInitialState()).toEqual({
      profiles: state,
      snapshot,
    });
  });

  it("drops invalid imports and inactive ids", () => {
    expect(normalizeDashboardSignalViewProfiles({
      activeProfileId: "missing",
      definitions: [
        {
          id: "ok",
          name: " Ok ",
          snapshot: {
            signalFilter: "tag:prod",
            signalFilters: ["tag:prod", "severity:high"],
            signalsQuery: "payments",
            signalsSort: "severity",
            signalsRowsPerPage: 50,
          },
          createdAt: 10,
          updatedAt: 20,
        },
        {
          id: "bad",
          name: "",
          snapshot: {},
        },
      ],
    })).toEqual({
      activeProfileId: "",
      definitions: [
        {
          id: "ok",
          name: "Ok",
          snapshot: {
            signalFilter: "tag:prod",
            signalFilters: ["tag:prod", "severity:high"],
            signalsQuery: "payments",
            signalsSort: "severity",
            signalsRowsPerPage: 50,
          },
          createdAt: 10,
          updatedAt: 20,
        },
      ],
    });
  });
});
