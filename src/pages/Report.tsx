import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import type { Estimate, Profile } from "../../shared/predict";
import { Footer, Nav, Reveal, SectionHead, Spinner } from "../components/ui";
import { Curve, Drivers, RangeBar } from "../components/charts";
import { useFeatures, useMarket } from "../lib/meta";
import { api } from "../lib/api";
import { local, perYear, usdText } from "../lib/money";
import { setProfile } from "../lib/profile";

interface ReportData { id: string; profile: Profile; saved: Estimate["usd"]; estimate: Estimate | null; created: string; views: number }

export default function Report() {
  const { id = "" } = useParams();
  const [data, setData] = useState<ReportData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { data: features } = useFeatures();
  const { data: market } = useMarket();
  useEffect(() => { api<ReportData>(`/api/reports/${id}`).then(setData).catch((e) => setErr((e as Error).message)); }, [id]);
  const p = data?.profile;
  const country = p ? features?.countries.find((c) => c.name === p.country) || null : null;
  const median = p ? market?.countries.find((c) => c.name === p.country)?.p50 ?? null : null;
  const est = data?.estimate;
  const usd = est?.usd || data?.saved;
  const parts = usd ? local(usd.p50, country) : null;
  return (
    <>
      <Nav />
      <section className="section">
        <div className="wrap">
          {err && <div className="panel"><p className="err" style={{ margin: 0 }}>{err}</p><Link className="btn btn--sm" to="/" style={{ marginTop: 14 }}>Make your own estimate</Link></div>}
          {!data && !err && <Spinner />}
          {data && p && usd && parts && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="est" style={{ alignItems: "end" }}>
              <div>
                <span className="label">Shared salary estimate · {new Date(data.created).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · {data.views} view{data.views === 1 ? "" : "s"}</span>
                <h1 className="h2" style={{ marginTop: 14 }}>{p.role}, {p.yearsPro} year{p.yearsPro === 1 ? "" : "s"} of experience, {p.country}</h1>
                <p className="muted" style={{ marginTop: 14 }}>{p.education} · {p.orgSize} people · {p.remote} · {p.industry} · {p.employment}</p>
                <p className="small" style={{ marginTop: 8 }}>{p.skills.map((k) => features?.features.find((f) => f.key === k)?.label || k).join(" · ")}</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
                  <Link className="btn btn--red" to="/" onClick={() => setProfile(p)}>Open in the estimator <span className="arrow">→</span></Link>
                  <Link className="btn" to="/">Make your own</Link>
                </div>
              </div>
              <div className="result">
                <span className="label">Estimated total pay {perYear(country?.currency || "USD")}</span>
                <div className="hero-num">{parts.prefix && <span className="pre">{parts.prefix}</span>}{parts.number}{parts.suffix && <span className="suf">{parts.suffix.trim()}</span>}</div>
                <div className="result__sub"><span><b>{usdText(usd.p50)}</b> a year in US dollars</span></div>
                <p className="result__range">80% of developers like this earn between <b>{local(usd.p10, country).text}</b> and <b>{local(usd.p90, country).text}</b>.</p>
                <RangeBar usd={usd} country={country} medianUsd={median} />
              </div>
            </motion.div>
          )}
        </div>
      </section>
      {est && (
        <>
          <section className="section"><div className="wrap"><Reveal><SectionHead n="01" title="What moves this number" /><Drivers drivers={est.drivers} baselineUsd={est.baselineUsd} country={country} /></Reveal></div></section>
          <section className="section"><div className="wrap"><Reveal><SectionHead n="02" title="Over 30 years" /><Curve curve={est.curve} years={Math.min(30, p!.yearsPro)} country={country} /></Reveal></div></section>
        </>
      )}
      <Footer />
    </>
  );
}
