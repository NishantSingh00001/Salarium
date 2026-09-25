// "How close were we?" Visitors can tell us what they actually earn, anonymously.
//   POST /api/reality { profile, actualUsd }  → where it fell against the estimate
//   GET  /api/reality                         → running real-world accuracy
// Nothing identifying is stored: no IP, no name, pay rounded to the nearest $500.

import type { Config } from "@netlify/functions";
import { z } from "zod";
import { compare, estimate } from "../../shared/predict.ts";
import { body, clientKey, handle, json, methodNotAllowed } from "../lib/http.ts";
import { ProfileSchema } from "../lib/schema.ts";
import { checkProfile, rt } from "../lib/runtime.ts";
import { getJSON, rateLimit, update } from "../lib/store.ts";

export interface RealityPoint { country: string; years: number; role: string; p10: number; p50: number; p90: number; actual: number; at: string }
interface Reality { n: number; within: number; below: number; above: number; errors: number[]; points: RealityPoint[] }

const empty = (): Reality => ({ n: 0, within: 0, below: 0, above: 0, errors: [], points: [] });

function summary(r: Reality) {
  const sorted = [...r.errors].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return {
    n: r.n,
    coverage: r.n ? r.within / r.n : null,
    below: r.below,
    above: r.above,
    mdape: median,
    points: r.points.slice(-120),
  };
}

export default handle(async (req, context) => {
  if (req.method === "GET") {
    return json(summary({ ...empty(), ...((await getJSON<Reality>("reality")) || {}) }), 200, { "cache-control": "public, max-age=30" });
  }
  if (req.method !== "POST") return methodNotAllowed(["GET", "POST"]);
  const { profile, actualUsd } = await body(req, z.object({ profile: ProfileSchema, actualUsd: z.number().min(1000).max(1_000_000) }));
  await rateLimit(`reality:${await clientKey(context, "reality")}`, 3, 86400, "Thanks! You've already shared your pay today.");
  const e = estimate(rt, checkProfile(profile));
  const cmp = compare(e, actualUsd);
  const point: RealityPoint = {
    country: profile.country, years: profile.yearsPro, role: profile.role,
    p10: e.usd.p10, p50: e.usd.p50, p90: e.usd.p90, actual: Math.round(actualUsd / 500) * 500, at: new Date().toISOString().slice(0, 10),
  };
  const saved = await update<Reality>("reality", (cur) => {
    const r = { ...empty(), ...(cur || {}) };
    r.n += 1;
    r[cmp.position] += 1;
    r.errors = [...r.errors, Math.abs(cmp.errorPct)].slice(-2000);
    r.points = [...r.points, point].slice(-300);
    return r;
  });
  return json({ ...cmp, estimate: e.usd, summary: summary(saved || empty()) }, 201);
});

export const config: Config = { path: "/api/reality" };
