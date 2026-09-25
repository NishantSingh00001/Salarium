// Turning a developer profile into an estimate: the 80% range, what drives it (SHAP),
// how it grows with experience, and which skills are associated with more pay.
// Pure functions, shared by the API and the tests.

import { compile, predict, shap, type Ensemble, type FeatureSpec, type ModelFile } from "./model.ts";

export interface Profile {
  country: string;
  yearsPro: number;
  yearsCode?: number;
  role: string;
  education: string;
  orgSize: string;
  manager: string;
  remote: string;
  industry: string;
  employment: string;
  skills: string[]; // feature keys, e.g. "lang_python"
}

export const CAT_FIELDS = {
  country: "country",
  role: "role",
  education: "education",
  orgSize: "org_size",
  manager: "manager",
  remote: "remote",
  industry: "industry",
  employment: "employment",
} as const satisfies Record<string, string>;

export interface Driver {
  key: string;
  label: string;
  value: string; // what the profile says, e.g. "India" or "3 years"
  phi: number; // SHAP value on the log scale
  pct: number; // multiplicative effect: exp(phi) - 1
  kind: "cat" | "num" | "skill" | "skills-absent";
}

export interface Estimate {
  usd: { p10: number; p50: number; p90: number };
  log: { lo: number; point: number; hi: number };
  baselineUsd: number;
  drivers: Driver[];
  curve: { years: number; p10: number; p50: number; p90: number }[];
  uplifts: { key: string; label: string; group: string; pct: number }[];
  roles: { role: string; pct: number }[];
  model: { version: number; trained: string };
}

export interface Runtime {
  file: ModelFile;
  features: FeatureSpec[];
  index: Map<string, number>;
  point: Ensemble;
  lo: Ensemble;
  hi: Ensemble;
}

export function load(file: ModelFile): Runtime {
  return {
    file,
    features: file.features,
    index: new Map(file.features.map((f, i) => [f.key, i])),
    point: compile(file.point),
    lo: compile(file.lo),
    hi: compile(file.hi),
  };
}

export function vocab(rt: Runtime, key: string): string[] {
  return rt.features[rt.index.get(key)!]?.values || [];
}

export function skillFeatures(rt: Runtime): FeatureSpec[] {
  return rt.features.filter((f) => f.kind === "bin");
}

/** Checks a profile against the model's vocabulary. Returns a list of problems (empty = fine). */
export function validate(rt: Runtime, p: Profile): string[] {
  const errors: string[] = [];
  for (const [field, key] of Object.entries(CAT_FIELDS)) {
    const v = p[field as keyof typeof CAT_FIELDS];
    if (!vocab(rt, key).includes(v)) errors.push(`Unknown ${field}: ${v}`);
  }
  if (!(p.yearsPro >= 0 && p.yearsPro <= 50)) errors.push("yearsPro must be between 0 and 50");
  if (p.yearsCode != null && !(p.yearsCode >= 0 && p.yearsCode <= 60)) errors.push("yearsCode must be between 0 and 60");
  const skills = new Set(skillFeatures(rt).map((f) => f.key));
  for (const s of p.skills) if (!skills.has(s)) errors.push(`Unknown skill: ${s}`);
  return errors;
}

export function encode(rt: Runtime, p: Profile): Float64Array {
  const x = new Float64Array(rt.features.length);
  for (const [field, key] of Object.entries(CAT_FIELDS)) {
    const values = vocab(rt, key);
    x[rt.index.get(key)!] = Math.max(0, values.indexOf(p[field as keyof typeof CAT_FIELDS]));
  }
  const yp = Math.min(40, Math.max(0, Math.round(p.yearsPro)));
  const yc = Math.min(50, Math.max(yp, Math.round(p.yearsCode ?? yp + 4)));
  x[rt.index.get("years_pro")!] = yp;
  x[rt.index.get("years_code")!] = yc;
  for (const s of p.skills) {
    const i = rt.index.get(s);
    if (i != null) x[i] = 1;
  }
  return x;
}

function range(rt: Runtime, x: ArrayLike<number>) {
  const point = predict(rt.point, x);
  const lo = Math.min(point, predict(rt.lo, x) - rt.file.conformal);
  const hi = Math.max(point, predict(rt.hi, x) + rt.file.conformal);
  return { lo, point, hi };
}

const pct = (logDelta: number) => Math.exp(logDelta) - 1;
const round = (v: number, to = 100) => Math.round(v / to) * to;

export function estimate(rt: Runtime, p: Profile): Estimate {
  const x = encode(rt, p);
  const r = range(rt, x);

  // SHAP drivers. Categorical and numeric features are shown one by one; the skills the person
  // picked are shown individually and the effect of all the skills they didn't pick is grouped.
  const { phi, expected } = shap(rt.point, x, rt.features.length);
  const drivers: Driver[] = [];
  let absent = 0;
  rt.features.forEach((f, i) => {
    if (f.kind === "cat") {
      const field = Object.entries(CAT_FIELDS).find(([, k]) => k === f.key)![0] as keyof typeof CAT_FIELDS;
      drivers.push({ key: f.key, label: f.label, value: p[field], phi: phi[i], pct: pct(phi[i]), kind: "cat" });
    } else if (f.kind === "num") {
      const v = x[i];
      drivers.push({ key: f.key, label: f.label, value: `${v} year${v === 1 ? "" : "s"}`, phi: phi[i], pct: pct(phi[i]), kind: "num" });
    } else if (x[i] === 1) {
      drivers.push({ key: f.key, label: f.label, value: "uses it", phi: phi[i], pct: pct(phi[i]), kind: "skill" });
    } else {
      absent += phi[i];
    }
  });
  drivers.push({ key: "skills_absent", label: "Skills you didn't pick", value: `${skillFeatures(rt).length - p.skills.length} others`, phi: absent, pct: pct(absent), kind: "skills-absent" });
  drivers.sort((a, b) => Math.abs(b.phi) - Math.abs(a.phi));

  // Experience curve: same profile, 0–30 years (keeping the gap between coding and working years).
  const ip = rt.index.get("years_pro")!;
  const ic = rt.index.get("years_code")!;
  const gap = x[ic] - x[ip];
  const curve = [];
  for (let y = 0; y <= 30; y++) {
    const xc = Float64Array.from(x);
    xc[ip] = y;
    xc[ic] = Math.min(50, y + gap);
    const rc = range(rt, xc);
    curve.push({ years: y, p10: round(Math.exp(rc.lo)), p50: round(Math.exp(rc.point)), p90: round(Math.exp(rc.hi)) });
  }

  // What-if: adding one skill the person doesn't have. These are associations in the data.
  const uplifts = skillFeatures(rt)
    .filter((f) => x[rt.index.get(f.key)!] === 0)
    .map((f) => {
      const xs = Float64Array.from(x);
      xs[rt.index.get(f.key)!] = 1;
      return { key: f.key, label: f.label, group: f.group || "", pct: pct(predict(rt.point, xs) - r.point) };
    })
    .filter((u) => u.pct > 0.005)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 8)
    .map((u) => ({ ...u, pct: Math.round(u.pct * 1000) / 1000 }));

  // Same profile in other roles.
  const ir = rt.index.get("role")!;
  const roles = vocab(rt, "role")
    .map((role, code) => {
      const xr = Float64Array.from(x);
      xr[ir] = code;
      return { role, pct: Math.round(pct(predict(rt.point, xr) - r.point) * 1000) / 1000 };
    })
    .filter((d) => d.role !== p.role && d.role !== "Other role")
    .sort((a, b) => b.pct - a.pct);

  return {
    usd: { p10: round(Math.exp(r.lo)), p50: round(Math.exp(r.point)), p90: round(Math.exp(r.hi)) },
    log: r,
    baselineUsd: round(Math.exp(expected)),
    drivers: drivers.map((d) => ({ ...d, phi: Math.round(d.phi * 10000) / 10000, pct: Math.round(d.pct * 1000) / 1000 })),
    curve,
    uplifts,
    roles,
    model: { version: rt.file.version, trained: rt.file.trained },
  };
}

/** Where an actual salary falls against an estimate. */
export function compare(e: Pick<Estimate, "usd">, actualUsd: number) {
  const { p10, p50, p90 } = e.usd;
  const position = actualUsd < p10 ? "below" : actualUsd > p90 ? "above" : "within";
  return { position, errorPct: Math.round((actualUsd / p50 - 1) * 1000) / 1000 } as const;
}
