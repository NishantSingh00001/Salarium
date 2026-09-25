// POST /api/offer: check a job offer against the estimate for the same profile.
//   { profile, text }            an offer letter or recruiter message, read by Gemini
//   { profile, file }            the same as a PDF or image (base64, up to 3 MB)
//   { profile, manual }          numbers typed in by hand (works without AI)
// Returns the pay components, a like-for-like annual total, where it sits in the range
// (with an approximate percentile), things to check and, with AI, talking points and an email.

import type { Config } from "@netlify/functions";
import { z } from "zod";
import { estimate } from "../../shared/predict.ts";
import features from "../../public/features.json";
import { body, clientKey, handle, HttpError, json, methodNotAllowed } from "../lib/http.ts";
import { ProfileSchema } from "../lib/schema.ts";
import { checkProfile, rt } from "../lib/runtime.ts";
import { rateLimit } from "../lib/store.ts";
import { generate } from "../lib/gemini.ts";
import { bump } from "../lib/stats.ts";

const money = z.number().min(0).max(1e12);
const Request = z.object({
  profile: ProfileSchema,
  text: z.string().trim().min(20, "Paste a bit more of the offer.").max(20_000).optional(),
  file: z.object({ mimeType: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]), data: z.string().max(4_200_000, "Files up to 3 MB, please.") }).optional(),
  manual: z.object({ currency: z.string().length(3), fixed: money, variable: money.default(0), stock: money.default(0), benefits: money.default(0), joining: money.default(0) }).optional(),
}).refine((r) => Boolean(r.text || r.file || r.manual), { message: "Paste the offer, attach it, or type the numbers." });

// Exchange rates implied by the survey itself (local currency per US dollar, mid-2025).
const RATES: Record<string, number> = { USD: 1 };
for (const c of features.countries) if (!RATES[c.currency]) RATES[c.currency] = c.rate;

interface Components {
  currency: string;
  fixed: number;
  variable: number;
  stock: number;
  benefits: number;
  joining: number;
  statedTotal: number;
  role: string;
  company: string;
  location: string;
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    currency: { type: "STRING", description: "ISO 4217 code of the offer's currency, e.g. INR, USD, EUR" },
    fixed: { type: "NUMBER", description: "Annual fixed pay (base salary and fixed allowances paid in cash)" },
    variable: { type: "NUMBER", description: "Annual target variable pay or performance bonus; 0 if none" },
    stock: { type: "NUMBER", description: "Equity (RSUs, ESOPs, stock) value per year, i.e. total grant divided by vesting years; 0 if none" },
    benefits: { type: "NUMBER", description: "Amounts counted in the package but not paid as salary: employer PF, gratuity, insurance, meal cards; 0 if none" },
    joining: { type: "NUMBER", description: "One-time joining or sign-on bonus; 0 if none" },
    statedTotal: { type: "NUMBER", description: "The total package (CTC / total compensation) exactly as the offer states it; 0 if not stated" },
    role: { type: "STRING" },
    company: { type: "STRING" },
    location: { type: "STRING" },
    flags: { type: "ARRAY", items: { type: "STRING" }, description: "2–5 short things the candidate should check or ask about" },
    talkingPoints: { type: "ARRAY", items: { type: "STRING" }, description: "3–5 specific negotiation points" },
    email: { type: "STRING", description: "A short, polite negotiation email (under 130 words), plain text" },
  },
  required: ["currency", "fixed", "variable", "stock", "benefits", "joining", "statedTotal", "role", "company", "location", "flags", "talkingPoints", "email"],
};

const SYSTEM = `You read job offers for software developers (offer letters, recruiter emails, CTC breakdowns) and extract the pay precisely.
Rules:
- All amounts are per year in the offer's currency. Convert monthly figures to yearly (×12).
- Indian offers: "12 LPA" or "12 lakh" means 1,200,000 INR per year; "1.2 Cr" means 12,000,000 INR.
- Never invent numbers. Use 0 for anything the offer doesn't mention.
- Equity: divide the total grant by the vesting years. If only a number of shares with no value is given, use 0 and add a flag.
Then advise the candidate briefly, specifically and kindly. Use the market range you are given; don't make up other statistics.`;

function lpaOrCompact(v: number, currency: string) {
  if (currency === "INR") return v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : `₹${(v / 1e5).toFixed(1)} lakh`;
  return new Intl.NumberFormat("en", { style: "currency", currency, notation: "compact", maximumSignificantDigits: 3 }).format(v);
}

/** Rough percentile of `usd` within the profile's distribution, interpolating p10/p50/p90 on the log scale. */
function percentile(usd: number, r: { p10: number; p50: number; p90: number }): number {
  const x = Math.log(usd);
  const [a, b, c] = [Math.log(r.p10), Math.log(r.p50), Math.log(r.p90)];
  let p: number;
  if (x <= b) p = 10 + ((x - a) / (b - a)) * 40;
  else p = 50 + ((x - b) / (c - b)) * 40;
  // Outside p10–p90 the tails are too uncertain for a number, so we clamp and say "below/above".
  return Math.round(Math.min(90, Math.max(10, p)));
}

function fallbackAdvice(position: string, pct: number) {
  if (position === "below") return ["The offer is below the range for your profile. Ask whether the fixed pay can move before discussing anything else.", "Bring market evidence: the estimate for your profile, and any competing offers.", "If fixed pay can't move, ask for a joining bonus or an early salary review (for example after 6 months)."];
  if (pct < 50) return ["The offer is in the lower half of the range. A 10–15% counter on fixed pay is reasonable.", "Ask how the variable pay is decided and how much was actually paid out last year.", "Check the notice period, bonds or clawbacks before you sign."];
  return ["The offer is at or above the middle of the range. Negotiate on what matters most to you: joining date, role scope, remote days or learning budget.", "Confirm the variable pay and equity details in writing.", "Check the notice period, bonds or clawbacks before you sign."];
}

export default handle(async (req, context) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const r = await body(req, Request, 4_500_000);
  const profile = checkProfile(r.profile);
  const e = estimate(rt, profile);
  const home = features.countries.find((c) => c.name === profile.country);

  let comp: Components;
  let flags: string[] = [];
  let talkingPoints: string[] = [];
  let email = "";
  let ai = false;

  if (r.manual) {
    const m = r.manual;
    comp = { currency: m.currency.toUpperCase(), fixed: m.fixed, variable: m.variable, stock: m.stock, benefits: m.benefits, joining: m.joining, statedTotal: 0, role: "", company: "", location: "" };
  } else {
    await rateLimit(`offer:${await clientKey(context, "offer")}`, 12, 3600, "You've checked a lot of offers this hour. Try again a little later.");
    const cur = home?.currency || "USD";
    const rate = RATES[cur] || 1;
    const range = `${lpaOrCompact(e.usd.p10 * rate, cur)} to ${lpaOrCompact(e.usd.p90 * rate, cur)} a year, median ${lpaOrCompact(e.usd.p50 * rate, cur)} (total pay incl. bonus, before tax; USD ${e.usd.p10.toLocaleString("en-US")}–${e.usd.p90.toLocaleString("en-US")})`;
    const who = `${profile.yearsPro} years of experience, ${profile.role}, ${profile.education}, company size ${profile.orgSize}, ${profile.remote}, in ${profile.country}`;
    const { data } = await generate<Components & { flags: string[]; talkingPoints: string[]; email: string }>({
      system: SYSTEM,
      prompt: `Candidate: ${who}.\nMarket range for this profile (80% of similar developers): ${range}.\n\n${r.text ? `Offer:\n${r.text}` : "The offer is attached."}`,
      file: r.file,
      schema: SCHEMA,
      temperature: 0.2,
      maxOutputTokens: 2000,
      deadlineMs: 40_000,
    });
    if (!data) throw new HttpError(502, "The AI couldn't read that offer. Try pasting the text instead.");
    comp = {
      currency: String(data.currency || cur).toUpperCase().slice(0, 3),
      fixed: Math.max(0, Number(data.fixed) || 0), variable: Math.max(0, Number(data.variable) || 0),
      stock: Math.max(0, Number(data.stock) || 0), benefits: Math.max(0, Number(data.benefits) || 0),
      joining: Math.max(0, Number(data.joining) || 0), statedTotal: Math.max(0, Number(data.statedTotal) || 0),
      role: String(data.role || "").slice(0, 120), company: String(data.company || "").slice(0, 120), location: String(data.location || "").slice(0, 120),
    };
    flags = (data.flags || []).map(String).slice(0, 6);
    talkingPoints = (data.talkingPoints || []).map(String).slice(0, 6);
    email = String(data.email || "").slice(0, 2000);
    ai = true;
    if (!(comp.fixed > 0)) throw new HttpError(422, "We couldn't find the fixed pay in that offer. Try the manual form instead.");
  }

  const rate = RATES[comp.currency];
  if (!rate) throw new HttpError(422, `We can't convert ${comp.currency} yet. Use the manual form in ${home?.currency || "USD"}.`);
  // Like-for-like with the survey question: total annual pay incl. bonuses and perks, before tax.
  const annual = comp.fixed + comp.variable + comp.stock + comp.benefits;
  const usd = annual / rate;
  const position = usd < e.usd.p10 ? "below" : usd > e.usd.p90 ? "above" : "within";
  const pct = percentile(usd, e.usd);
  if (!ai) talkingPoints = fallbackAdvice(position, pct);
  if (comp.variable > 0) flags.push("Variable pay is usually a target, not a promise. Ask what was paid out last year.");
  if (comp.benefits > 0) flags.push("Part of the package (PF, gratuity, insurance) isn't paid as monthly salary.");
  flags = [...new Set(flags)].slice(0, 6);

  await bump("offers");
  return json({
    ai,
    components: comp,
    annual: { local: Math.round(annual), usd: Math.round(usd), currency: comp.currency },
    estimate: e.usd,
    position,
    percentile: pct,
    flags,
    talkingPoints,
    email,
  });
});

export const config: Config = { path: "/api/offer" };
