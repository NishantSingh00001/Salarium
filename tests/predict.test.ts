// Sanity checks for the estimate pipeline in shared/predict.ts. Run: npm test
export {};
const { load, estimate, validate, compare } = await import("../shared/predict.ts");
const model = (await import("../netlify/model/model.js")).default;

const rt = load(model);
let failed = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? "PASS" : "FAIL"} ${msg}`); if (!cond) failed++; };

const fresher = {
  country: "India", yearsPro: 0, yearsCode: 4, role: "Back-end developer", education: "Bachelor's degree",
  orgSize: "1,000–4,999", manager: "Individual contributor", remote: "In the office", industry: "IT services & consulting",
  employment: "Employee", skills: ["lang_java", "lang_python", "lang_sql", "web_spring_boot", "db_mysql"],
};
const senior = { ...fresher, yearsPro: 8, yearsCode: 12, role: "Software architect", skills: [...fresher.skills, "plat_amazon_web_services_aws", "plat_kubernetes", "plat_docker"] };
const us = { ...senior, country: "United States" };

ok(validate(rt, fresher).length === 0, "a valid profile passes validation");
ok(validate(rt, { ...fresher, country: "Atlantis", skills: ["lang_cobol_2099"] }).length === 2, "unknown country and skill are rejected");

const t0 = performance.now();
const a = estimate(rt, fresher);
const ms = performance.now() - t0;
const b = estimate(rt, senior);
const c = estimate(rt, us);
const inr = (usd: number) => `₹${(usd * 86.03 / 1e5).toFixed(1)}L`;
console.log(`  India fresher:   ${inr(a.usd.p10)} – ${inr(a.usd.p50)} – ${inr(a.usd.p90)}  (${ms.toFixed(0)} ms)`);
console.log(`  India 8 years:   ${inr(b.usd.p10)} – ${inr(b.usd.p50)} – ${inr(b.usd.p90)}`);
console.log(`  US 8 years:      $${c.usd.p10.toLocaleString()} – $${c.usd.p50.toLocaleString()} – $${c.usd.p90.toLocaleString()}`);
console.log(`  top drivers:     ${b.drivers.slice(0, 5).map((d) => `${d.label} ${d.pct > 0 ? "+" : ""}${Math.round(d.pct * 100)}%`).join(", ")}`);
console.log(`  skill ideas:     ${b.uplifts.slice(0, 4).map((u) => `${u.label} +${Math.round(u.pct * 100)}%`).join(", ")}`);

ok(a.usd.p10 < a.usd.p50 && a.usd.p50 < a.usd.p90, "the range is ordered (p10 < p50 < p90)");
ok(b.usd.p50 > a.usd.p50 * 1.5, "8 years of experience in India earns clearly more than a fresher");
ok(c.usd.p50 > b.usd.p50 * 2, "the same profile earns more in the US than in India");
const sum = Math.log(b.baselineUsd) + b.drivers.reduce((s, d) => s + d.phi, 0);
ok(Math.abs(sum - b.log.point) < 0.01, `drivers add up to the estimate (${sum.toFixed(3)} vs ${b.log.point.toFixed(3)})`);
ok(a.curve.every((p, i) => i === 0 || p.p50 >= a.curve[i - 1].p50), "the median rises (or stays) with every extra year");
ok(a.curve.every((p) => p.p10 <= p.p50 && p.p50 <= p.p90), "every point on the curve keeps p10 ≤ p50 ≤ p90");
ok(ms < 200, `an estimate takes ${ms.toFixed(0)} ms`);
ok(compare(b, b.usd.p50).position === "within" && compare(b, b.usd.p10 / 2).position === "below", "compare() places actual pay against the range");

if (failed) process.exit(1);
console.log("Estimate tests passed.");
