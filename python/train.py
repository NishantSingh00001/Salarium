"""Train, evaluate and export Salarium's salary models.

    python python/train.py

Reads python/data/clean.csv.gz (from prepare.py) and writes:
  netlify/model/model.js     trees for the point estimate and the 80% range (used by the API)
  public/features.json       the feature list and vocabularies, for the web app's form
  public/model-card.json     metrics, baselines, calibration, feature importance, data funnel
  public/market.json         per-country pay, experience curves and skill/role premiums
  tests/parity.json          inputs with LightGBM's own predictions and SHAP values, so the
                             TypeScript runtime can be checked against Python

Models (all predict log pay in USD):
  1. Global median               (baseline)
  2. Country median              (baseline)
  3. Ridge regression            (one-hot categories + skills + experience splines)
  4. LightGBM                    (native categorical splits, monotone in experience)
  5. LightGBM quantile 10% / 90% + conformal calibration → an 80% range that really covers 80%
"""
from __future__ import annotations

import json
import math
import time
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.linear_model import Ridge
from sklearn.model_selection import KFold, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, SplineTransformer

HERE = Path(__file__).parent
ROOT = HERE.parent
SEED = 42
ALPHA = 0.2  # 80% range

CAT = ["country", "role", "education", "org_size", "manager", "remote", "industry", "employment"]
NUM = ["years_pro", "years_code"]
LABELS = {
    "country": "Country", "role": "Role", "education": "Education", "org_size": "Company size",
    "manager": "IC or manager", "remote": "Work setup", "industry": "Industry", "employment": "Employment",
    "years_pro": "Years of experience", "years_code": "Years coding",
}
ORDER = {
    "org_size": ["Just me", "1–19", "20–99", "100–499", "500–999", "1,000–4,999", "5,000–9,999", "10,000+", "Not sure"],
    "education": ["Secondary school or less", "Some college, no degree", "Associate degree", "Bachelor's degree", "Master's degree", "PhD or professional degree", "Other"],
}


def mdape(y_true_log, y_pred_log):
    return float(np.median(np.abs(np.exp(y_pred_log - y_true_log) - 1)))


def metrics(y_log, p_log):
    y, p = np.exp(y_log), np.exp(p_log)
    ss_res = float(np.sum((y_log - p_log) ** 2))
    ss_tot = float(np.sum((y_log - y_log.mean()) ** 2))
    return {
        "mdape": round(mdape(y_log, p_log), 4),
        "mae_usd": round(float(np.mean(np.abs(y - p))), 0),
        "r2_log": round(1 - ss_res / ss_tot, 4),
        "within_25": round(float(np.mean(np.abs(p / y - 1) <= 0.25)), 4),
        "n": int(len(y)),
    }


def main() -> None:
    t0 = time.time()
    prep = json.loads((HERE / "out" / "prepare.json").read_text())
    df = pd.read_csv(HERE / "data" / "clean.csv.gz")
    techs = [t for t in prep["techs"] if t["key"] != "plat_supabase"]
    BIN = [t["key"] for t in techs]
    FEATURES = CAT + NUM + BIN

    # Category vocabularies (most common first, or a natural order), encoded as ints for LightGBM.
    vocab = {}
    codes = {}
    for c in CAT:
        cats = ORDER.get(c) or list(df[c].value_counts().index)
        cats = [x for x in cats if x in set(df[c])]
        vocab[c] = cats
        codes[c + "__code"] = df[c].map({v: i for i, v in enumerate(cats)}).astype("int64")
    df = pd.concat([df, pd.DataFrame(codes, index=df.index)], axis=1)

    X = pd.DataFrame({**{c: df[c + "__code"] for c in CAT}, **{c: df[c].astype(float) for c in NUM}, **{c: df[c].astype(float) for c in BIN}})
    y = df.log_comp.values

    idx = np.arange(len(df))
    tr_idx, rest = train_test_split(idx, test_size=0.3, random_state=SEED, stratify=df.country)
    cal_idx, te_idx = train_test_split(rest, test_size=0.5, random_state=SEED, stratify=df.country.iloc[rest])
    Xtr, Xcal, Xte = X.iloc[tr_idx], X.iloc[cal_idx], X.iloc[te_idx]
    ytr, ycal, yte = y[tr_idx], y[cal_idx], y[te_idx]
    print(f"train {len(tr_idx)} · calibration {len(cal_idx)} · test {len(te_idx)}")

    results = {}
    # 1. global median
    results["Global median"] = metrics(yte, np.full_like(yte, np.median(ytr)))
    # 2. country median
    cm = pd.Series(ytr).groupby(df.country.iloc[tr_idx].values).median()
    p_cm = df.country.iloc[te_idx].map(cm).fillna(np.median(ytr)).values
    results["Country median"] = metrics(yte, p_cm)
    # 3. ridge
    ridge = make_pipeline(
        ColumnTransformer([
            ("cat", OneHotEncoder(handle_unknown="ignore"), CAT),
            ("num", SplineTransformer(n_knots=6, degree=3), NUM),
            ("bin", "passthrough", BIN),
        ]),
        Ridge(alpha=3.0),
    )
    raw = df[CAT + NUM + BIN]
    ridge.fit(raw.iloc[tr_idx], ytr)
    p_ridge = ridge.predict(raw.iloc[te_idx])
    results["Ridge regression"] = metrics(yte, p_ridge)

    # 4. LightGBM: pick settings by 5-fold CV on the training set only.
    mono = [1 if f in NUM else 0 for f in FEATURES]
    base = dict(
        objective="regression", learning_rate=0.03, feature_fraction=0.8, bagging_fraction=0.8, bagging_freq=1,
        lambda_l2=1.0, cat_smooth=10, cat_l2=10, min_data_per_group=20, max_cat_threshold=32,
        monotone_constraints=mono, monotone_constraints_method="advanced", verbose=-1, seed=SEED, num_threads=4,
    )
    grid = [
        {"num_leaves": 15, "min_data_in_leaf": 30},
        {"num_leaves": 31, "min_data_in_leaf": 30},
        {"num_leaves": 31, "min_data_in_leaf": 60},
        {"num_leaves": 63, "min_data_in_leaf": 60},
    ]
    dtrain = lgb.Dataset(Xtr, ytr, categorical_feature=CAT, free_raw_data=False)
    best = None
    for g in grid:
        cv = lgb.cv({**base, **g}, dtrain, num_boost_round=3000, nfold=5, stratified=False, seed=SEED,
                    callbacks=[lgb.early_stopping(100, verbose=False)])
        key = next(k for k in cv if k.endswith("l2-mean"))
        rounds, score = len(cv[key]), cv[key][-1]
        print(f"  cv {g} → rmse {math.sqrt(score):.4f} @ {rounds}")
        if best is None or score < best[1] * 0.998:  # prefer the simpler model unless clearly better
            best = ({**base, **g}, score, rounds)
    params, _, rounds = best
    point = lgb.train(params, dtrain, num_boost_round=rounds)
    p_lgb = point.predict(Xte)
    results["LightGBM"] = metrics(yte, p_lgb)

    # 5. Quantile models + conformalized quantile regression (Romano et al., 2019).
    # (LightGBM doesn't allow monotone constraints with the quantile loss.)
    qparams = {k: v for k, v in params.items() if k not in ("objective", "monotone_constraints", "monotone_constraints_method")}

    def quantile_model(alpha: float) -> lgb.Booster:
        qp = {**qparams, "objective": "quantile", "alpha": alpha, "metric": "quantile"}
        cvq = lgb.cv(qp, dtrain, num_boost_round=3000, nfold=5, stratified=False, seed=SEED, callbacks=[lgb.early_stopping(100, verbose=False)])
        r = len(cvq[next(k for k in cvq if k.endswith("-mean"))])
        print(f"  quantile {alpha:.2f}: {r} rounds")
        return lgb.train(qp, dtrain, num_boost_round=r)

    lo = quantile_model(ALPHA / 2)
    hi = quantile_model(1 - ALPHA / 2)
    s = np.maximum(lo.predict(Xcal) - ycal, ycal - hi.predict(Xcal))
    n = len(s)
    q_adj = float(np.quantile(s, min(1.0, math.ceil((n + 1) * (1 - ALPHA)) / n)))

    def interval(Xs):
        a, b = lo.predict(Xs) - q_adj, hi.predict(Xs) + q_adj
        p = point.predict(Xs)
        return np.minimum(a, p), np.maximum(b, p)

    a_raw, b_raw = lo.predict(Xte), hi.predict(Xte)
    a, b = interval(Xte)
    coverage_raw = float(np.mean((yte >= a_raw) & (yte <= b_raw)))
    coverage = float(np.mean((yte >= a) & (yte <= b)))
    width = float(np.median(np.exp(b - a)))
    print(f"range: raw coverage {coverage_raw:.3f} → conformal {coverage:.3f} (adjust {q_adj:+.3f}), median hi/lo ratio {width:.2f}")

    for name, r in results.items():
        print(f"  {name:<18} MdAPE {r['mdape']:.3f}  R² {r['r2_log']:.3f}  MAE ${r['mae_usd']:,.0f}  ±25% {r['within_25']:.3f}")

    # Per-country accuracy and coverage on the test set.
    te_c = df.country.iloc[te_idx].values
    per_country = []
    for c in vocab["country"]:
        m = te_c == c
        if m.sum() < 8:
            continue
        per_country.append({
            "country": c, "n": int(m.sum()),
            "mdape": round(mdape(yte[m], p_lgb[m]), 4),
            "mdape_country_median": round(mdape(yte[m], p_cm[m]), 4),
            "coverage": round(float(np.mean((yte[m] >= a[m]) & (yte[m] <= b[m]))), 4),
        })

    # Feature importance: mean |SHAP| on the test set (log scale), skills also summed as a group.
    contrib = point.predict(Xte, pred_contrib=True)
    mean_abs = np.abs(contrib[:, :-1]).mean(axis=0)
    imp = [{"feature": f, "label": LABELS.get(f, next((t["name"] for t in techs if t["key"] == f), f)), "mean_abs_shap": float(v)}
           for f, v in zip(FEATURES, mean_abs)]
    skills_total = float(np.abs(contrib[:, len(CAT) + len(NUM):-1].sum(axis=1)).mean())
    imp.sort(key=lambda d: -d["mean_abs_shap"])

    # Calibration curve: share of test points below each predicted quantile of the range.
    # Residual reliability: how often the truth is below the point estimate (ideal ≈ 50%).
    below_point = float(np.mean(yte < p_lgb))

    # ------------------------------------------------------------------ export trees
    def export(booster: lgb.Booster):
        dump = booster.dump_model()
        trees = []
        for t in dump["tree_info"]:
            nodes = {"f": [], "t": [], "k": [], "l": [], "r": [], "c": []}
            leaves = {"v": [], "c": []}
            cats: list[list[int]] = []

            def walk(n) -> int:
                if "leaf_index" in n or "leaf_value" in n and "split_index" not in n:
                    leaves["v"].append(round(float(n["leaf_value"]), 9))
                    leaves["c"].append(int(n.get("leaf_count", 0)))
                    return ~(len(leaves["v"]) - 1)
                i = len(nodes["f"])
                for k in nodes:
                    nodes[k].append(None)
                assert n["missing_type"] in ("None", "NaN"), n["missing_type"]
                nodes["f"][i] = int(n["split_feature"])
                if n["decision_type"] == "==":
                    cats.append([int(x) for x in str(n["threshold"]).split("||")])
                    nodes["t"][i] = len(cats) - 1
                    nodes["k"][i] = 1
                else:
                    assert n["decision_type"] == "<=", n["decision_type"]
                    nodes["t"][i] = float(n["threshold"])
                    nodes["k"][i] = 0
                nodes["c"][i] = int(n["internal_count"])
                nodes["l"][i] = walk(n["left_child"])
                nodes["r"][i] = walk(n["right_child"])
                return i

            root = walk(t["tree_structure"])
            trees.append({"root": root, **nodes, "v": leaves["v"], "lc": leaves["c"], "cats": cats})
        return trees

    features_spec = []
    for f in FEATURES:
        if f in CAT:
            features_spec.append({"key": f, "kind": "cat", "label": LABELS[f], "values": vocab[f]})
        elif f in NUM:
            features_spec.append({"key": f, "kind": "num", "label": LABELS[f], "min": 0, "max": 40 if f == "years_pro" else 50})
        else:
            t = next(t for t in techs if t["key"] == f)
            features_spec.append({"key": f, "kind": "bin", "label": t["name"], "group": t["group"]})

    trained = time.strftime("%Y-%m-%d")
    model = {
        "name": "salarium", "version": 1, "trained": trained, "target": "log(annual pay, USD)",
        "features": features_spec, "conformal": q_adj, "alpha": ALPHA,
        "point": export(point), "lo": export(lo), "hi": export(hi),
    }
    (ROOT / "netlify" / "model").mkdir(parents=True, exist_ok=True)
    # An ES module, so the function bundler inlines it and TypeScript reads its types from model.d.ts.
    (ROOT / "netlify" / "model" / "model.js").write_text(
        "// Generated by python/train.py. Do not edit.\nexport default " + json.dumps(model, separators=(",", ":")) + ";\n")

    # The web app only needs the feature list (for the form), not the trees.
    (ROOT / "public").mkdir(exist_ok=True)
    web_countries = [{"name": c["name"], "code": c["code"], "currency": c["currency"], "rate": c["rate"], "n": c["n"]} for c in prep["countries"] if c["name"] in vocab["country"]]
    (ROOT / "public" / "features.json").write_text(json.dumps({"version": model["version"], "trained": trained, "features": features_spec, "countries": web_countries}, separators=(",", ":"), ensure_ascii=False))

    # Parity vectors: 300 test rows with LightGBM's predictions and SHAP values.
    rng = np.random.default_rng(SEED)
    pick = rng.choice(len(te_idx), size=300, replace=False)
    Xp = Xte.iloc[pick]
    par = {
        "rows": Xp.values.tolist(),
        "point": point.predict(Xp).tolist(),
        "lo": lo.predict(Xp).tolist(),
        "hi": hi.predict(Xp).tolist(),
        "shap": point.predict(Xp, pred_contrib=True).tolist(),
    }
    (ROOT / "tests").mkdir(exist_ok=True)
    (ROOT / "tests" / "parity.json").write_text(json.dumps(par, separators=(",", ":")))

    # ------------------------------------------------------------------ market analysis
    countries = {c["name"]: c for c in prep["countries"]}
    # Premiums controlling for country and experience: residuals from a country + experience model.
    ctrl = make_pipeline(
        ColumnTransformer([("c", OneHotEncoder(handle_unknown="ignore"), ["country"]), ("y", SplineTransformer(n_knots=6, degree=3), ["years_pro"])]),
        Ridge(alpha=1.0),
    )
    ctrl.fit(df[["country", "years_pro"]], y)
    resid = y - ctrl.predict(df[["country", "years_pro"]])

    def premium(mask):
        a_, b_ = resid[mask], resid[~mask]
        if len(a_) < 30:
            return None
        d = a_.mean() - b_.mean()
        se = math.sqrt(a_.var(ddof=1) / len(a_) + b_.var(ddof=1) / len(b_))
        return {"pct": round(math.exp(d) - 1, 4), "lo": round(math.exp(d - 1.96 * se) - 1, 4), "hi": round(math.exp(d + 1.96 * se) - 1, 4), "n": int(len(a_))}

    skills = []
    for t in techs:
        p = premium(df[t["key"]].values == 1)
        if p:
            skills.append({"key": t["key"], "name": t["name"], "group": t["group"], **p})
    skills.sort(key=lambda d: -d["pct"])
    roles = []
    for r in vocab["role"]:
        p = premium(df.role.values == r)
        if p:
            roles.append({"name": r, **p})
    roles.sort(key=lambda d: -d["pct"])
    setups = {}
    for col in ["remote", "org_size", "education", "industry", "manager"]:
        setups[col] = [{"name": v, **p} for v in vocab[col] if v not in ("Not sure", "Other") and (p := premium(df[col].values == v))]

    bins = [(0, 2, "0–2"), (3, 5, "3–5"), (6, 10, "6–10"), (11, 15, "11–15"), (16, 20, "16–20"), (21, 40, "21+")]
    market_countries = []
    for c in vocab["country"]:
        g = df[df.country == c]
        curve = []
        for lo_, hi_, label in bins:
            gg = g[(g.years_pro >= lo_) & (g.years_pro <= hi_)]
            curve.append({"label": label, "n": int(len(gg)), "median": float(gg.comp_usd.median()) if len(gg) >= 8 else None})
        info = countries[c]
        market_countries.append({
            "name": c, "code": info["code"], "currency": info["currency"], "rate": info["rate"], "n": int(len(g)),
            "p25": float(g.comp_usd.quantile(0.25)), "p50": float(g.comp_usd.median()), "p75": float(g.comp_usd.quantile(0.75)),
            "years_median": float(g.years_pro.median()), "curve": curve,
            "remote_share": round(float((g.remote == "Fully remote").mean()), 3),
        })
    market_countries.sort(key=lambda d: -d["p50"])

    market = {
        "source": "Stack Overflow Developer Survey 2025", "n": int(len(df)), "countries": market_countries,
        "skills": skills, "roles": roles, "setups": setups,
        "note": "Premiums compare people who use a technology (or have a role or setup) with those who don't, in the same country and with the same experience. They are associations, not guarantees.",
    }
    (ROOT / "public").mkdir(exist_ok=True)
    (ROOT / "public" / "market.json").write_text(json.dumps(market, separators=(",", ":"), ensure_ascii=False))

    card = {
        "trained": trained, "source": "Stack Overflow Developer Survey 2025 (ODbL)", "funnel": prep["funnel"],
        "split": {"train": int(len(tr_idx)), "calibration": int(len(cal_idx)), "test": int(len(te_idx))},
        "features": {"categorical": len(CAT), "numeric": len(NUM), "skills": len(BIN)},
        "params": {k: params[k] for k in ("num_leaves", "min_data_in_leaf", "learning_rate", "feature_fraction", "bagging_fraction", "lambda_l2")} | {"rounds": rounds},
        "results": results,
        "range": {"target": 1 - ALPHA, "coverage_raw": round(coverage_raw, 4), "coverage": round(coverage, 4), "adjust": round(q_adj, 4), "median_ratio": round(width, 3)},
        "below_point": round(below_point, 4),
        "per_country": sorted(per_country, key=lambda d: -d["n"]),
        "importance": imp[:25], "skills_group_mean_abs_shap": skills_total,
        "india": next((d for d in per_country if d["country"] == "India"), None),
    }
    (ROOT / "public" / "model-card.json").write_text(json.dumps(card, indent=1, ensure_ascii=False))
    size = (ROOT / "netlify" / "model" / "model.js").stat().st_size
    print(f"model.js {size/1e6:.2f} MB · trees {len(model['point'])}/{len(model['lo'])}/{len(model['hi'])} · {time.time()-t0:.0f}s")
    print("india:", card["india"])
    print("top features:", [(d["label"], round(d["mean_abs_shap"], 3)) for d in imp[:12]])
    print("top skills:", [(s_["name"], s_["pct"]) for s_ in skills[:8]], "…", [(s_["name"], s_["pct"]) for s_ in skills[-5:]])


if __name__ == "__main__":
    main()
