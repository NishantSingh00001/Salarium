import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Field, Footer, Nav, Spinner, Tabs, toast } from "../components/ui";
import { RangeBar } from "../components/charts";
import { useFeatures, useMarket } from "../lib/meta";
import { useProfile } from "../lib/profile";
import { api } from "../lib/api";
import { moneyParts } from "../lib/money";

type Mode = "paste" | "upload" | "numbers";

interface OfferResult {
  ai: boolean;
  components: { currency: string; fixed: number; variable: number; stock: number; benefits: number; joining: number; statedTotal: number; role: string; company: string; location: string };
  annual: { local: number; usd: number; currency: string };
  estimate: { p10: number; p50: number; p90: number };
  position: "below" | "within" | "above";
  percentile: number;
  flags: string[];
  talkingPoints: string[];
  email: string;
}

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 10 > 3 || [11, 12, 13].includes(n % 100) ? 0 : n % 10]}`;

const SAMPLE = `Dear Nishant,

We are delighted to offer you the position of Software Engineer I at Northwind Labs, Bengaluru.

Compensation (per annum):
- Fixed pay: INR 11,40,000
- Performance bonus (target): 10% of fixed pay
- Employer PF contribution: INR 54,000
- Group health insurance: INR 15,000
- Joining bonus: INR 1,00,000 (repayable if you leave within 12 months)
- ESOPs: 1,200 options vesting over 4 years with a 1-year cliff

Total CTC: INR 13,23,000. Notice period: 60 days.`;

export default function Offer() {
  const profile = useProfile();
  const { data: features } = useFeatures();
  const { data: market } = useMarket();
  const country = features?.countries.find((c) => c.name === profile.country) || null;
  const median = market?.countries.find((c) => c.name === profile.country)?.p50 ?? null;
  const [ai, setAi] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("paste");
  const [text, setText] = useState("");
  const [file, setFile] = useState<{ name: string; mimeType: string; data: string } | null>(null);
  const cur = country?.currency || "USD";
  const inr = cur === "INR";
  const [manual, setManual] = useState({ fixed: "", variable: "", stock: "", benefits: "", joining: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<OfferResult | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ ai: boolean }>("/api/health").then((h) => { setAi(h.ai); if (!h.ai) setMode("numbers"); }).catch(() => setAi(false));
  }, []);

  const pickFile = (f: File | undefined) => {
    if (!f) return;
    if (!/^(application\/pdf|image\/(png|jpeg|webp))$/.test(f.type)) { setErr("Use a PDF, PNG, JPG or WebP file."); return; }
    if (f.size > 3 * 1024 * 1024) { setErr("That file is over 3 MB. Try a smaller scan or paste the text."); return; }
    const reader = new FileReader();
    reader.onload = () => { setFile({ name: f.name, mimeType: f.type, data: String(reader.result).split(",")[1] }); setErr(null); };
    reader.readAsDataURL(f);
  };

  const num = (v: string) => { const n = Number(v.replace(/[, ]/g, "")); return Number.isFinite(n) && n > 0 ? (inr ? n * 1e5 : n) : 0; };

  const submit = async () => {
    setErr(null);
    let payload: Record<string, unknown> = { profile };
    if (mode === "paste") { if (text.trim().length < 20) { setErr("Paste the offer text first."); return; } payload.text = text; }
    if (mode === "upload") { if (!file) { setErr("Choose a file first."); return; } payload.file = { mimeType: file.mimeType, data: file.data }; }
    if (mode === "numbers") {
      if (!num(manual.fixed)) { setErr("Enter at least the fixed pay."); return; }
      payload = { profile, manual: { currency: cur, fixed: num(manual.fixed), variable: num(manual.variable), stock: num(manual.stock), benefits: num(manual.benefits), joining: num(manual.joining) } };
    }
    setBusy(true);
    try {
      const r = await api<OfferResult>("/api/offer", { body: payload });
      setRes(r);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const fmt = (v: number, c: string) => moneyParts(v, c).text;
  const verdict = res ? (res.position === "below" ? "Below the range" : res.position === "above" ? "Above the range" : res.percentile >= 50 ? "Upper half of the range" : "Lower half of the range") : "";

  return (
    <>
      <Nav />
      <header className="hero">
        <div className="wrap" style={{ position: "relative" }}>
          <div className="hero__cols" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
          <div className="hero__grid">
            <motion.h1 className="display hero__title" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.2, 0.7, 0.1, 1] }}>Is this offer fair<span className="q">?</span></motion.h1>
            <motion.div className="hero__side" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8 }}>
              <p className="lead" style={{ margin: 0 }}>Paste an offer letter or a recruiter's message. Gemini reads the pay components, we turn them into a like-for-like yearly number and place it in the range for your profile. Then you get talking points and an email you can send.</p>
            </motion.div>
          </div>
        </div>
      </header>

      <section className="section">
        <div className="wrap">
          <div className="est est--offer">
            <div>
              <span className="label"><span className="index">01</span> &nbsp;The offer</span>
              <div style={{ marginTop: 14 }}>
                <Tabs id="offer" value={mode} onChange={setMode} options={[["paste", "Paste"], ["upload", "Upload"], ["numbers", "Type numbers"]]} />
              </div>
              <AnimatePresence mode="wait">
                <motion.div key={mode} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                  {mode !== "numbers" && ai === false && <p className="note" style={{ marginBottom: 14 }}>Reading offers needs AI, which isn't switched on for this deployment yet. You can still type the numbers.</p>}
                  {mode === "paste" && (
                    <div style={{ display: "grid", gap: 10 }}>
                      <textarea className="input" rows={12} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the offer letter, the CTC breakdown or the recruiter's message here…" aria-label="Offer text" />
                      <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: "start", paddingLeft: 0 }} onClick={() => setText(SAMPLE)}>Try a sample offer</button>
                    </div>
                  )}
                  {mode === "upload" && (
                    <label className="panel" style={{ display: "grid", placeItems: "center", minHeight: 220, border: "1.5px dashed var(--ink)", cursor: "pointer", textAlign: "center", gap: 8 }}
                      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files[0]); }}>
                      <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr" onChange={(e) => pickFile(e.target.files?.[0])} />
                      <b style={{ fontSize: "1.2rem" }}>{file ? file.name : "Drop the offer letter here"}</b>
                      <span className="small muted">{file ? "Ready. Click to choose a different file." : "or click to choose a PDF, PNG, JPG or WebP (up to 3 MB)"}</span>
                    </label>
                  )}
                  {mode === "numbers" && (
                    <div>
                      <p className="small muted" style={{ marginTop: 0 }}>Yearly amounts in {cur}{inr ? ", in lakh (for example 11.4 for ₹11,40,000)" : ""}.</p>
                      <div className="two">
                        {([["fixed", "Fixed pay", "base salary and fixed allowances"], ["variable", "Variable or bonus", "the yearly target"], ["stock", "Equity per year", "total grant ÷ vesting years"], ["benefits", "Benefits in the package", "PF, gratuity, insurance"], ["joining", "Joining bonus", "one-time, not counted"]] as const).map(([k, l, h]) => (
                          <Field key={k} label={l} hint={h}>
                            <input className="input num" inputMode="decimal" value={manual[k]} onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))} placeholder={k === "fixed" ? (inr ? "11.4" : "85000") : "0"} aria-label={l} />
                          </Field>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
              {err && <p className="err">{err}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
                <button className="btn btn--red" onClick={submit} disabled={busy || (mode !== "numbers" && ai === false)}>{busy ? <><Spinner /> {mode === "numbers" ? "Checking…" : "Reading the offer…"}</> : <>Check this offer <span className="arrow">→</span></>}</button>
              </div>
              <p className="xs dim" style={{ marginTop: 14 }}>The offer is sent to Google's Gemini API to be read and isn't stored by Salarium. Remove names or anything private if you like; only the numbers matter.</p>
            </div>
            <aside className="panel" style={{ alignSelf: "start" }}>
              <span className="label">Compared against</span>
              <p style={{ margin: "8px 0 4px", fontWeight: 700, fontSize: "1.1rem" }}>{profile.role}, {profile.yearsPro} years, {profile.country}</p>
              <p className="small muted" style={{ margin: 0 }}>{profile.orgSize} people · {profile.remote} · {profile.skills.length} technologies</p>
              <Link to="/" className="btn btn--sm" style={{ marginTop: 14 }}>Edit the profile</Link>
            </aside>
          </div>
        </div>
      </section>

      {res && (
        <section className="section" ref={resultRef}>
          <div className="wrap">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
              <div className="grid2">
                <div className="verdict">
                  <span className="label"><span className="index">02</span> &nbsp;Verdict</span>
                  <div className="verdict__big">{verdict}</div>
                  <p className="lead" style={{ fontSize: "1.05rem", margin: "6px 0 0" }}>Like for like, this offer is worth <b style={{ color: "var(--ink)" }}>{fmt(res.annual.local, res.annual.currency)}</b> a year{res.position === "below" ? <>, which is <b style={{ color: "var(--ink)" }}>less than 9 in 10 developers</b> with your profile earn.</> : res.position === "above" ? <>, which is <b style={{ color: "var(--ink)" }}>more than 9 in 10 developers</b> with your profile earn.</> : <>, about the <b style={{ color: "var(--ink)" }}>{ordinal(res.percentile)} percentile</b> for developers with your profile.</>}</p>
                  <RangeBar usd={res.estimate} country={country} medianUsd={median} offerUsd={res.annual.usd} />
                </div>
                <div className="block">
                  <span className="label">The components{res.components.company ? ` · ${res.components.company}` : ""}</span>
                  <table className="dtable">
                    <tbody>
                      <tr><td>Fixed pay</td><td className="r">{fmt(res.components.fixed, res.components.currency)}</td></tr>
                      <tr><td>Variable / bonus (target)</td><td className="r">{fmt(res.components.variable, res.components.currency)}</td></tr>
                      <tr><td>Equity per year</td><td className="r">{fmt(res.components.stock, res.components.currency)}</td></tr>
                      <tr><td>Benefits in the package</td><td className="r">{fmt(res.components.benefits, res.components.currency)}</td></tr>
                      <tr className="me"><td>Yearly total, like for like</td><td className="r">{fmt(res.annual.local, res.annual.currency)}</td></tr>
                      <tr><td className="dim">Joining bonus (one-time, not counted)</td><td className="r dim">{fmt(res.components.joining, res.components.currency)}</td></tr>
                      {res.components.statedTotal > 0 && <tr><td className="dim">Total as stated in the offer</td><td className="r dim">{fmt(res.components.statedTotal, res.components.currency)}</td></tr>}
                    </tbody>
                  </table>
                  <p className="xs dim" style={{ margin: 0 }}>Counted the way the survey asked: salary, bonuses and perks per year, before tax.</p>
                </div>
              </div>
              <div className="grid3" style={{ marginTop: 48 }}>
                <div className="block"><span className="label"><span className="index">03</span> &nbsp;Worth checking</span><ul className="list">{res.flags.length ? res.flags.map((f) => <li key={f}>{f}</li>) : <li>Nothing unusual spotted.</li>}</ul></div>
                <div className="block"><span className="label"><span className="index">04</span> &nbsp;Talking points</span><ul className="list">{res.talkingPoints.map((t) => <li key={t}>{t}</li>)}</ul></div>
                <div className="block">
                  <span className="label"><span className="index">05</span> &nbsp;{res.email ? "Email draft" : "Next step"}</span>
                  {res.email ? (
                    <>
                      <div className="email">{res.email}</div>
                      <button className="btn btn--sm" style={{ justifySelf: "start" }} onClick={() => { navigator.clipboard?.writeText(res.email).then(() => toast("Email copied")).catch(() => toast("Couldn't copy", "error")); }}>Copy email</button>
                    </>
                  ) : <p className="muted" style={{ margin: 0 }}>Paste the offer text instead of typing numbers to get an AI-written negotiation email.</p>}
                </div>
              </div>
            </motion.div>
          </div>
        </section>
      )}
      <Footer />
    </>
  );
}
