// POST /api/estimate: a profile in, the full estimate out (range, SHAP drivers, experience
// curve, skill and role what-ifs). Pure computation; nothing is stored except a usage counter.

import type { Config } from "@netlify/functions";
import { z } from "zod";
import { estimate } from "../../shared/predict.ts";
import { body, handle, json, methodNotAllowed } from "../lib/http.ts";
import { ProfileSchema } from "../lib/schema.ts";
import { checkProfile, rt } from "../lib/runtime.ts";
import { bump } from "../lib/stats.ts";

const Request = ProfileSchema.extend({ count: z.boolean().optional() });

export default handle(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const { count, ...profile } = await body(req, Request);
  const result = estimate(rt, checkProfile(profile));
  if (count) await bump("estimates", profile.country); // once per visit, not per keystroke
  return json(result);
});

export const config: Config = { path: "/api/estimate" };
