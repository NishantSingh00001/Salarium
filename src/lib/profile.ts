// The profile being estimated: one small store, kept in localStorage so it survives reloads
// and carries over to the offer check.

import { useSyncExternalStore } from "react";
import type { Profile } from "../../shared/predict";

export type { Profile };

const KEY = "salarium.profile.v1";

export const DEFAULT_PROFILE: Profile = {
  country: "India",
  yearsPro: 2,
  yearsCode: 6,
  role: "Full-stack developer",
  education: "Bachelor's degree",
  orgSize: "100–499",
  manager: "Individual contributor",
  remote: "Hybrid, mostly office",
  industry: "Software",
  employment: "Employee",
  skills: ["lang_javascript", "lang_typescript", "lang_python", "lang_sql", "web_react", "web_nodejs", "db_postgresql", "plat_docker"],
};

function read(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PROFILE, ...JSON.parse(raw) };
  } catch { /* storage blocked */ }
  return DEFAULT_PROFILE;
}

let state: Profile = read();
const listeners = new Set<() => void>();

export function getProfile(): Profile {
  return state;
}

export function setProfile(patch: Partial<Profile> | ((p: Profile) => Partial<Profile>)) {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

/** Drops anything a saved profile has that the current model doesn't know (e.g. after a retrain). */
export function sanitize(features: { features: { key: string; kind: string; values?: string[] }[] }) {
  const values = (k: string) => features.features.find((f) => f.key === k)?.values || [];
  const skills = new Set(features.features.filter((f) => f.kind === "bin").map((f) => f.key));
  const fields: [keyof Profile, string][] = [["country", "country"], ["role", "role"], ["education", "education"], ["orgSize", "org_size"], ["manager", "manager"], ["remote", "remote"], ["industry", "industry"], ["employment", "employment"]];
  const patch: Partial<Profile> = {};
  for (const [field, key] of fields) {
    const v = values(key);
    if (v.length && !v.includes(state[field] as string)) (patch as Record<string, unknown>)[field] = v.includes(DEFAULT_PROFILE[field] as string) ? DEFAULT_PROFILE[field] : v[0];
  }
  const kept = state.skills.filter((s) => skills.has(s));
  if (kept.length !== state.skills.length) patch.skills = kept;
  if (Object.keys(patch).length) setProfile(patch);
}

export function resetProfile() {
  setProfile(DEFAULT_PROFILE);
}

export function useProfile(): Profile {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}
