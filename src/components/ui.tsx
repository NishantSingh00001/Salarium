import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { NavLink, Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";

// ---------------------------------------------------------------- navigation

export function Nav() {
  const links: [string, string][] = [["/", "Estimate"], ["/market", "Market"], ["/model", "Model"], ["/offer", "Offer check"]];
  return (
    <header className="nav">
      <div className="wrap">
        <Link to="/" className="brand" aria-label="Salarium home"><span className="brand__mark" aria-hidden="true" /><span>Salarium</span></Link>
        <nav className="nav__links" aria-label="Main">
          {links.map(([to, label], i) => (
            <NavLink key={to} to={to} end={to === "/"} data-n={`0${i + 1}`} className={({ isActive }) => (isActive ? "active" : "")}>{label}</NavLink>
          ))}
        </nav>
        <span className="nav__data">Stack Overflow survey 2025 · 17,332 salaries</span>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer__grid">
          <div>
            <p style={{ margin: "0 0 8px", color: "var(--ink)", fontWeight: 700 }}>Salarium estimates what software developers earn, with an honest range and the reasons behind every number.</p>
            <p style={{ margin: 0 }}>Built by <a href="https://nishant-singhaa0240274.netlify.app" target="_blank" rel="noreferrer">Nishant Singh</a> · <a href="https://github.com/NishantSingh00001/salarium" target="_blank" rel="noreferrer">Source on GitHub</a></p>
          </div>
          <div>
            Data: <a href="https://survey.stackoverflow.co/2025" target="_blank" rel="noreferrer">Stack Overflow Developer Survey 2025</a>, used under the Open Database License. Pay was reported in mid-2025; local currencies use the exchange rates from the survey.
          </div>
          <div>
            <Link to="/model">How the model works</Link><br />
            <Link to="/market">Market data</Link><br />
            <Link to="/offer">Check an offer</Link>
          </div>
        </div>
        <div className="footer__big" aria-hidden="true">Salarium<span>.</span></div>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------- toasts

type Toast = { id: number; text: string; kind: "ok" | "error" };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string, kind: Toast["kind"] = "ok") {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, kind }];
  toastListeners.forEach((l) => l());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); toastListeners.forEach((l) => l()); }, 3200);
}
export function Toasts() {
  const list = useSyncExternalStore((cb) => { toastListeners.add(cb); return () => toastListeners.delete(cb); }, () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {list.map((t) => (
          <motion.div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>{t.text}</motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------- layout helpers

export function Reveal({ children, className = "", delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: "div" | "section" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setIn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) { setIn(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setIn(true); io.disconnect(); } }, { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref} className={`reveal ${inView ? "in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>{children}</Tag>;
}

export function SectionHead({ n, title, children }: { n: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="section__head">
      <div><span className="label"><span className="index">{n}</span></span><h2 className="h2">{title}</h2></div>
      {children && <div className="lead" style={{ fontSize: "1rem" }}>{children}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field__head"><span className="field__label">{label}</span>{hint && <span className="field__hint">{hint}</span>}</div>
      {children}
    </div>
  );
}

export function Select({ value, options, onChange, label, code }: { value: string; options: (string | [string, string])[]; onChange: (v: string) => void; label: string; code?: string }) {
  return (
    <div className={`select ${code ? "select--code" : ""}`}>
      {code && <span className="select__code" aria-hidden="true">{code}</span>}
      <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => {
          const [v, l] = Array.isArray(o) ? o : [o, o];
          return <option key={v} value={v}>{l}</option>;
        })}
      </select>
    </div>
  );
}

export function Seg({ value, options, onChange, label, id, wrap }: { value: string; options: (string | [string, string])[]; onChange: (v: string) => void; label: string; id: string; wrap?: boolean }) {
  return (
    <div className={`seg ${wrap ? "seg--wrap" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const [v, l] = Array.isArray(o) ? o : [o, o];
        const on = v === value;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} className={on ? "on" : ""} onClick={() => onChange(v)}>
            {on && <motion.span layoutId={`seg-${id}`} className="seg__bg" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
            {l}
          </button>
        );
      })}
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange, id }: { value: T; options: [T, string][]; onChange: (v: T) => void; id: string }) {
  return (
    <div className="tabs" role="tablist">
      {options.map(([v, l]) => (
        <button key={v} role="tab" aria-selected={v === value} className={v === value ? "on" : ""} onClick={() => onChange(v)}>
          {l}
          {v === value && <motion.span layoutId={`tabs-${id}`} className="tabs__line" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
        </button>
      ))}
    </div>
  );
}

/** Every chart ships with a table twin for screen readers and exact values. */
export function TableToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="table-toggle">
      <button className="btn btn--ghost btn--sm" style={{ paddingLeft: 0 }} onClick={() => setOpen((o) => !o)} aria-expanded={open}>{open ? "Hide the table" : "Show as a table"}</button>
      {open && <div style={{ overflowX: "auto" }}>{children}</div>}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}
