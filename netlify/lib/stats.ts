// Usage counters shown on the model page. One small JSON document, updated with ETag checks.

import { getJSON, update } from "./store.ts";

export interface Stats {
  estimates: number;
  reports: number;
  offers: number;
  days: Record<string, number>;
  countries: Record<string, number>;
}

const empty = (): Stats => ({ estimates: 0, reports: 0, offers: 0, days: {}, countries: {} });

export async function bump(kind: "estimates" | "reports" | "offers", country?: string): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await update<Stats>("stats", (cur) => {
    const s = { ...empty(), ...(cur || {}) };
    s[kind] += 1;
    if (kind === "estimates") {
      s.days[day] = (s.days[day] || 0) + 1;
      if (country) s.countries[country] = (s.countries[country] || 0) + 1;
      // keep 60 days
      for (const d of Object.keys(s.days).sort().slice(0, -60)) delete s.days[d];
    }
    return s;
  }).catch((e) => console.warn("stats", e));
}

export async function readStats(): Promise<Stats> {
  return { ...empty(), ...((await getJSON<Stats>("stats")) || {}) };
}
