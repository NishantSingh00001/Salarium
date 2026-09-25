// Shareable reports.
//   POST /api/reports       { profile }  → { id }
//   GET  /api/reports/:id                → { profile, estimate, created, views }
// A report stores only the profile (no name, no email); the estimate is recomputed on view.

import type { Config } from "@netlify/functions";
import { z } from "zod";
import { estimate } from "../../shared/predict.ts";
import { body, clientKey, handle, HttpError, json, methodNotAllowed } from "../lib/http.ts";
import { ProfileSchema } from "../lib/schema.ts";
import { checkProfile, rt } from "../lib/runtime.ts";
import { getJSON, rateLimit, store, update } from "../lib/store.ts";
import { bump } from "../lib/stats.ts";

interface Report {
  profile: z.infer<typeof ProfileSchema>;
  saved: { p10: number; p50: number; p90: number };
  created: string;
  views: number;
}

const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALPHABET[b % ALPHABET.length]).join("");

export default handle(async (req, context) => {
  const id = context.params?.id;
  if (!id) {
    if (req.method !== "POST") return methodNotAllowed(["POST"]);
    const { profile } = await body(req, z.object({ profile: ProfileSchema }));
    await rateLimit(`report:${await clientKey(context, "report")}`, 30, 3600, "That's a lot of reports. Try again in an hour.");
    const e = estimate(rt, checkProfile(profile));
    for (let i = 0; i < 5; i++) {
      const rid = newId();
      const rec: Report = { profile, saved: e.usd, created: new Date().toISOString(), views: 0 };
      const res = await store().setJSON(`r/${rid}`, rec, { onlyIfNew: true });
      if (res.modified) {
        await bump("reports");
        return json({ id: rid }, 201);
      }
    }
    throw new HttpError(503, "Couldn't save the report. Please try again.");
  }

  if (req.method !== "GET") return methodNotAllowed(["GET"]);
  if (!/^[2-9a-hjkmnp-z]{10}$/.test(id)) throw new HttpError(400, "That report link isn't valid.");
  const rec = await getJSON<Report>(`r/${id}`);
  if (!rec) throw new HttpError(410, "This report doesn't exist any more.");
  const views = rec.views + 1;
  await update<Report>(`r/${id}`, (cur) => (cur ? { ...cur, views: cur.views + 1 } : undefined)).catch(() => null);
  let result = null;
  try { result = estimate(rt, checkProfile(rec.profile)); } catch { /* a newer model may not know an old value */ }
  return json({ id, profile: rec.profile, saved: rec.saved, estimate: result, created: rec.created, views });
});

export const config: Config = { path: ["/api/reports", "/api/reports/:id"] };
