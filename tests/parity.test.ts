// Checks the TypeScript runtime against LightGBM itself: predictions from all three models and
// SHAP values from the point model, on 300 held-out test rows exported by python/train.py.
// Run: npm test
export {};
const { readFileSync } = await import("node:fs");
const { compile, predict, shap } = await import("../shared/model.ts");

const model = (await import("../netlify/model/model.js")).default;
const par = JSON.parse(readFileSync(new URL("./parity.json", import.meta.url), "utf8"));
const n = model.features.length;
const point = compile(model.point), lo = compile(model.lo), hi = compile(model.hi);

let worstPred = 0, worstShap = 0, worstSum = 0;
for (let i = 0; i < par.rows.length; i++) {
  const x = par.rows[i];
  worstPred = Math.max(worstPred, Math.abs(predict(point, x) - par.point[i]), Math.abs(predict(lo, x) - par.lo[i]), Math.abs(predict(hi, x) - par.hi[i]));
  const { phi, expected } = shap(point, x, n);
  const ref = par.shap[i];
  for (let j = 0; j < n; j++) worstShap = Math.max(worstShap, Math.abs(phi[j] - ref[j]));
  worstShap = Math.max(worstShap, Math.abs(expected - ref[n]));
  const total = expected + phi.reduce((a, b) => a + b, 0);
  worstSum = Math.max(worstSum, Math.abs(total - par.point[i]));
}

const TOL = 1e-6;
const checks: [string, boolean][] = [
  [`predictions match LightGBM on ${par.rows.length} rows (max diff ${worstPred.toExponential(2)})`, worstPred < TOL],
  [`SHAP values match LightGBM pred_contrib (max diff ${worstShap.toExponential(2)})`, worstShap < TOL],
  [`SHAP values add up to the prediction (max diff ${worstSum.toExponential(2)})`, worstSum < TOL],
];
let failed = 0;
for (const [msg, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
  if (!ok) failed++;
}
if (failed) process.exit(1);
console.log("Parity tests passed.");
