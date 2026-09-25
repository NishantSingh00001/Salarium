// Hand-built SVG charts. Rules they follow: thin marks, 4px rounded data ends, hairline solid
// grids, direct labels used sparingly, a hover tooltip on every chart, and a table twin.
// Colours: ink for the data, red for "you", blue for "raises pay", red for "lowers pay".

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import type { Driver, Estimate } from "../../shared/predict";
import type { CountryInfo, MarketCountry, Premium } from "../lib/meta";
import { local, pctText, usdCompact } from "../lib/money";
import { TableToggle } from "./ui";

// ---------------------------------------------------------------- helpers

export function useWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w];
}

interface TipState { x: number; y: number; content: ReactNode }
function useTip() {
  const [tip, setTip] = useState<TipState | null>(null);
  const el = tip ? <div className="tip" style={{ left: tip.x, top: tip.y }} role="presentation">{tip.content}</div> : null;
  return { tip: el, show: (x: number, y: number, content: ReactNode) => setTip({ x, y, content }), hide: () => setTip(null) };
}

/** Horizontal bar path with a 4px rounded data end and a square end at the baseline.
 *  Always the same commands (even for zero length), so animations can interpolate it. */
function hbar(x0: number, x1: number, y: number, h: number, r = 4): string {
  const len = Math.abs(x1 - x0);
  const rr = Math.min(r, len, h / 2);
  const s = x1 >= x0 ? 1 : -1;
  const f = (v: number) => v.toFixed(2);
  return `M${f(x0)},${f(y)} H${f(x1 - s * rr)} Q${f(x1)},${f(y)} ${f(x1)},${f(y + rr)} V${f(y + h - rr)} Q${f(x1)},${f(y + h)} ${f(x1 - s * rr)},${f(y + h)} H${f(x0)} Z`;
}

/** Vertical column path, rounded at the top (same command structure at any height). */
function vbar(x: number, w: number, y0: number, y1: number, r = 4): string {
  const h = Math.max(0, y0 - y1);
  const rr = Math.min(r, h, w / 2);
  const f = (v: number) => v.toFixed(2);
  return `M${f(x)},${f(y0)} V${f(y1 + rr)} Q${f(x)},${f(y1)} ${f(x + rr)},${f(y1)} H${f(x + w - rr)} Q${f(x + w)},${f(y1)} ${f(x + w)},${f(y1 + rr)} V${f(y0)} Z`;
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const out: number[] = [];
  for (let v = 0; v < max + step - 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out; // the last tick is always >= max, so the data never pokes above the grid
}

const spring = { type: "spring", stiffness: 170, damping: 26 } as const;
// Path shapes ("d") animate with a tween: springs on path strings can overshoot into invalid values.
const pathT = { duration: 0.55, ease: [0.2, 0.7, 0.1, 1] } as const;

/** Pointer x inside the chart's SVG (viewBox units equal CSS pixels here). */
function svgX(e: React.MouseEvent<SVGElement>): number {
  const el = e.currentTarget as SVGGraphicsElement;
  const svg = el.ownerSVGElement || (el as unknown as SVGSVGElement);
  return e.clientX - svg.getBoundingClientRect().left;
}

// ---------------------------------------------------------------- range bar

export function RangeBar({ usd, country, medianUsd, offerUsd, compact }: { usd: Estimate["usd"]; country: CountryInfo | null; medianUsd?: number | null; offerUsd?: number | null; compact?: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  const { tip, show, hide } = useTip();
  const vals = [usd.p10, usd.p90, medianUsd || usd.p50, offerUsd || usd.p50];
  const lo = Math.min(...vals) / 1.35;
  const hi = Math.max(...vals) * 1.25;
  const L = 8, R = w - 8;
  const x = (v: number) => L + ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (R - L);
  const H = compact ? 84 : 104;
  const bandY = 40, bandH = 14;
  const fmt = (v: number) => local(v, country).text;
  const px = (v: number) => Math.max(L + 30, Math.min(R - 30, x(v)));
  return (
    <div className="rangebar chart" ref={ref} onMouseLeave={hide}>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label={`80% range ${fmt(usd.p10)} to ${fmt(usd.p90)}, estimate ${fmt(usd.p50)}`}>
        <line x1={L} x2={R} y1={bandY + bandH / 2} y2={bandY + bandH / 2} stroke="var(--rule-2)" strokeWidth="1" />
        <motion.rect y={bandY} height={bandH} fill="var(--ink)" fillOpacity="0.1" initial={false} animate={{ x: x(usd.p10), width: Math.max(2, x(usd.p90) - x(usd.p10)) }} transition={spring}
          onMouseMove={(e) => show(svgX(e), bandY - 6, <><b>{fmt(usd.p10)} – {fmt(usd.p90)}</b><span>80% of developers like you</span></>)} />
        <motion.line y1={bandY - 4} y2={bandY + bandH + 4} stroke="var(--ink)" strokeWidth="1.5" initial={false} animate={{ x1: x(usd.p10), x2: x(usd.p10) }} transition={spring} />
        <motion.line y1={bandY - 4} y2={bandY + bandH + 4} stroke="var(--ink)" strokeWidth="1.5" initial={false} animate={{ x1: x(usd.p90), x2: x(usd.p90) }} transition={spring} />
        {/* p10 / p90 labels */}
        <motion.text y={bandY + bandH + 22} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink-2)" initial={false} animate={{ x: px(usd.p10) }} transition={spring}>{fmt(usd.p10)}</motion.text>
        <motion.text y={bandY + bandH + 22} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink-2)" initial={false} animate={{ x: px(usd.p90) }} transition={spring}>{fmt(usd.p90)}</motion.text>
        {/* country median */}
        {medianUsd ? (
          <motion.g initial={false} animate={{ x: x(medianUsd) }} transition={spring}
            onMouseMove={() => show(x(medianUsd), bandY - 6, <><b>{fmt(medianUsd)}</b><span>Median for all developers in {country?.name}</span></>)}>
            <rect x={-12} y={bandY - 2} width={24} height={bandH + 26} fill="transparent" />
            <path d={`M0,${bandY + bandH + 2} l5,7 h-10 z`} fill="var(--ink)" />
            {!compact && <text y={bandY + bandH + 38} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{country?.name} median</text>}
          </motion.g>
        ) : null}
        {/* the estimate */}
        <motion.g initial={false} animate={{ x: x(usd.p50) }} transition={spring}
          onMouseMove={() => show(x(usd.p50), bandY - 6, <><b>{fmt(usd.p50)}</b><span>Your estimate (the model's middle)</span></>)}>
          <rect x={-14} y={0} width={28} height={bandY + bandH + 6} fill="transparent" />
          <line y1={18} y2={bandY + bandH + 4} stroke="var(--red)" strokeWidth="2" />
          <rect x={-7} y={bandY} width={14} height={bandH} fill="var(--red)" stroke="#fff" strokeWidth="2" />
          <text y={12} textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--ink)">{fmt(usd.p50)}</text>
        </motion.g>
        {offerUsd ? (
          <motion.g initial={false} animate={{ x: x(offerUsd) }} transition={spring}
            onMouseMove={() => show(x(offerUsd), bandY - 6, <><b>{fmt(offerUsd)}</b><span>This offer, like for like</span></>)}>
            <rect x={-14} y={bandY - 12} width={28} height={bandH + 40} fill="transparent" />
            <path d={`M0,${bandY - 3} l10,10 -10,10 -10,-10 z`} fill="var(--blue)" stroke="#fff" strokeWidth="2" />
            <text y={bandY + bandH + 38} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--blue)">Offer</text>
          </motion.g>
        ) : null}
      </svg>
      {tip}
    </div>
  );
}

// ---------------------------------------------------------------- SHAP drivers

export function Drivers({ drivers, baselineUsd, country, max = 9 }: { drivers: Driver[]; baselineUsd: number; country: CountryInfo | null; max?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>(720);
  const { tip, show, hide } = useTip();
  const top = drivers.slice(0, max);
  const rest = drivers.slice(max);
  const restPhi = rest.reduce((s, d) => s + d.phi, 0);
  const rows: Driver[] = rest.length ? [...top, { key: "rest", label: "Everything else", value: `${rest.length} smaller factors`, phi: restPhi, pct: Math.exp(restPhi) - 1, kind: "skills-absent" }] : top;
  const narrow = w < 560;
  const labelW = narrow ? 0 : Math.min(260, w * 0.36);
  const rowH = narrow ? 58 : 40;
  const barTop = narrow ? 30 : 13;
  const barH = 14;
  const plotL = labelW + 10, plotR = w - 4;
  const mid = plotL + (plotR - plotL) / 2;
  const maxAbs = Math.max(0.05, ...rows.map((r) => Math.abs(r.phi)));
  const half = (plotR - plotL) / 2 - 46;
  const H = rows.length * rowH + 30;
  const tipText = (d: Driver) => d.key === "rest" ? `${rest.length} smaller factors together` : d.kind === "skills-absent" ? `Not using the ${d.value.split(" ")[0]} other skills in the model` : `${d.label}: ${d.value}`;
  return (
    <div className="chart" ref={ref} onMouseLeave={hide}>
      <div className="legend">
        <span><i style={{ background: "var(--blue)" }} />Raises your pay</span>
        <span><i style={{ background: "var(--red)" }} />Lowers your pay</span>
        <span className="dim">Compared with the average developer in the data ({usdCompact(baselineUsd)} a year)</span>
      </div>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label="What raises and lowers your estimate">
        <line className="baseline" x1={mid} x2={mid} y1={0} y2={H - 26} />
        {rows.map((d, i) => {
          const y = i * rowH;
          const len = (Math.abs(d.phi) / maxAbs) * half;
          const x1 = d.phi >= 0 ? mid + len : mid - len;
          const pos = d.phi >= 0;
          const lx = pos ? x1 + 6 : x1 - 6;
          return (
            <g key={d.key} className="row" tabIndex={0}
              onMouseMove={() => show(pos ? x1 : x1, y + barTop - 4, <><b>{pctText(d.pct)}</b><span>{tipText(d)}</span></>)}
              onFocus={() => show(x1, y + barTop - 4, <><b>{pctText(d.pct)}</b><span>{tipText(d)}</span></>)} onBlur={hide}>
              <rect className="row-hover" x={0} y={y} width={w} height={rowH - 2} />
              {narrow ? (
                <text x={4} y={y + 18} fontSize="13" fill="var(--ink)" fontWeight="700">{d.label} <tspan fontWeight="500" fill="var(--ink-3)">· {d.value}</tspan></text>
              ) : (
                <>
                  <text x={4} y={y + 18} fontSize="13" fill="var(--ink)" fontWeight="700">{d.label}</text>
                  <text x={4} y={y + 33} fontSize="11.5" fill="var(--ink-3)">{d.value.length > 38 ? d.value.slice(0, 37) + "…" : d.value}</text>
                </>
              )}
              <motion.path fill={pos ? "var(--blue)" : "var(--red)"} initial={false} animate={{ d: hbar(mid, x1, y + barTop, barH) }} transition={pathT} />
              <motion.text y={y + barTop + 11} fontSize="12.5" fontWeight="800" fill="var(--ink)" textAnchor={pos ? "start" : "end"} initial={false} animate={{ x: lx }} transition={spring}>{pctText(d.pct)}</motion.text>
            </g>
          );
        })}
        <text x={mid} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">average developer</text>
      </svg>
      {tip}
      <TableToggle>
        <table className="dtable">
          <thead><tr><th>Factor</th><th>Your answer</th><th className="r">Effect on pay</th></tr></thead>
          <tbody>{rows.map((d) => <tr key={d.key}><td>{d.label}</td><td>{d.value}</td><td className="r">{pctText(d.pct, 1)}</td></tr>)}</tbody>
        </table>
        <p className="xs dim">Effects multiply: start from {usdCompact(baselineUsd)} and apply each one to reach your estimate{country ? ` (shown in ${country.currency} above)` : ""}.</p>
      </TableToggle>
    </div>
  );
}

// ---------------------------------------------------------------- experience curve

export function Curve({ curve, years, country }: { curve: Estimate["curve"]; years: number; country: CountryInfo | null }) {
  const [ref, w] = useWidth<HTMLDivElement>(720);
  const { tip, show, hide } = useTip();
  const H = w < 560 ? 260 : 320;
  const M = { l: 58, r: 16, t: 16, b: 34 };
  const rate = country?.rate || 1;
  const maxLocal = Math.max(...curve.map((c) => c.p90)) * rate;
  const ticks = niceTicks(maxLocal * 1.02, 4);
  const top = ticks[ticks.length - 1];
  const x = (y: number) => M.l + (y / 30) * (w - M.l - M.r);
  const y = (usd: number) => H - M.b - ((usd * rate) / top) * (H - M.t - M.b);
  const line = curve.map((c, i) => `${i ? "L" : "M"}${x(c.years).toFixed(1)},${y(c.p50).toFixed(1)}`).join(" ");
  const band = `${curve.map((c, i) => `${i ? "L" : "M"}${x(c.years).toFixed(1)},${y(c.p90).toFixed(1)}`).join(" ")} ${[...curve].reverse().map((c) => `L${x(c.years).toFixed(1)},${y(c.p10).toFixed(1)}`).join(" ")} Z`;
  const [hover, setHover] = useState<number | null>(null);
  const cur = curve[Math.min(30, Math.max(0, years))];
  const fmt = (v: number) => local(v, country).text;
  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const px = svgX(e);
    const yr = Math.round(((px - M.l) / (w - M.l - M.r)) * 30);
    const c = curve[Math.min(30, Math.max(0, yr))];
    setHover(c.years);
    show(x(c.years), y(c.p90) - 4, <><b>{fmt(c.p50)}</b><span className="k"><i className="red" />{c.years} year{c.years === 1 ? "" : "s"} of experience</span><span className="k"><i className="band" />{fmt(c.p10)} – {fmt(c.p90)}</span></>);
  };
  const tickText = (v: number) => (country ? local(v / rate, country).text : usdCompact(v));
  return (
    <div className="chart" ref={ref} onMouseLeave={() => { hide(); setHover(null); }}>
      <div className="legend">
        <span><i className="line" style={{ background: "var(--ink)" }} />Estimate</span>
        <span><i style={{ background: "var(--band)" }} />80% range</span>
        <span><i style={{ background: "var(--red)", width: 10, height: 10 }} />You today</span>
      </div>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label={`Estimated pay from 0 to 30 years of experience. At ${years} years: ${fmt(cur.p50)}.`}>
        <g className="grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={w - M.r} y1={H - M.b - (t / top) * (H - M.t - M.b)} y2={H - M.b - (t / top) * (H - M.t - M.b)} />
              <text x={M.l - 8} y={H - M.b - (t / top) * (H - M.t - M.b) + 4} textAnchor="end" className="num">{tickText(t)}</text>
            </g>
          ))}
        </g>
        {[0, 5, 10, 15, 20, 25, 30].map((t) => <text key={t} x={x(t)} y={H - M.b + 20} textAnchor="middle" className="num">{t}{t === 30 ? " yrs" : ""}</text>)}
        <motion.path fill="var(--ink)" fillOpacity="0.07" initial={false} animate={{ d: band }} transition={pathT} />
        <motion.path fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" initial={false} animate={{ d: line }} transition={pathT} />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={H - M.b} stroke="var(--ink)" strokeWidth="1" />}
        <motion.circle r="6" fill="var(--red)" stroke="#fff" strokeWidth="2" initial={false} animate={{ cx: x(cur.years), cy: y(cur.p50) }} transition={spring} />
        <motion.text fontSize="12" fontWeight="800" fill="var(--ink)" textAnchor={cur.years > 24 ? "end" : "start"} initial={false} animate={{ x: x(cur.years) + (cur.years > 24 ? -12 : 12), y: y(cur.p50) - 10 }} transition={spring}>{fmt(cur.p50)} now</motion.text>
        <text x={w - M.r} y={y(curve[30].p50) - 10} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--ink-2)">{fmt(curve[30].p50)} at 30 yrs</text>
        <rect className="hit" x={M.l} y={M.t} width={w - M.l - M.r} height={H - M.t - M.b} onMouseMove={onMove} />
      </svg>
      {tip}
      <TableToggle>
        <table className="dtable">
          <thead><tr><th>Years</th><th className="r">Low (10%)</th><th className="r">Estimate</th><th className="r">High (90%)</th></tr></thead>
          <tbody>{curve.filter((c) => c.years % 2 === 0 || c.years === years).map((c) => <tr key={c.years} className={c.years === years ? "me" : ""}><td>{c.years}</td><td className="r">{fmt(c.p10)}</td><td className="r">{fmt(c.p50)}</td><td className="r">{fmt(c.p90)}</td></tr>)}</tbody>
        </table>
      </TableToggle>
    </div>
  );
}

// ---------------------------------------------------------------- market: countries

export function CountryDots({ countries, selected, onSelect }: { countries: MarketCountry[]; selected: string; onSelect: (c: string) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>(900);
  const { tip, show, hide } = useTip();
  const narrow = w < 560;
  const labelW = narrow ? 110 : 170;
  const rowH = 24;
  const M = { t: 22, b: 8 };
  const max = Math.max(...countries.map((c) => c.p75));
  const ticks = niceTicks(max, narrow ? 3 : 5);
  const top = ticks[ticks.length - 1];
  const x = (v: number) => labelW + (v / top) * (w - labelW - 70);
  const H = M.t + countries.length * rowH + M.b;
  return (
    <div className="chart" ref={ref} onMouseLeave={hide}>
      <div className="legend">
        <span><i className="line" style={{ background: "var(--ink)", opacity: 0.35 }} />Middle half (25th–75th percentile)</span>
        <span><i style={{ background: "var(--ink)", width: 9, height: 9, borderRadius: 9 }} />Median</span>
        <span><i style={{ background: "var(--red)", width: 9, height: 9, borderRadius: 9 }} />{selected}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label="Median developer pay by country, in US dollars">
        <g className="grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={M.t - 4} y2={H - M.b} />
              <text x={x(t)} y={12} textAnchor="middle" className="num">{usdCompact(t)}</text>
            </g>
          ))}
        </g>
        {countries.map((c, i) => {
          const y = M.t + i * rowH + rowH / 2;
          const me = c.name === selected;
          const content = <><b>{usdCompact(c.p50)}</b><span>{c.name} · median of {c.n.toLocaleString()} developers</span><span className="k"><i className="band" />{usdCompact(c.p25)} – {usdCompact(c.p75)} middle half</span></>;
          return (
            <g key={c.name} className="row" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => onSelect(c.name)}
              onMouseMove={() => show(x(c.p50), y - 10, content)} onFocus={() => show(x(c.p50), y - 10, content)} onBlur={hide}
              onKeyDown={(e) => { if (e.key === "Enter") onSelect(c.name); }}>
              <rect className="row-hover" x={0} y={y - rowH / 2} width={w} height={rowH} />
              <text x={labelW - 12} y={y + 4} textAnchor="end" fontSize="12.5" fontWeight={me ? 800 : 500} fill={me ? "var(--ink)" : "var(--ink-2)"}>{narrow && c.name.length > 14 ? c.name.slice(0, 13) + "…" : c.name}</text>
              <line x1={x(c.p25)} x2={x(c.p75)} y1={y} y2={y} stroke={me ? "var(--red)" : "var(--ink)"} strokeOpacity={me ? 0.5 : 0.28} strokeWidth="2" strokeLinecap="round" />
              <circle cx={x(c.p50)} cy={y} r={me ? 6 : 4.5} fill={me ? "var(--red)" : "var(--ink)"} stroke="#fff" strokeWidth="2" />
              <text x={x(c.p75) + 8} y={y + 4} fontSize="11.5" fontWeight={me ? 800 : 500} fill={me ? "var(--ink)" : "var(--ink-3)"} className="num">{usdCompact(c.p50)}</text>
            </g>
          );
        })}
      </svg>
      {tip}
      <TableToggle>
        <table className="dtable">
          <thead><tr><th>Country</th><th className="r">Developers</th><th className="r">25th</th><th className="r">Median</th><th className="r">75th</th><th>Currency</th></tr></thead>
          <tbody>{countries.map((c) => <tr key={c.name} className={c.name === selected ? "me" : ""}><td>{c.name}</td><td className="r">{c.n.toLocaleString()}</td><td className="r">{usdCompact(c.p25)}</td><td className="r">{usdCompact(c.p50)}</td><td className="r">{usdCompact(c.p75)}</td><td>{c.currency}</td></tr>)}</tbody>
        </table>
      </TableToggle>
    </div>
  );
}

// ---------------------------------------------------------------- market: experience columns

export function ExperienceColumns({ country }: { country: MarketCountry }) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  const { tip, show, hide } = useTip();
  const H = 280;
  const M = { l: 10, r: 10, t: 30, b: 44 };
  const bins = country.curve;
  const max = Math.max(...bins.map((b) => b.median || 0));
  const slot = (w - M.l - M.r) / bins.length;
  const bw = Math.min(24, slot * 0.5);
  const y = (v: number) => H - M.b - (v / (max * 1.12)) * (H - M.t - M.b);
  const fmt = (v: number) => local(v, country).text;
  return (
    <div className="chart" ref={ref} onMouseLeave={hide}>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label={`Median pay by years of experience in ${country.name}`}>
        <line className="baseline" x1={M.l} x2={w - M.r} y1={H - M.b} y2={H - M.b} />
        {bins.map((b, i) => {
          const cx = M.l + slot * i + slot / 2;
          const content = b.median ? <><b>{fmt(b.median)}</b><span>{b.label} years · {b.n} developers</span></> : <><b>Not enough data</b><span>{b.label} years · {b.n} developers</span></>;
          return (
            <g key={b.label} className="row" tabIndex={0} onMouseMove={() => show(cx, b.median ? y(b.median) - 6 : H - M.b - 20, content)} onFocus={() => show(cx, b.median ? y(b.median) - 6 : H - M.b - 20, content)} onBlur={hide}>
              <rect className="row-hover" x={cx - slot / 2 + 2} y={M.t - 20} width={slot - 4} height={H - M.t - M.b + 20} />
              {b.median ? (
                <>
                  <motion.path fill="var(--ink)" initial={false} animate={{ d: vbar(cx - bw / 2, bw, H - M.b, y(b.median)) }} transition={pathT} />
                  <text x={cx} y={y(b.median) - 8} textAnchor="middle" fontSize="12" fontWeight="800" fill="var(--ink)">{fmt(b.median)}</text>
                </>
              ) : <text x={cx} y={H - M.b - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">n/a</text>}
              <text x={cx} y={H - M.b + 18} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--ink-2)">{b.label}</text>
              <text x={cx} y={H - M.b + 33} textAnchor="middle" fontSize="10.5" fill="var(--ink-3)">n={b.n}</text>
            </g>
          );
        })}
      </svg>
      {tip}
      <TableToggle>
        <table className="dtable">
          <thead><tr><th>Years of experience</th><th className="r">Developers</th><th className="r">Median pay</th></tr></thead>
          <tbody>{bins.map((b) => <tr key={b.label}><td>{b.label}</td><td className="r">{b.n}</td><td className="r">{b.median ? fmt(b.median) : "not enough data"}</td></tr>)}</tbody>
        </table>
      </TableToggle>
    </div>
  );
}

// ---------------------------------------------------------------- premiums (diverging with 95% CI)

export function Premiums({ items, label = "Technology" }: { items: Premium[]; label?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  const { tip, show, hide } = useTip();
  const narrow = w < 480;
  const labelW = narrow ? 118 : 170;
  const rowH = 26;
  const H = items.length * rowH + 24;
  // Asymmetric domain that always includes zero, so an all-negative list uses the full width.
  const dmin = Math.min(0, ...items.map((d) => d.lo)) * 1.05;
  const dmax = Math.max(0, ...items.map((d) => d.hi)) * 1.05 || 0.01;
  const plotL = labelW, plotR = w - 58;
  const x = (v: number) => plotL + ((v - dmin) / (dmax - dmin || 1)) * (plotR - plotL);
  const zero = x(0);
  return (
    <div className="chart" ref={ref} onMouseLeave={hide}>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label={`${label} pay premiums`}>
        <line className="baseline" x1={zero} x2={zero} y1={0} y2={H - 20} />
        {items.map((d, i) => {
          const y = i * rowH + 4;
          const pos = d.pct >= 0;
          const content = <><b>{pctText(d.pct, 1)}</b><span>{d.name} · {d.n.toLocaleString()} developers</span><span className="k"><i className="band" />95% interval {pctText(d.lo, 0)} to {pctText(d.hi, 0)}</span></>;
          return (
            <g key={d.name} className="row" tabIndex={0} onMouseMove={() => show(x(d.pct), y, content)} onFocus={() => show(x(d.pct), y, content)} onBlur={hide}>
              <rect className="row-hover" x={0} y={y - 2} width={w} height={rowH} />
              <text x={labelW - 10} y={y + 14} textAnchor="end" fontSize="12.5" fontWeight="600" fill="var(--ink)">{narrow && d.name.length > 15 ? d.name.slice(0, 14) + "…" : d.name}</text>
              <motion.path fill={pos ? "var(--blue)" : "var(--red)"} initial={false} animate={{ d: hbar(zero, x(d.pct), y + 3, 14) }} transition={pathT} />
              <line x1={x(d.lo)} x2={x(d.hi)} y1={y + 10} y2={y + 10} stroke="var(--ink)" strokeWidth="1" />
              <text x={w - 2} y={y + 14} textAnchor="end" fontSize="12" fontWeight="800" fill="var(--ink)" className="num">{pctText(d.pct)}</text>
            </g>
          );
        })}
        <text x={zero} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--ink-3)">same country and experience</text>
      </svg>
      {tip}
      <TableToggle>
        <table className="dtable">
          <thead><tr><th>{label}</th><th className="r">Developers</th><th className="r">Premium</th><th className="r">95% interval</th></tr></thead>
          <tbody>{items.map((d) => <tr key={d.name}><td>{d.name}</td><td className="r">{d.n.toLocaleString()}</td><td className="r">{pctText(d.pct, 1)}</td><td className="r">{pctText(d.lo, 0)} to {pctText(d.hi, 0)}</td></tr>)}</tbody>
        </table>
      </TableToggle>
    </div>
  );
}

// ---------------------------------------------------------------- simple horizontal bars

export function Bars({ items, format, highlight, unit }: { items: { label: string; value: number; note?: string }[]; format: (v: number) => string; highlight?: string; unit?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  const { tip, show, hide } = useTip();
  const narrow = w < 480;
  const labelW = narrow ? 120 : 190;
  const rowH = 32;
  const H = items.length * rowH + 4;
  const max = Math.max(...items.map((d) => d.value));
  const x = (v: number) => labelW + (v / max) * (w - labelW - 64);
  return (
    <div className="chart" ref={ref} onMouseLeave={hide}>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label={unit || "Bar chart"}>
        <line className="baseline" x1={labelW} x2={labelW} y1={0} y2={H} />
        {items.map((d, i) => {
          const y = i * rowH + 7;
          const me = d.label === highlight;
          const content = <><b>{format(d.value)}</b><span>{d.label}{d.note ? ` · ${d.note}` : ""}</span></>;
          return (
            <g key={d.label} className="row" tabIndex={0} onMouseMove={() => show(x(d.value), y - 2, content)} onFocus={() => show(x(d.value), y - 2, content)} onBlur={hide}>
              <rect className="row-hover" x={0} y={y - 6} width={w} height={rowH} />
              <text x={labelW - 10} y={y + 13} textAnchor="end" fontSize="12.5" fontWeight={me ? 800 : 600} fill="var(--ink)">{narrow && d.label.length > 16 ? d.label.slice(0, 15) + "…" : d.label}</text>
              <motion.path d={hbar(labelW, x(d.value), y, 18)} fill={me ? "var(--red)" : "var(--ink)"} style={{ originX: 0, transformBox: "fill-box" }} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 0.8, ease: [0.2, 0.7, 0.1, 1], delay: i * 0.04 }} />
              <text x={x(d.value) + 8} y={y + 13} fontSize="12" fontWeight="800" fill="var(--ink)" className="num">{format(d.value)}</text>
            </g>
          );
        })}
      </svg>
      {tip}
      <TableToggle>
        <table className="dtable">
          <thead><tr><th>{unit ? "Item" : ""}</th><th className="r">{unit || "Value"}</th></tr></thead>
          <tbody>{items.map((d) => <tr key={d.label} className={d.label === highlight ? "me" : ""}><td>{d.label}</td><td className="r">{format(d.value)}</td></tr>)}</tbody>
        </table>
      </TableToggle>
    </div>
  );
}

// ---------------------------------------------------------------- real-world check: predicted vs actual

export function RealityScatter({ points }: { points: { p10: number; p50: number; p90: number; actual: number; country: string; years: number; role: string }[] }) {
  const [ref, w] = useWidth<HTMLDivElement>(560);
  const { tip, show, hide } = useTip();
  const H = Math.min(420, Math.max(280, w * 0.62));
  const M = { l: 56, r: 14, t: 12, b: 38 };
  const all = points.flatMap((p) => [p.p50, p.actual]);
  const lo = Math.min(...all) / 1.3, hi = Math.max(...all) * 1.3;
  const s = (v: number, a: number, b: number) => a + ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (b - a);
  const x = (v: number) => s(v, M.l, w - M.r);
  const y = (v: number) => s(v, H - M.b, M.t);
  const ticks = [1e3, 3e3, 1e4, 3e4, 1e5, 3e5, 1e6].filter((t) => t >= lo && t <= hi);
  return (
    <div className="chart" ref={ref} onMouseLeave={hide}>
      <div className="legend">
        <span><i style={{ background: "var(--ink)", width: 9, height: 9, borderRadius: 9 }} />Inside the 80% range</span>
        <span><i style={{ background: "var(--red)", width: 9, height: 9, borderRadius: 9 }} />Outside it</span>
        <span className="dim">Diagonal = perfect estimate</span>
      </div>
      <svg viewBox={`0 0 ${w} ${H}`} height={H} role="img" aria-label="Estimated versus actual pay shared by visitors">
        <g className="grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={w - M.r} y1={y(t)} y2={y(t)} />
              <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="num">{usdCompact(t)}</text>
              <text x={x(t)} y={H - M.b + 18} textAnchor="middle" className="num">{usdCompact(t)}</text>
            </g>
          ))}
        </g>
        <line x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} stroke="var(--ink)" strokeWidth="1" />
        <text x={(M.l + w - M.r) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--ink-3)">Estimate (USD, log scale)</text>
        {points.map((p, i) => {
          const inside = p.actual >= p.p10 && p.actual <= p.p90;
          const content = <><b>{usdCompact(p.actual)} actual</b><span>Estimate {usdCompact(p.p50)} ({usdCompact(p.p10)}–{usdCompact(p.p90)})</span><span>{p.country} · {p.years} yrs · {p.role}</span></>;
          return (
            <g key={i} onMouseMove={() => show(x(p.p50), y(p.actual) - 8, content)}>
              <line x1={x(p.p50)} x2={x(p.p50)} y1={y(p.p10)} y2={y(p.p90)} stroke="var(--ink)" strokeOpacity="0.15" strokeWidth="2" />
              <circle cx={x(p.p50)} cy={y(p.actual)} r="12" fill="transparent" />
              <circle cx={x(p.p50)} cy={y(p.actual)} r="4.5" fill={inside ? "var(--ink)" : "var(--red)"} stroke="#fff" strokeWidth="2" />
            </g>
          );
        })}
      </svg>
      {tip}
      <TableToggle>
        <table className="dtable">
          <thead><tr><th>Country</th><th className="r">Years</th><th className="r">Estimate</th><th className="r">Range</th><th className="r">Actual</th></tr></thead>
          <tbody>{points.map((p, i) => <tr key={i}><td>{p.country}</td><td className="r">{p.years}</td><td className="r">{usdCompact(p.p50)}</td><td className="r">{usdCompact(p.p10)}–{usdCompact(p.p90)}</td><td className="r">{usdCompact(p.actual)}</td></tr>)}</tbody>
        </table>
      </TableToggle>
    </div>
  );
}
