import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { Estimate as EstimateResult } from "../../shared/predict";
import { Field, Footer, Nav, Reveal, SectionHead, Seg, Select, Spinner, toast } from "../components/ui";
import { Curve, Drivers, RangeBar } from "../components/charts";
import { useFeatures, useMarket, useModelCard, valuesOf, type CountryInfo, type Features } from "../lib/meta";
import { sanitize, setProfile, useProfile, type Profile } from "../lib/profile";
import { useEstimate } from "../lib/useEstimate";
import { local, pctText, perYear, usdText } from "../lib/money";
import { useTween } from "../lib/tween";
import { api } from "../lib/api";

const GROUPS: [string, string][] = [["lang", "Languages"], ["web", "Frameworks"], ["db", "Databases"], ["plat", "Cloud & tools"]];

export default function EstimatePage() {
  const { data: features, error } = useFeatures();
  const { data: market } = useMarket();
  const { data: card } = useModelCard();
  const profile = useProfile();
  const kept = card ? card.funnel[card.funnel.length - 1].n : 17332;
  const lgb = card?.results.LightGBM;
  useEffect(() => { if (features) sanitize(features); }, [features]);
  const { data: est, loading, error: estError } = useEstimate(features ? profile : null);
  const country = features?.countries.find((c) => c.name === profile.country) || null;
  const median = market?.countries.find((c) => c.name === profile.country)?.p50 ?? null;

  return (
    <>
      <Nav />
      <header className="hero">
        <div className="wrap" style={{ position: "relative" }}>
          <div className="hero__cols" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
          <div className="hero__grid">
            <motion.h1 className="display hero__title" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.2, 0.7, 0.1, 1] }}>
              What should a developer earn<span className="q">?</span>
            </motion.h1>
            <motion.div className="hero__side" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 0.8 }}>
              <p className="lead" style={{ margin: 0 }}>An honest answer from {kept.toLocaleString()} real salaries in {features?.countries.length || 59} countries. You get a range, not a single number, and the reasons behind it.</p>
              <div className="facts">
                <div><b>±{lgb ? (lgb.mdape * 100).toFixed(1) : "21.6"}%</b><span>typical error</span></div>
                <div><b>{card ? Math.round(card.range.coverage * 100) : 81}%</b><span>of real pay falls inside the range</span></div>
                <div><b>{features?.countries.length || 59}</b><span>countries, in local currency</span></div>
                <div><b>{card?.features.skills || 103}</b><span>technologies in the model</span></div>
              </div>
            </motion.div>
          </div>
        </div>
      </header>

      <section className="section" id="estimate" aria-label="Your estimate">
        <div className="wrap">
          {error && <p className="err">Couldn't load the model's options: {error}</p>}
          {!features ? <div style={{ padding: 40 }}><Spinner /></div> : (
            <div className="est">
              <div className="est__form">
                <span className="label"><span className="index">01</span> &nbsp;Your profile</span>
                <ProfileForm features={features} profile={profile} />
              </div>
              <div className="est__result">
                <Result est={est} loading={loading} error={estError} country={country} median={median} profile={profile} mdape={lgb?.mdape ?? null} />
              </div>
            </div>
          )}
        </div>
      </section>

      {est && features && (
        <>
          <section className="section">
            <div className="wrap">
              <Reveal>
                <SectionHead n="02" title="What moves your number">
                  Every factor, measured with SHAP values from the model. Bars show how much each answer raises or lowers your estimate compared with the average developer in the data.
                </SectionHead>
                <Drivers drivers={est.drivers} baselineUsd={est.baselineUsd} country={country} />
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <Reveal>
                <SectionHead n="03" title="Your next 30 years">
                  The same profile with more experience. The model is constrained so the estimate never drops as experience grows; the shaded band is where 80% of developers like you land.
                </SectionHead>
                <Curve curve={est.curve} years={Math.min(30, profile.yearsPro)} country={country} />
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap grid2">
              <Reveal>
                <div className="block">
                  <div className="block__head"><span className="label"><span className="index">04</span> &nbsp;Skills linked to higher pay for you</span></div>
                  <h3 className="h3">Add one and see what changes</h3>
                  <Uplifts est={est} features={features} />
                  <p className="note">These are patterns in the data, not promises: people who use these tools also tend to have other things in common. Learning one won't guarantee a raise.</p>
                </div>
              </Reveal>
              <Reveal delay={120}>
                <div className="block">
                  <div className="block__head"><span className="label"><span className="index">05</span> &nbsp;Same profile, other roles</span></div>
                  <h3 className="h3">How your role changes the estimate</h3>
                  <Roles est={est} />
                </div>
              </Reveal>
            </div>
          </section>

          <section className="section" id="reality">
            <div className="wrap">
              <Reveal>
                <SectionHead n="06" title={<>How close were we<span className="red">?</span></>}>
                  Tell us what you actually earn and we'll show where it falls. It's anonymous: we keep only your profile's answers and your pay rounded to $500, which feed the live accuracy on the <Link to="/model">model page</Link>.
                </SectionHead>
                <RealityCheck profile={profile} country={country} est={est} />
              </Reveal>
            </div>
          </section>
        </>
      )}
      <Footer />
    </>
  );
}

// ---------------------------------------------------------------- form

function ProfileForm({ features, profile }: { features: Features; profile: Profile }) {
  const v = (k: string) => valuesOf(features, k);
  const set = (patch: Partial<Profile>) => setProfile(patch);
  const countryOpts = [...features.countries].sort((a, b) => a.name.localeCompare(b.name)).map((c) => [c.name, `${c.name}`] as [string, string]);
  const code = features.countries.find((c) => c.name === profile.country)?.code;
  const fill = `${(Math.min(40, profile.yearsPro) / 40) * 100}%`;
  const yearsCode = profile.yearsCode ?? profile.yearsPro + 4;
  return (
    <div>
      <Field label="Country" hint="where you live and work">
        <Select label="Country" value={profile.country} options={countryOpts} onChange={(c) => set({ country: c })} code={code} />
      </Field>
      <Field label="Years of professional experience" hint="full-time work, rounded">
        <div className="years">
          <div className="years__n num" aria-hidden="true">{profile.yearsPro}<small>{profile.yearsPro === 1 ? "year" : "years"}</small></div>
          <div>
            <input className="range" type="range" min={0} max={40} step={1} value={Math.min(40, profile.yearsPro)} aria-label="Years of professional experience" style={{ ["--fill" as string]: fill }}
              onChange={(e) => { const y = Number(e.target.value); set({ yearsPro: y, yearsCode: Math.max(y, yearsCode + (y - profile.yearsPro)) }); }} />
            <div className="ticks"><span>0</span><span>10</span><span>20</span><span>30</span><span>40</span></div>
          </div>
        </div>
      </Field>
      <Field label="Years coding in total" hint="including study and hobby">
        <div className="stepper" role="group" aria-label="Years coding in total">
          <button type="button" aria-label="Fewer" onClick={() => set({ yearsCode: Math.max(profile.yearsPro, yearsCode - 1) })}>−</button>
          <span aria-live="polite">{yearsCode}</span>
          <button type="button" aria-label="More" onClick={() => set({ yearsCode: Math.min(50, yearsCode + 1) })}>+</button>
        </div>
      </Field>
      <Field label="Role">
        <Select label="Role" value={profile.role} options={v("role")} onChange={(r) => set({ role: r })} />
      </Field>
      <div className="two">
        <Field label="Company size">
          <Select label="Company size" value={profile.orgSize} options={v("org_size").map((s) => [s, s === "Just me" || s === "Not sure" ? s : `${s} people`])} onChange={(s) => set({ orgSize: s })} />
        </Field>
        <Field label="Industry">
          <Select label="Industry" value={profile.industry} options={v("industry")} onChange={(s) => set({ industry: s })} />
        </Field>
      </div>
      <Field label="Work setup">
        <Seg id="remote" label="Work setup" wrap value={profile.remote} options={v("remote").filter((x) => x !== "Not sure")} onChange={(s) => set({ remote: s })} />
      </Field>
      <div className="two">
        <Field label="Position">
          <Seg id="manager" label="Position" value={profile.manager} options={[["Individual contributor", "Engineer"], ["People manager", "Manager"]]} onChange={(s) => set({ manager: s })} />
        </Field>
        <Field label="Employment">
          <Seg id="employment" label="Employment" value={profile.employment} options={[["Employee", "Employee"], ["Self-employed", "Freelance"]]} onChange={(s) => set({ employment: s })} />
        </Field>
      </div>
      <Field label="Education">
        <Select label="Education" value={profile.education} options={v("education")} onChange={(s) => set({ education: s })} />
      </Field>
      <SkillPicker features={features} selected={profile.skills} onChange={(skills) => set({ skills })} />
    </div>
  );
}

function SkillPicker({ features, selected, onChange }: { features: Features; selected: string[]; onChange: (s: string[]) => void }) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const skills = features.features.filter((f) => f.kind === "bin");
  const byKey = new Map(skills.map((s) => [s.key, s]));
  const toggle = (k: string) => onChange(selected.includes(k) ? selected.filter((s) => s !== k) : [...selected, k]);
  const query = q.trim().toLowerCase();
  return (
    <Field label={`Technologies you use (${selected.length})`} hint="pick what you work with regularly">
      <div className="skills__picked">
        <AnimatePresence initial={false}>
          {selected.map((k) => (
            <motion.button layout key={k} type="button" className="chip on" onClick={() => toggle(k)} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.18 }} aria-label={`Remove ${byKey.get(k)?.label}`}>
              {byKey.get(k)?.label || k}<span className="x" aria-hidden="true">×</span>
            </motion.button>
          ))}
        </AnimatePresence>
        {!selected.length && <span className="small dim">None yet. Add a few below.</span>}
      </div>
      <input className="input" style={{ marginTop: 8 }} placeholder={`Search ${skills.length} technologies: Python, React, AWS…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search technologies" />
      <div className="skills__groups">
        {GROUPS.map(([g, name]) => {
          const list = skills.filter((s) => s.group === g && !selected.includes(s.key) && (!query || s.label.toLowerCase().includes(query)));
          const shown = query || all ? list : list.slice(0, 9);
          if (!shown.length) return null;
          return (
            <div key={g} className="skills__group">
              <span className="label">{name}</span>
              <div>{shown.map((s) => <button key={s.key} type="button" className="chip chip--add" onClick={() => toggle(s.key)}>+ {s.label}</button>)}</div>
            </div>
          );
        })}
      </div>
      {!query && <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: "start", paddingLeft: 0 }} onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : "Show all technologies"}</button>}
    </Field>
  );
}

// ---------------------------------------------------------------- result

function Result({ est, loading, error, country, median, profile, mdape }: { est: EstimateResult | null; loading: boolean; error: string | null; country: CountryInfo | null; median: number | null; profile: Profile; mdape: number | null }) {
  const p50 = useTween(est ? est.usd.p50 : 0);
  const parts = local(p50 || 1, country);
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const save = async () => {
    setSaving(true);
    try {
      const r = await api<{ id: string }>("/api/reports", { body: { profile } });
      const url = `${location.origin}/r/${r.id}`;
      setLink(url);
      try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast("Report saved"); }
    } catch (e) { toast((e as Error).message, "error"); } finally { setSaving(false); }
  };
  if (!est) {
    return <div className="result"><span className="label">Estimated total pay</span><div style={{ padding: "40px 0" }}>{error ? <p className="err">{error}</p> : <Spinner />}</div></div>;
  }
  const cur = country?.currency || "USD";
  return (
    <div className={`result ${loading ? "loading" : ""}`} aria-live="polite" aria-busy={loading}>
      <div className="result__where">
        <span className="label">Estimated total pay {perYear(cur)}</span>
        {country && <span className="tag">{country.code}</span>}
        {loading && <Spinner />}
      </div>
      <div className="hero-num" aria-label={local(est.usd.p50, country).text}>
        {parts.prefix && <span className="pre">{parts.prefix}</span>}
        <span>{parts.number}</span>
        {parts.suffix && <span className="suf">{parts.suffix.trim()}</span>}
      </div>
      <div className="result__sub">
        <span><b>{usdText(est.usd.p50)}</b> a year in US dollars</span>
        <span>salary + bonus, before tax</span>
      </div>
      <p className="result__range">80% of developers like you earn between <b>{local(est.usd.p10, country).text}</b> and <b>{local(est.usd.p90, country).text}</b>.{median ? <> The median for all developers in {profile.country} is {local(median, country).text}.</> : null}</p>
      <RangeBar usd={est.usd} country={country} medianUsd={median} />
      <div className="result__actions">
        <button className="btn btn--red" onClick={save} disabled={saving}>{saving ? <Spinner /> : "Save & share"}</button>
        <Link className="btn" to="/offer">Check an offer <span className="arrow">→</span></Link>
        <a className="btn btn--ghost" href="#reality">Tell us your real pay</a>
      </div>
      {link && <p className="small" style={{ marginTop: 12 }}>Share link: <a href={link}>{link.replace(/^https?:\/\//, "")}</a></p>}
      <p className="result__foot">{mdape != null && <>Typical error ±{(mdape * 100).toFixed(1)}%. </>}Model v{est.model.version}, trained {est.model.trained} on the Stack Overflow 2025 survey. <Link to="/model">How it works</Link></p>
    </div>
  );
}

// ---------------------------------------------------------------- what-ifs

function Uplifts({ est, features }: { est: EstimateResult; features: Features }) {
  const profile = useProfile();
  const groupName = useMemo(() => Object.fromEntries(GROUPS), []);
  if (!est.uplifts.length) return <p className="muted">You already use the technologies most linked to higher pay for this profile.</p>;
  const max = Math.max(...est.uplifts.map((u) => u.pct));
  return (
    <div>
      {est.uplifts.map((u, i) => (
        <motion.div key={u.key} className="uplift" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
          <div>
            <b>{u.label}</b> <span className="xs dim">{groupName[u.group] || ""}</span>
            <div className="uplift__bar"><motion.i initial={{ scaleX: 0 }} animate={{ scaleX: u.pct / max }} transition={{ duration: 0.7, ease: [0.2, 0.7, 0.1, 1], delay: 0.1 + i * 0.04 }} style={{ right: 0 }} /></div>
          </div>
          <span className="pct">{pctText(u.pct)}</span>
          <button className="btn btn--sm" onClick={() => setProfile({ skills: [...profile.skills, u.key] })} aria-label={`Add ${u.label} to your profile`}>Add</button>
        </motion.div>
      ))}
      <p className="xs dim" style={{ marginTop: 8 }}>{features.features.filter((f) => f.kind === "bin").length - profile.skills.length} technologies checked for your profile.</p>
    </div>
  );
}

function Roles({ est }: { est: EstimateResult }) {
  const rows = [...est.roles.slice(0, 5), ...est.roles.slice(-3)].filter((r, i, a) => a.findIndex((x) => x.role === r.role) === i);
  const max = Math.max(0.05, ...rows.map((r) => Math.abs(r.pct)));
  return (
    <div>
      {rows.map((r, i) => (
        <div key={r.role} className="uplift" style={{ gridTemplateColumns: "minmax(0,1fr) auto" }}>
          <div>
            <b>{r.role}</b>
            <div className="uplift__bar">
              <motion.i initial={{ scaleX: 0 }} animate={{ scaleX: Math.abs(r.pct) / max }} transition={{ duration: 0.7, ease: [0.2, 0.7, 0.1, 1], delay: 0.1 + i * 0.04 }} style={{ right: 0, background: r.pct >= 0 ? "var(--blue)" : "var(--red)" }} />
            </div>
          </div>
          <span className="pct">{pctText(r.pct)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- reality check

interface RealityResult { position: "below" | "within" | "above"; errorPct: number; estimate: EstimateResult["usd"]; summary: { n: number; coverage: number | null; mdape: number | null } }

function RealityCheck({ profile, country, est }: { profile: Profile; country: CountryInfo | null; est: EstimateResult }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RealityResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cur = country?.currency || "USD";
  const inr = cur === "INR";
  const toUsd = (v: number) => (inr ? v * 1e5 : v) / (country?.rate || 1);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = Number(amount.replace(/[, ]/g, ""));
    if (!(v > 0)) { setErr(inr ? "Enter your yearly pay in lakh, like 12.5" : "Enter your yearly pay"); return; }
    setBusy(true); setErr(null);
    try { setRes(await api<RealityResult>("/api/reality", { body: { profile, actualUsd: Math.round(toUsd(v)) } })); }
    catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="grid2">
      <form onSubmit={submit} className="block" style={{ borderTop: 0, paddingTop: 0 }}>
        <label className="field" style={{ borderTop: "1.5px solid var(--ink)" }}>
          <span className="field__head"><span className="field__label">Your total pay per year, before tax</span><span className="field__hint">{inr ? "in lakh (LPA)" : cur}</span></span>
          <div style={{ display: "flex", gap: 10 }}>
            <input className="input num" inputMode="decimal" placeholder={inr ? "e.g. 12.5" : "e.g. 65000"} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={`Your yearly pay in ${inr ? "lakh rupees" : cur}`} />
            <button className="btn btn--red" disabled={busy}>{busy ? <Spinner /> : "Check"}</button>
          </div>
        </label>
        {err && <p className="err">{err}</p>}
        <p className="xs dim" style={{ margin: 0 }}>Uses the same profile as your estimate above ({profile.country}, {profile.yearsPro} years, {profile.role}).</p>
      </form>
      <div aria-live="polite">
        {res ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="verdict">
            <span className="label">Result</span>
            <div className="verdict__big">{res.position === "within" ? "Inside the range" : res.position === "below" ? "Below the range" : "Above the range"}</div>
            <p className="muted" style={{ margin: 0 }}>Your pay is {pctText(res.errorPct)} compared with our estimate of {local(res.estimate.p50, country).text}. {res.position === "within" ? "That's what the range is for: 8 in 10 people should land inside it." : "About 1 in 5 people land outside their range, so this happens, but it's worth a look at what makes your situation different."}</p>
            {res.summary.n > 0 && <p className="small" style={{ margin: "8px 0 0" }}><b>{res.summary.n}</b> {res.summary.n === 1 ? "person has" : "people have"} checked so far. {res.summary.coverage != null && <>{Math.round(res.summary.coverage * 100)}% were inside their range.</>} Thank you!</p>}
          </motion.div>
        ) : (
          <div className="panel">
            <span className="label">Why this helps</span>
            <p style={{ margin: "8px 0 0" }}>The test set tells us how the model did on 2025 survey answers. Real people checking their pay today tells us how it holds up now. Your estimate right now: <b>{local(est.usd.p50, country).text}</b>.</p>
          </div>
        )}
      </div>
    </div>
  );
}
