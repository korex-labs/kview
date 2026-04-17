export function fmtAgeShort(ageSec?: number): string {
  if (ageSec == null || !Number.isFinite(ageSec) || ageSec <= 0) return "";
  if (ageSec < 3600) return `${Math.max(1, Math.round(ageSec / 60))}m`;
  if (ageSec < 86400) return `${(ageSec / 3600).toFixed(1)}h`;
  return `${(ageSec / 86400).toFixed(1)}d`;
}

export function fmtBytes(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let next = value;
  let idx = 0;
  while (next >= 1024 && idx < units.length - 1) {
    next /= 1024;
    idx++;
  }
  return `${next >= 100 || idx === 0 ? Math.round(next) : next.toFixed(1)} ${units[idx]}`;
}

export function fmtRate(value?: number, suffix = "/min"): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return `0${suffix}`;
  if (value >= 100) return `${Math.round(value)}${suffix}`;
  if (value >= 10) return `${value.toFixed(1)}${suffix}`;
  return `${value.toFixed(2)}${suffix}`;
}

export function fmtByteRate(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0 B/min";
  return `${fmtBytes(value)}/min`;
}

export function fmtPercent(value?: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "0%";
  if (value >= 100) return "100%";
  return `${value.toFixed(1)}%`;
}

export function fmtTs(unix?: number | null): string {
  if (!unix) return "-";
  const d = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

export function valueOrDash(val?: string | number | null): string {
  if (val === undefined || val === null || val === "") return "-";
  return String(val);
}

export function fmtAge(seconds?: number, style: "detail" | "table" = "detail"): string {
  if (style === "table") {
    if (seconds == null || Number.isNaN(seconds) || seconds < 0) return "-";
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  if (!seconds || seconds < 0) return "-";
  const mins = Math.floor(seconds / 60);
  if (mins < 1) return `${seconds}s`;
  const hours = Math.floor(mins / 60);
  if (hours < 1) return `${mins}m`;
  const days = Math.floor(hours / 24);
  if (days < 1) return `${hours}h`;
  return `${days}d`;
}
