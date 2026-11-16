import type { ThemesResult } from "./complaint-themes";

/** One request per page open for a period, or per Refresh press. Never on a timer, focus or visibility. */
export async function loadComplaintThemes(period: { from?: string; to?: string }, refresh = false): Promise<ThemesResult> {
  const response = await fetch("/api/feedback/complaint-themes", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/json", "x-creoms-complaint-themes": "1" },
    body: JSON.stringify({ from: period.from, to: period.to, ...(refresh ? { refresh: true } : {}) }),
  });
  if (!response.ok) return { themes: null, unavailable: true, ...(response.status === 403 ? { refused: "read-only" as const } : {}) };
  return response.json();
}
