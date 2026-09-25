import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Footer, Nav, Reveal, SectionHead, Spinner } from "../components/ui";
import { Bars, RealityScatter } from "../components/charts";
import { useFeatures, useModelCard } from "../lib/meta";
import { api } from "../lib/api";
import { usdText } from "../lib/money";
import { useTween } from "../lib/tween";

interface RealitySummary { n: number; coverage: number | null; mdape: number | null; below: number; above: number; points: { p10: number; p50: number; p90: number; actual: number; country: string; years: number; role: string }[] }
interface Health { ai: boolean; model: { version: number; trained: string; trees: number; features: number }; stats: { estimates: number; reports: number; offers: number } | null }

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`;

export default function Model() {
  const { data: card, error } = useModelCard();
  const [reality, setReality] = useState<RealitySummary | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    api<RealitySummary>("/api/reality").then(setReality).catch(() => null);
    api<Health>("/api/health").then(setHealth).catch(() => null);
  }, []);
  const { data: features } = useFeatures();
  const countries = features?.countries.length || 59;
  const lgb = card?.results.LightGBM;
  const big = useTween(lgb ? lgb.mdape * 100 : 0, 1400);

  return (
    <>
      <Nav />
      <header className="hero">
        <div className="wrap" style={{ position: "relative" }}>
          <div className="hero__cols" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
          <div className="hero__grid">
            <div className="hero__title">
              <motion.h1 className="display" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.2, 0.7, 0.1, 1] }}>How good is it<span className="q">?</span></motion.h1>
            </div>
            <motion.div className="hero__side" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8 }}>
              <p className="lead" style={{ margin: 0 }}>Salary is noisy. Two developers with identical answers can earn very different amounts, so no honest model is 99% accurate. Here is exactly how this one does, on {card ? card.split.test.toLocaleString() : "2,600"} people it never saw while training.</p>
            </motion.div>
          </div>
        </div>
      </header>

      {error && <div className="wrap"><p className="err">{error}</p></div>}
      {!card || !lgb ? <div className="wrap" style={{ padding: 60 }}><Spinner /></div> : (
        <>
          <section className="section">
            <div className="wrap">
              <div className="grid2" style={{ alignItems: "end" }}>
                <div>
                  <span className="label">Typical error (median absolute percentage error)</span>
                  <div className="hero-num" style={{ margin: "12px 0 0" }}>±{big.toFixed(1)}<span className="suf">%</span></div>
                </div>
                <p className="lead" style={{ margin: 0 }}>For half of the test set, the estimate was within {pct(lgb.mdape)} of what the person really earns. That's the fair way to read a salary model: not "accuracy", but how far off it usually is, and how often the range holds.</p>
              </div>
              <div className="tiles" style={{ marginTop: 40 }}>
                <div><span className="label">Range coverage</span><b>{pct(card.range.coverage, 0)}</b><p>of real salaries fell inside the 80% range (target {pct(card.range.target, 0)})</p></div>
                <div><span className="label">Within ±25%</span><b>{pct(lgb.within_25, 0)}</b><p>of estimates were within a quarter of the real pay</p></div>
                <div><span className="label">R² (log pay)</span><b>{lgb.r2_log.toFixed(2)}</b><p>share of the variation in pay the model explains</p></div>
                <div><span className="label">India</span><b>±{card.india ? pct(card.india.mdape, 0) : "–"}</b><p>typical error on {card.india?.n} Indian developers; country median alone: ±{card.india ? pct(card.india.mdape_country_median, 0) : "–"}</p></div>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="wrap grid2">
              <Reveal>
                <div className="block">
                  <span className="label"><span className="index">01</span> &nbsp;Against simpler baselines</span>
                  <h3 className="h3">Typical error by model (lower is better)</h3>
                  <Bars items={Object.entries(card.results).map(([label, r]) => ({ label, value: r.mdape, note: `R² ${r.r2_log.toFixed(2)}` }))} format={(v) => `±${(v * 100).toFixed(1)}%`} highlight="LightGBM" unit="Typical error" />
                  <p className="small muted" style={{ margin: 0 }}>Knowing only the country already beats a global guess. A ridge regression on all answers gets close; gradient-boosted trees (LightGBM) do best and capture interactions, such as experience paying off differently in each country.</p>
                </div>
              </Reveal>
              <Reveal delay={100}>
                <div className="block">
                  <span className="label"><span className="index">02</span> &nbsp;A range you can trust</span>
                  <h3 className="h3">Calibrating the 80% range</h3>
                  <Bars items={[{ label: "Target", value: card.range.target }, { label: "Raw quantile models", value: card.range.coverage_raw }, { label: "After conformal step", value: card.range.coverage }]} format={(v) => pct(v)} highlight="After conformal step" unit="Coverage on the test set" />
                  <p className="small muted" style={{ margin: 0 }}>Two extra models predict the 10th and 90th percentiles. On their own they were too narrow ({pct(card.range.coverage_raw)} coverage). Conformalized quantile regression widens them using a separate calibration set of {card.split.calibration.toLocaleString()} people, and the test set confirms it now covers {pct(card.range.coverage)}.</p>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap grid2">
              <Reveal>
                <div className="block">
                  <span className="label"><span className="index">03</span> &nbsp;What the model relies on</span>
                  <h3 className="h3">Average impact on an estimate (mean |SHAP|, log pay)</h3>
                  <Bars items={card.importance.slice(0, 12).map((d) => ({ label: d.label, value: d.mean_abs_shap }))} format={(v) => v.toFixed(3)} unit="Mean |SHAP|" highlight="Country" />
                </div>
              </Reveal>
              <Reveal delay={100}>
                <div className="block">
                  <span className="label"><span className="index">04</span> &nbsp;From 49,191 answers to {card.funnel[card.funnel.length - 1].n.toLocaleString()}</span>
                  <h3 className="h3">Every cleaning step</h3>
                  <Bars items={card.funnel.map((f) => ({ label: f.step, value: f.n }))} format={(v) => v.toLocaleString()} unit="Responses" highlight={card.funnel[card.funnel.length - 1].step} />
                  <p className="small muted" style={{ margin: 0 }}>Outliers are removed within each country (Tukey's fences on log pay), which catches people who typed a monthly salary into the yearly box.</p>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <Reveal>
                <SectionHead n="05" title="By country">
                  Test-set error and range coverage for every country with at least 8 test cases. The model beats the country median almost everywhere, most of all where pay varies a lot.
                </SectionHead>
                <div style={{ overflowX: "auto" }}>
                  <table className="dtable">
                    <thead><tr><th>Country</th><th className="r">Test cases</th><th className="r">Typical error</th><th className="r">Country median only</th><th className="r">Range coverage</th></tr></thead>
                    <tbody>
                      {card.per_country.map((c) => (
                        <tr key={c.country} className={c.country === "India" ? "me" : ""}>
                          <td>{c.country}</td><td className="r">{c.n}</td><td className="r">±{pct(c.mdape, 0)}</td><td className="r">±{pct(c.mdape_country_median, 0)}</td><td className="r">{pct(c.coverage, 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <Reveal>
                <SectionHead n="06" title="Out in the real world">
                  Visitors can check an estimate against what they actually earn (anonymously). This is the live score, separate from the test set.
                </SectionHead>
                {!reality ? <Spinner /> : reality.n === 0 ? (
                  <div className="panel"><p style={{ margin: 0 }}>Nobody has checked yet. Be the first on the <a href="/#reality">estimate page</a>.</p></div>
                ) : (
                  <div className="grid2">
                    <div className="tiles" style={{ gridTemplateColumns: "1fr 1fr", alignSelf: "start" }}>
                      <div><span className="label">Checks</span><b>{reality.n}</b><p>people compared their pay</p></div>
                      <div><span className="label">Inside the range</span><b>{reality.coverage != null ? pct(reality.coverage, 0) : "–"}</b><p>target 80%</p></div>
                      <div><span className="label">Typical error</span><b>{reality.mdape != null ? `±${pct(reality.mdape, 0)}` : "–"}</b><p>test set: ±{pct(lgb.mdape, 0)}</p></div>
                      <div><span className="label">Above / below</span><b>{reality.above} / {reality.below}</b><p>outside the range</p></div>
                    </div>
                    {reality.points.length >= 2 ? <RealityScatter points={reality.points} /> : <p className="muted">The chart appears after a couple more checks.</p>}
                  </div>
                )}
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap grid2">
              <Reveal>
                <div className="block">
                  <span className="label"><span className="index">07</span> &nbsp;Method</span>
                  <ul className="list">
                    <li><b>Data.</b> Stack Overflow Developer Survey 2025: professional developers, employed or self-employed, who reported pay. Target: total yearly pay in US dollars, modelled on a log scale.</li>
                    <li><b>Features.</b> Country, years of experience, years coding, role, education, company size, IC or manager, work setup, industry, employment type, and {card.features.skills} technologies. Age and gender are deliberately left out.</li>
                    <li><b>Model.</b> LightGBM with native categorical splits and a monotone constraint, so more experience never lowers the estimate. Settings chosen by 5-fold cross-validation on the training set only ({card.params.num_leaves} leaves, {card.params.rounds} trees).</li>
                    <li><b>Split.</b> {card.split.train.toLocaleString()} training · {card.split.calibration.toLocaleString()} calibration · {card.split.test.toLocaleString()} test, stratified by country.</li>
                    <li><b>Explanations.</b> Exact TreeSHAP, re-implemented in TypeScript so the API can explain every estimate. It matches LightGBM's own values to within 0.00000001 on 300 test rows, checked in the test suite.</li>
                  </ul>
                </div>
              </Reveal>
              <Reveal delay={100}>
                <div className="block">
                  <span className="label"><span className="index">08</span> &nbsp;Limits</span>
                  <ul className="list">
                    <li>Survey respondents aren't a random sample. People who answer Stack Overflow surveys lean towards experienced developers and people working for foreign companies, especially in India.</li>
                    <li>Pay was reported in mid-2025 and converted at that time's exchange rates. It isn't adjusted for inflation since.</li>
                    <li>"Skills linked to higher pay" are correlations. The model can't tell whether a skill causes higher pay.</li>
                    <li>Countries with fewer than 30 clean responses were left out, so the model covers {countries} countries. Estimates are least certain where there's little data.</li>
                  </ul>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <Reveal>
                <SectionHead n="09" title="Use the API">
                  The same endpoint powers this site. No key needed; please be gentle.
                </SectionHead>
                <pre className="email" style={{ overflowX: "auto", fontSize: "0.82rem" }}>{`curl -X POST https://salarium-nishant.netlify.app/api/estimate \\
  -H "content-type: application/json" --data @- <<'EOF'
{ "country": "India", "yearsPro": 3, "role": "Back-end developer",
  "education": "Bachelor's degree", "orgSize": "1,000–4,999",
  "manager": "Individual contributor", "remote": "Hybrid, mostly office",
  "industry": "Software", "employment": "Employee",
  "skills": ["lang_java", "web_spring_boot", "plat_docker"] }
EOF`}</pre>
                <p className="small muted">Returns the 80% range in USD, SHAP drivers, the experience curve and skill what-ifs. {health ? <>Model v{health.model.version} ({health.model.trees.toLocaleString()} trees, {health.model.features} features){health.stats ? <> · {health.stats.estimates.toLocaleString()} visits estimated so far</> : null}.</> : null} Test-set MAE: {usdText(lgb.mae_usd)}.</p>
              </Reveal>
            </div>
          </section>
        </>
      )}
      <Footer />
    </>
  );
}
