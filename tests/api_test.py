#!/usr/bin/env python3
"""End-to-end API checks against a local dev server (with the mock Gemini).

    python3 tests/mock_gemini.py &
    cp tests/e2e.env .env && netlify dev
    python3 tests/api_test.py
"""
import base64, json, sys, time, urllib.request

B = "http://localhost:8888"
FAILED = []

def ok(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        FAILED.append(msg)

def req(method, path, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(B + path, data=data, method=method, headers={"content-type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(r, timeout=60) as res:
            t = res.read()
            return res.status, json.loads(t) if t else None
    except urllib.error.HTTPError as e:
        t = e.read()
        try:
            return e.code, json.loads(t)
        except Exception:
            return e.code, t

P = {"country": "India", "yearsPro": 3, "yearsCode": 7, "role": "Back-end developer", "education": "Bachelor's degree",
     "orgSize": "1,000–4,999", "manager": "Individual contributor", "remote": "Hybrid, mostly office",
     "industry": "Software", "employment": "Employee", "skills": ["lang_java", "web_spring_boot", "plat_docker"]}

# ---- health & estimate
s, h = req("GET", "/api/health")
ok(s == 200 and h["ok"] and h["model"]["trees"] > 500 and h["ai"], f"health: model v{h['model']['version']}, {h['model']['trees']} trees, AI on")
t0 = time.time(); s, e = req("POST", "/api/estimate", {**P, "count": True}); ms = (time.time() - t0) * 1000
ok(s == 200 and e["usd"]["p10"] < e["usd"]["p50"] < e["usd"]["p90"], f"estimate India 3 yrs: ${e['usd']['p10']:,} – ${e['usd']['p50']:,} – ${e['usd']['p90']:,} ({ms:.0f} ms)")
ok(len(e["curve"]) == 31 and len(e["drivers"]) >= 10 and e["drivers"][0]["key"] == "country", "estimate has a 31-point curve and SHAP drivers (country first)")
ok(all(u["pct"] > 0 for u in e["uplifts"]) and len(e["roles"]) >= 10, f"skill what-ifs ({len(e['uplifts'])}) and role what-ifs ({len(e['roles'])})")
s, e2 = req("POST", "/api/estimate", {**P, "yearsPro": 10, "yearsCode": 14})
ok(e2["usd"]["p50"] > e["usd"]["p50"], "more experience → higher estimate")
s, r = req("POST", "/api/estimate", {**P, "country": "Atlantis"}); ok(s == 400 and "country" in r["error"], f"unknown country → {s}: {r.get('error')}")
s, r = req("POST", "/api/estimate", {**P, "yearsPro": 99}); ok(s == 400, f"99 years of experience → {s}")
s, r = req("POST", "/api/estimate", raw=b"{nope"); ok(s == 400 and "JSON" in r["error"], f"broken JSON → {s}")
s, r = req("GET", "/api/estimate"); ok(s == 405, f"GET /api/estimate → {s}")

# ---- reports
s, r = req("POST", "/api/reports", {"profile": P}); rid = (r or {}).get("id", "")
ok(s == 201 and len(rid) == 10, f"report saved: /r/{rid}")
s, g = req("GET", f"/api/reports/{rid}")
ok(s == 200 and g["profile"]["country"] == "India" and g["estimate"]["usd"]["p50"] == e["usd"]["p50"] and g["views"] == 1, "report loads with a fresh estimate and counts views")
s, g = req("GET", f"/api/reports/{rid}"); ok(g["views"] == 2, "second view counted")
s, r = req("GET", "/api/reports/zzzzzzzzzz"); ok(s == 410, f"missing report → {s}")
s, r = req("GET", "/api/reports/bad!"); ok(s == 400, f"malformed report id → {s}")

# ---- reality check
s, r = req("GET", "/api/reality"); ok(s == 200 and r["n"] == 0, "reality summary starts empty")
s, r = req("POST", "/api/reality", {"profile": P, "actualUsd": e["usd"]["p50"] * 1.1})
ok(s == 201 and r["position"] == "within" and abs(r["errorPct"] - 0.1) < 0.01, f"actual pay 10% above the estimate → within, error {r.get('errorPct')}")
s, r = req("POST", "/api/reality", {"profile": {**P, "yearsPro": 12}, "actualUsd": 3000})
ok(s == 201 and r["position"] == "below", "very low pay → below the range")
s, r = req("POST", "/api/reality", {"profile": P, "actualUsd": 500}); ok(s == 400, f"implausible pay rejected → {s}")
s, r = req("POST", "/api/reality", {"profile": P, "actualUsd": 20000})
s, r = req("POST", "/api/reality", {"profile": P, "actualUsd": 20000}); ok(s == 429, f"4th check from one visitor in a day → {s}")
s, r = req("GET", "/api/reality")
ok(r["n"] == 3 and abs(r["coverage"] - 2 / 3) < 1e-9 and len(r["points"]) == 3 and all(p["actual"] % 500 == 0 for p in r["points"]), f"live accuracy: n={r['n']}, coverage={r['coverage']:.2f}, pay rounded to $500")

# ---- offer check
s, o = req("POST", "/api/offer", {"profile": P, "manual": {"currency": "INR", "fixed": 1_400_000, "variable": 140_000}})
ok(s == 200 and not o["ai"] and o["annual"]["local"] == 1_540_000 and 10 <= o["percentile"] <= 90 and o["talkingPoints"], f"manual offer ₹15.4L → {o.get('position')}, ~{o.get('percentile')}th percentile")
s, o = req("POST", "/api/offer", {"profile": P, "text": "Dear Nishant, we are delighted to offer you Software Engineer I at Northwind Labs, fixed INR 11,40,000 …"})
ok(s == 200 and o["ai"] and o["components"]["fixed"] == 1140000 and o["annual"]["local"] == 1140000 + 114000 + 69000, f"AI offer read: like-for-like ₹{o['annual']['local']:,} (joining bonus excluded)")
ok(len(o["flags"]) >= 3 and o["email"].startswith("Hi"), "AI offer has flags, talking points and an email")
png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 100).decode()
s, o = req("POST", "/api/offer", {"profile": P, "file": {"mimeType": "image/png", "data": png}}); ok(s == 200 and o["ai"], "offer from an uploaded image")
s, o = req("POST", "/api/offer", {"profile": P, "manual": {"currency": "XYZ", "fixed": 10}}); ok(s == 422, f"unknown currency → {s}")
s, o = req("POST", "/api/offer", {"profile": P}); ok(s == 400, f"no offer given → {s}")
s, o = req("POST", "/api/offer", {"profile": P, "file": {"mimeType": "text/html", "data": "PGgxPg=="}}); ok(s == 400, f"HTML upload rejected → {s}")

s, h = req("GET", "/api/health")
ok(h["stats"]["estimates"] == 1 and h["stats"]["reports"] == 1 and h["stats"]["offers"] == 3, f"usage counters: {h['stats']['estimates']} estimate visit, {h['stats']['reports']} report, {h['stats']['offers']} offers")

print()
print(f"{len(FAILED)} failed" if FAILED else "All API checks passed.")
sys.exit(1 if FAILED else 0)
