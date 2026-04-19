export type LatestRelease = {
  latestTag: string;
  latestUrl: string;
  checkedAt: number;
};

type GitHubReleaseResponse = {
  tag_name?: unknown;
  html_url?: unknown;
};

type ParsedVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
};

const LATEST_RELEASE_URL = "https://api.github.com/repos/korex-labs/kview/releases/latest";
const CACHE_KEY = "kview:latestRelease:v1";

export const RELEASE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseSemverTag(value?: string): ParsedVersion | null {
  const raw = String(value || "").trim();
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(raw);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || "",
  };
}

function compareParsedVersions(a: ParsedVersion, b: ParsedVersion): number {
  const parts: Array<keyof ParsedVersion> = ["major", "minor", "patch"];
  for (const part of parts) {
    if (part === "prerelease") continue;
    if (a[part] > b[part]) return 1;
    if (a[part] < b[part]) return -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

export function isComparableReleaseVersion(version?: string): boolean {
  return parseSemverTag(version) !== null;
}

export function isUpdateAvailable(currentVersion?: string, latestTag?: string): boolean {
  const current = parseSemverTag(currentVersion);
  const latest = parseSemverTag(latestTag);
  if (!current || !latest) return false;
  return compareParsedVersions(latest, current) > 0;
}

function readCachedLatestRelease(now: number): LatestRelease | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const cached = JSON.parse(storage.getItem(CACHE_KEY) || "null") as Partial<LatestRelease> | null;
    if (!cached || typeof cached.checkedAt !== "number") return null;
    if (now - cached.checkedAt > RELEASE_CHECK_INTERVAL_MS) return null;
    if (typeof cached.latestTag !== "string" || typeof cached.latestUrl !== "string") return null;
    return {
      latestTag: cached.latestTag,
      latestUrl: cached.latestUrl,
      checkedAt: cached.checkedAt,
    };
  } catch {
    return null;
  }
}

function writeCachedLatestRelease(release: LatestRelease) {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(release));
  } catch {
    // Storage may be unavailable in private windows or locked-down webviews.
  }
}

async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestRelease | null> {
  if (typeof fetch === "undefined") return null;
  const res = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json" },
    signal,
  });
  if (!res.ok) return null;

  const body = (await res.json()) as GitHubReleaseResponse;
  if (typeof body.tag_name !== "string" || typeof body.html_url !== "string") return null;
  return {
    latestTag: body.tag_name,
    latestUrl: body.html_url,
    checkedAt: Date.now(),
  };
}

export async function getLatestReleaseWithCache(signal?: AbortSignal): Promise<LatestRelease | null> {
  const cached = readCachedLatestRelease(Date.now());
  if (cached) return cached;

  const release = await fetchLatestRelease(signal);
  if (release) writeCachedLatestRelease(release);
  return release;
}
