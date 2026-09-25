// A small runtime for the LightGBM models exported by python/train.py:
// tree evaluation (numeric and categorical splits) and exact TreeSHAP explanations.
// It has no dependencies, so it runs the same in Node (Netlify Functions) and in tests.

export interface Tree {
  root: number;
  f: number[]; // split feature per internal node
  t: number[]; // threshold (numeric) or index into `cats` (categorical)
  k: number[]; // 0 = numeric "x <= t goes left", 1 = categorical "x in set goes left"
  l: number[]; // child: >= 0 internal node index, < 0 leaf (~index)
  r: number[];
  c: number[]; // training rows reaching each internal node (for SHAP)
  v: number[]; // leaf values
  lc: number[]; // training rows reaching each leaf
  cats: number[][];
}

export interface FeatureSpec {
  key: string;
  kind: "cat" | "num" | "bin";
  label: string;
  values?: string[];
  min?: number;
  max?: number;
  group?: string;
}

export interface ModelFile {
  name: string;
  version: number;
  trained: string;
  target: string;
  features: FeatureSpec[];
  conformal: number;
  alpha: number;
  point: Tree[];
  lo: Tree[];
  hi: Tree[];
}

interface Compiled extends Tree {
  sets: (Set<number> | null)[];
}

export interface Ensemble {
  trees: Compiled[];
  expected: number;
  depth: number;
}

function compileTree(t: Tree): Compiled {
  return { ...t, sets: t.k.map((kind, i) => (kind === 1 ? new Set(t.cats[t.t[i]]) : null)) };
}

function goesLeft(t: Compiled, node: number, x: ArrayLike<number>): boolean {
  const v = x[t.f[node]];
  return t.k[node] === 1 ? t.sets[node]!.has(v) : v <= t.t[node];
}

function treeDepth(t: Tree, node = t.root): number {
  if (node < 0) return 0;
  return 1 + Math.max(treeDepth(t, t.l[node]), treeDepth(t, t.r[node]));
}

export function compile(trees: Tree[]): Ensemble {
  const compiled = trees.map(compileTree);
  let expected = 0;
  for (const t of compiled) {
    if (t.root < 0) { expected += t.v[~t.root]; continue; }
    const total = t.c[t.root];
    for (let j = 0; j < t.v.length; j++) expected += (t.lc[j] / total) * t.v[j];
  }
  return { trees: compiled, expected, depth: Math.max(0, ...trees.map((t) => treeDepth(t))) };
}

export function predict(e: Ensemble, x: ArrayLike<number>): number {
  let sum = 0;
  for (const t of e.trees) {
    let n = t.root;
    while (n >= 0) n = goesLeft(t, n, x) ? t.l[n] : t.r[n];
    sum += t.v[~n];
  }
  return sum;
}

// ---------------------------------------------------------------- TreeSHAP
// Algorithm 2 of Lundberg, Erion & Lee (2018), "Consistent Individualized Feature
// Attribution for Tree Ensembles". It gives exact Shapley values in O(T·L·D²), and the
// values add up: expected + Σ phi = prediction.

interface Path { d: number[]; z: number[]; o: number[]; w: number[] }

function extendPath(p: Path, depth: number, zero: number, one: number, feature: number): void {
  p.d[depth] = feature;
  p.z[depth] = zero;
  p.o[depth] = one;
  p.w[depth] = depth === 0 ? 1 : 0;
  for (let i = depth - 1; i >= 0; i--) {
    p.w[i + 1] += (one * p.w[i] * (i + 1)) / (depth + 1);
    p.w[i] = (zero * p.w[i] * (depth - i)) / (depth + 1);
  }
}

function unwindPath(p: Path, depth: number, index: number): void {
  const one = p.o[index];
  const zero = p.z[index];
  let next = p.w[depth];
  for (let i = depth - 1; i >= 0; i--) {
    if (one !== 0) {
      const tmp = p.w[i];
      p.w[i] = (next * (depth + 1)) / ((i + 1) * one);
      next = tmp - (p.w[i] * zero * (depth - i)) / (depth + 1);
    } else {
      p.w[i] = (p.w[i] * (depth + 1)) / (zero * (depth - i));
    }
  }
  for (let i = index; i < depth; i++) {
    p.d[i] = p.d[i + 1];
    p.z[i] = p.z[i + 1];
    p.o[i] = p.o[i + 1];
  }
}

function unwoundSum(p: Path, depth: number, index: number): number {
  const one = p.o[index];
  const zero = p.z[index];
  let next = p.w[depth];
  let total = 0;
  for (let i = depth - 1; i >= 0; i--) {
    if (one !== 0) {
      const tmp = (next * (depth + 1)) / ((i + 1) * one);
      total += tmp;
      next = p.w[i] - tmp * zero * ((depth - i) / (depth + 1));
    } else {
      total += p.w[i] / zero / ((depth - i) / (depth + 1));
    }
  }
  return total;
}

function copyPath(p: Path, n: number): Path {
  return { d: p.d.slice(0, n), z: p.z.slice(0, n), o: p.o.slice(0, n), w: p.w.slice(0, n) };
}

function cover(t: Compiled, node: number): number {
  return node < 0 ? t.lc[~node] : t.c[node];
}

function recurse(t: Compiled, x: ArrayLike<number>, phi: Float64Array, node: number, parent: Path, depth: number, zero: number, one: number, feature: number): void {
  const p = copyPath(parent, depth);
  extendPath(p, depth, zero, one, feature);
  if (node < 0) {
    const value = t.v[~node];
    for (let i = 1; i <= depth; i++) {
      const w = unwoundSum(p, depth, i);
      phi[p.d[i]] += w * (p.o[i] - p.z[i]) * value;
    }
    return;
  }
  const split = t.f[node];
  const hot = goesLeft(t, node, x) ? t.l[node] : t.r[node];
  const cold = hot === t.l[node] ? t.r[node] : t.l[node];
  const w = cover(t, node);
  let inZero = 1;
  let inOne = 1;
  let k = 0;
  while (k <= depth && p.d[k] !== split) k++;
  if (k <= depth) {
    inZero = p.z[k];
    inOne = p.o[k];
    unwindPath(p, depth, k);
    depth -= 1;
  }
  recurse(t, x, phi, hot, p, depth + 1, (cover(t, hot) / w) * inZero, inOne, split);
  recurse(t, x, phi, cold, p, depth + 1, (cover(t, cold) / w) * inZero, 0, split);
}

/** SHAP values for one input: phi[i] per feature, plus the model's expected value. */
export function shap(e: Ensemble, x: ArrayLike<number>, nFeatures: number): { phi: Float64Array; expected: number } {
  const phi = new Float64Array(nFeatures);
  const empty: Path = { d: [], z: [], o: [], w: [] };
  for (const t of e.trees) {
    if (t.root < 0) continue;
    recurse(t, x, phi, t.root, empty, 0, 1, 1, -1);
  }
  return { phi, expected: e.expected };
}
