// GET /api/health: is the API up, which model is loaded, is AI switched on, and usage counters.

import type { Config } from "@netlify/functions";
import { aiConfigured } from "../lib/gemini.ts";
import { handle, json } from "../lib/http.ts";
import { rt } from "../lib/runtime.ts";
import { readStats } from "../lib/stats.ts";

export default handle(async () => {
  let stats = null;
  try { stats = await readStats(); } catch { /* storage unavailable: still healthy enough to estimate */ }
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.now() - (13 - i) * 86400_000).toISOString().slice(0, 10);
    return { day: d, estimates: stats?.days[d] || 0 };
  });
  return json({
    ok: true,
    ai: aiConfigured(),
    model: { version: rt.file.version, trained: rt.file.trained, trees: rt.point.trees.length + rt.lo.trees.length + rt.hi.trees.length, features: rt.features.length },
    stats: stats && { estimates: stats.estimates, reports: stats.reports, offers: stats.offers, last14 },
  }, 200, { "cache-control": "public, max-age=20" });
});

export const config: Config = { path: "/api/health" };
