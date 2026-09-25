import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Footer, Nav, Reveal, SectionHead, Select, Spinner, Tabs } from "../components/ui";
import { CountryDots, ExperienceColumns, Premiums } from "../components/charts";
import { useMarket, type Premium } from "../lib/meta";
import { setProfile, useProfile } from "../lib/profile";
import { local, pctText, usdCompact } from "../lib/money";

type Group = "all" | "lang" | "web" | "db" | "plat";
const SETUP_LABEL: Record<string, string> = { remote: "Work setup", org_size: "Company size", education: "Education", industry: "Industry", manager: "IC or manager" };

export default function Market() {
  const { data: market, error } = useMarket();
  const profile = useProfile();
  const [country, setCountry] = useState(profile.country);
  const [all, setAll] = useState(false);
  const [group, setGroup] = useState<Group>("all");
  const [setup, setSetup] = useState("remote");

  const c = market?.countries.find((x) => x.name === country) || null;
  const shown = useMemo(() => {
    if (!market) return [];
    if (all) return market.countries;
    const top = market.countries.slice(0, 20);
    return top.some((x) => x.name === country) ? top : [...top, ...market.countries.filter((x) => x.name === country)];
  }, [market, all, country]);
  const skills = useMemo(() => {
    if (!market) return { up: [] as Premium[], down: [] as Premium[] };
    const list = market.skills.filter((s) => group === "all" || s.group === group);
    return { up: list.slice(0, 12), down: list.slice(-8) };
  }, [market, group]);

  const pick = (name: string) => { setCountry(name); };
  const rank = market ? market.countries.findIndex((x) => x.name === country) + 1 : 0;

  return (
    <>
      <Nav />
      <header className="hero">
        <div className="wrap" style={{ position: "relative" }}>
          <div className="hero__cols" aria-hidden="true">{Array.from({ length: 12 }, (_, i) => <i key={i} />)}</div>
          <div className="hero__grid">
            <motion.h1 className="display hero__title" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: [0.2, 0.7, 0.1, 1] }}>The market<span className="q">.</span></motion.h1>
            <motion.div className="hero__side" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.8 }}>
              <p className="lead" style={{ margin: 0 }}>What {market ? market.n.toLocaleString() : "17,332"} developers in {market?.countries.length || 59} countries reported earning in 2025, before any modelling: medians by country and experience, and which skills, roles and setups go with higher pay.</p>
            </motion.div>
          </div>
        </div>
      </header>

      {error && <div className="wrap"><p className="err">{error}</p></div>}
      {!market ? <div className="wrap" style={{ padding: 60 }}><Spinner /></div> : (
        <>
          <section className="section">
            <div className="wrap">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "end", marginBottom: 36 }}>
                <div style={{ minWidth: 260 }}>
                  <span className="label">Country</span>
                  <div style={{ marginTop: 6 }}><Select label="Country" value={country} code={c?.code} options={[...market.countries].sort((a, b) => a.name.localeCompare(b.name)).map((x) => x.name)} onChange={pick} /></div>
                </div>
                {country !== profile.country && <button className="btn btn--sm" onClick={() => setProfile({ country })}>Use {country} for my estimate</button>}
              </div>
              {c && (
                <div className="tiles" style={{ marginBottom: 48 }}>
                  <div><span className="label">Median pay</span><b>{local(c.p50, c).text}</b><p>{usdCompact(c.p50)} · #{rank} of {market.countries.length} countries</p></div>
                  <div><span className="label">Middle half</span><b style={{ fontSize: "clamp(1.4rem, 2.6vw, 2.1rem)" }}>{local(c.p25, c).text} – {local(c.p75, c).text}</b><p>25th to 75th percentile</p></div>
                  <div><span className="label">Developers</span><b>{c.n.toLocaleString()}</b><p>median {c.years_median} years of experience</p></div>
                  <div><span className="label">Fully remote</span><b>{Math.round(c.remote_share * 100)}%</b><p>of developers in {c.name}</p></div>
                </div>
              )}
              <div className="grid2">
                <Reveal>
                  <div className="block">
                    <div className="block__head"><span className="label"><span className="index">01</span> &nbsp;Pay by country (USD)</span><button className="btn btn--ghost btn--sm" onClick={() => setAll((a) => !a)}>{all ? "Top 20" : `All ${market.countries.length}`}</button></div>
                    <p className="small muted" style={{ margin: 0 }}>Click a country to explore it. Dollars make countries comparable; living costs differ a lot.</p>
                    <CountryDots countries={shown} selected={country} onSelect={pick} />
                  </div>
                </Reveal>
                <Reveal delay={100}>
                  <div className="block" style={{ position: "sticky", top: 90 }}>
                    <div className="block__head"><span className="label"><span className="index">02</span> &nbsp;Pay by experience in {country}</span></div>
                    <p className="small muted" style={{ margin: 0 }}>Median yearly pay in {c?.currency}, by years of professional experience. Groups with fewer than 8 people are left out.</p>
                    {c && <ExperienceColumns country={c} />}
                  </div>
                </Reveal>
              </div>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <Reveal>
                <SectionHead n="03" title="Skills that go with higher pay">
                  Each bar compares developers who use a technology with those who don't, <b>in the same country and with the same experience</b>. The thin line is the 95% confidence interval. Associations, not causes.
                </SectionHead>
                <Tabs id="skillgroup" value={group} onChange={setGroup} options={[["all", "All"], ["lang", "Languages"], ["web", "Frameworks"], ["db", "Databases"], ["plat", "Cloud & tools"]]} />
                <div className="grid2">
                  <div className="block"><span className="label">Highest premiums</span><Premiums items={skills.up} /></div>
                  <div className="block"><span className="label">Lowest premiums</span><Premiums items={skills.down} /></div>
                </div>
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap grid2">
              <Reveal>
                <div className="block">
                  <span className="label"><span className="index">04</span> &nbsp;Roles</span>
                  <h3 className="h3">Pay by role, same country and experience</h3>
                  <Premiums items={market.roles} label="Role" />
                </div>
              </Reveal>
              <Reveal delay={100}>
                <div className="block">
                  <span className="label"><span className="index">05</span> &nbsp;How you work</span>
                  <h3 className="h3">{SETUP_LABEL[setup]}</h3>
                  <Tabs id="setup" value={setup} onChange={setSetup} options={Object.keys(market.setups).map((k) => [k, SETUP_LABEL[k] || k] as [string, string])} />
                  <Premiums items={market.setups[setup]} label={SETUP_LABEL[setup]} />
                </div>
              </Reveal>
            </div>
          </section>

          <section className="section">
            <div className="wrap">
              <p className="note">{market.note} Source: {market.source}, {market.n.toLocaleString()} professional developers after cleaning (see the <Link to="/model">model page</Link> for every step). Premium example: {market.skills[0]?.name} {pctText(market.skills[0]?.pct ?? 0)}.</p>
            </div>
          </section>
        </>
      )}
      <Footer />
    </>
  );
}
