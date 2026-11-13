export type LogPreferences = {
  lines: number;
  wrap: boolean;
  pretty: boolean;
};

export const logLineOptions = [100, 500, 1000, 5000] as const;

export function normalizeLogPreferences(input?: unknown): LogPreferences {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<LogPreferences> : {};
  return {
    lines: typeof raw.lines === "number" && logLineOptions.some((lines) => lines === raw.lines) ? raw.lines : 100,
    wrap: typeof raw.wrap === "boolean" ? raw.wrap : true,
    pretty: typeof raw.pretty === "boolean" ? raw.pretty : true,
  };
}
