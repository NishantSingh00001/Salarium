"""Clean the Stack Overflow Developer Survey 2025 into a modelling table.

    python python/download.py     # fetches the raw survey (141 MB) into python/data/raw/
    python python/prepare.py      # writes python/data/clean.csv.gz and python/out/funnel.json

Every step is recorded in a "funnel" so the model card can show exactly how many
responses were kept and why the rest were dropped.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import pycountry

HERE = Path(__file__).parent
RAW = HERE / "data" / "raw" / "results2025.csv"
OUT = HERE / "out"
CLEAN = HERE / "data" / "clean.csv.gz"

MIN_COUNTRY_ROWS = 30  # a country needs this many clean responses to get its own estimate
MIN_TECH_USERS = 250   # a technology needs this many users to become a feature

# ----------------------------------------------------------------------------- categories

ROLE_MAP = {
    "Developer, full-stack": "Full-stack developer",
    "Developer, back-end": "Back-end developer",
    "Developer, front-end": "Front-end developer",
    "Developer, mobile": "Mobile developer",
    "Developer, desktop or enterprise applications": "Desktop / enterprise developer",
    "Developer, embedded applications or devices": "Embedded developer",
    "Developer, game or graphics": "Game / graphics developer",
    "Developer, QA or test": "QA / test engineer",
    "Developer, AI apps or physical AI": "AI / ML engineer",
    "AI/ML engineer": "AI / ML engineer",
    "Applied scientist": "Data scientist",
    "Data scientist": "Data scientist",
    "Data engineer": "Data engineer",
    "DevOps engineer or professional": "DevOps / cloud engineer",
    "Cloud infrastructure engineer": "DevOps / cloud engineer",
    "System administrator": "DevOps / cloud engineer",
    "Architect, software or solutions": "Software architect",
    "Engineering manager": "Engineering manager",
    "Senior executive (C-suite, VP, etc.)": "Executive / founder",
    "Founder, technology or otherwise": "Executive / founder",
    "Cybersecurity or InfoSec professional": "Security engineer",
    "Database administrator or engineer": "Data engineer",
    "Academic researcher": "Researcher",
}

EDU_MAP = {
    "Primary/elementary school": "Secondary school or less",
    "Secondary school (e.g. American high school, German Realschule or Gymnasium, etc.)": "Secondary school or less",
    "Some college/university study without earning a degree": "Some college, no degree",
    "Associate degree (A.A., A.S., etc.)": "Associate degree",
    "Bachelor’s degree (B.A., B.S., B.Eng., etc.)": "Bachelor's degree",
    "Master’s degree (M.A., M.S., M.Eng., MBA, etc.)": "Master's degree",
    "Professional degree (JD, MD, Ph.D, Ed.D, etc.)": "PhD or professional degree",
    "Other (please specify):": "Other",
}

ORG_MAP = {
    "Just me - I am a freelancer, sole proprietor, etc.": "Just me",
    "Less than 20 employees": "1–19",
    "20 to 99 employees": "20–99",
    "100 to 499 employees": "100–499",
    "500 to 999 employees": "500–999",
    "1,000 to 4,999 employees": "1,000–4,999",
    "5,000 to 9,999 employees": "5,000–9,999",
    "10,000 or more employees": "10,000+",
    "I don’t know": "Not sure",
}

REMOTE_MAP = {
    "Remote": "Fully remote",
    "Hybrid (some remote, leans heavy to in-person)": "Hybrid, mostly office",
    "Hybrid (some in-person, leans heavy to flexibility)": "Hybrid, mostly remote",
    "In-person": "In the office",
    "Your choice (very flexible, you can come in when you want or just as needed)": "Fully flexible",
}

INDUSTRY_MAP = {
    "Software Development": "Software",
    "Fintech": "Fintech",
    "Banking/Financial Services": "Banking & finance",
    "Insurance": "Insurance",
    "Internet, Telecomm or Information Services": "Internet & telecom",
    "Computer Systems Design and Services": "IT services & consulting",
    "Healthcare": "Healthcare",
    "Manufacturing": "Manufacturing",
    "Retail and Consumer Services": "Retail & consumer",
    "Government": "Government",
    "Transportation, or Supply Chain": "Transport & logistics",
    "Media & Advertising Services": "Media & advertising",
    "Energy": "Energy",
    "Higher Education": "Education",
    "Other:": "Other",
}

# Short names for the UI; ISO codes give us flags.
COUNTRY_FIX = {
    "United States of America": ("United States", "US"),
    "United Kingdom of Great Britain and Northern Ireland": ("United Kingdom", "GB"),
    "Russian Federation": ("Russia", "RU"),
    "Iran, Islamic Republic of...": ("Iran", "IR"),
    "Republic of Korea": ("South Korea", "KR"),
    "Viet Nam": ("Vietnam", "VN"),
    "Czech Republic": ("Czechia", "CZ"),
    "Turkey": ("Türkiye", "TR"),
    "Taiwan": ("Taiwan", "TW"),
    "Hong Kong (S.A.R.)": ("Hong Kong", "HK"),
    "Netherlands": ("Netherlands", "NL"),
    "Venezuela, Bolivarian Republic of...": ("Venezuela", "VE"),
    "Bolivia": ("Bolivia", "BO"),
    "Republic of Moldova": ("Moldova", "MD"),
    "The former Yugoslav Republic of Macedonia": ("North Macedonia", "MK"),
    "United Republic of Tanzania": ("Tanzania", "TZ"),
    "Syrian Arab Republic": ("Syria", "SY"),
    "Lao People's Democratic Republic": ("Laos", "LA"),
    "Democratic Republic of the Congo": ("DR Congo", "CD"),
    "Congo, Republic of the...": ("Congo", "CG"),
    "Palestine": ("Palestine", "PS"),
    "Kosovo": ("Kosovo", "XK"),
}


def country_info(name: str) -> tuple[str, str]:
    if name in COUNTRY_FIX:
        return COUNTRY_FIX[name]
    try:
        c = pycountry.countries.lookup(name)
        return (getattr(c, "common_name", None) or c.name, c.alpha_2)
    except LookupError:
        try:
            c = pycountry.countries.search_fuzzy(name)[0]
            return (getattr(c, "common_name", None) or c.name, c.alpha_2)
        except LookupError:
            return (name, "")


def years(v) -> float:
    if pd.isna(v):
        return np.nan
    s = str(v)
    if s.startswith("Less than"):
        return 0.0
    if s.startswith("More than"):
        return 51.0
    try:
        return float(s)
    except ValueError:
        return np.nan


def tech_slug(name: str) -> str:
    s = name.lower().replace("c#", "csharp").replace("c++", "cpp").replace("f#", "fsharp").replace(".js", "js").replace(".net", "dotnet")
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_")


TECH_COLUMNS = {
    "LanguageHaveWorkedWith": "lang",
    "WebframeHaveWorkedWith": "web",
    "DatabaseHaveWorkedWith": "db",
    "PlatformHaveWorkedWith": "plat",
}

TECH_LABEL = {
    "Bash/Shell (all shells)": "Bash / Shell",
    "Amazon Web Services (AWS)": "AWS",
    "Microsoft Azure": "Azure",
    "Google Cloud": "Google Cloud",
    "Maven (build tool)": "Maven",
    "Dynamodb": "DynamoDB",
    "Visual Basic (.Net)": "Visual Basic",
    "Microsoft SQL Server": "SQL Server",
    "HTML/CSS": "HTML / CSS",
}

# Package managers and build tools say little about pay; keep the platforms that do.
PLATFORM_KEEP = {
    "Docker", "Amazon Web Services (AWS)", "Kubernetes", "Microsoft Azure", "Google Cloud", "Terraform",
    "Cloudflare", "Datadog", "Prometheus", "Ansible", "Firebase", "Digital Ocean", "Vercel", "Splunk",
    "Heroku", "Supabase", "New Relic", "Podman",
}


def main() -> None:
    df = pd.read_csv(RAW, low_memory=False)
    funnel = [{"step": "All survey responses", "n": int(len(df))}]

    def keep(mask, step):
        nonlocal df
        df = df[mask].copy()
        funnel.append({"step": step, "n": int(len(df))})

    keep(df.MainBranch.eq("I am a developer by profession"), "Developers by profession")
    keep(df.Employment.isin(["Employed", "Independent contractor, freelancer, or self-employed"]), "Employed or self-employed")
    keep(df.ConvertedCompYearly.notna(), "Reported their pay")
    df["years_pro"] = pd.to_numeric(df.WorkExp, errors="coerce")
    df["years_code"] = df.YearsCode.map(years)
    keep(df.years_pro.between(0, 50) & df.Country.notna(), "Gave years of experience (0–50)")
    keep(df.ConvertedCompYearly.between(1_000, 1_000_000), "Pay between $1k and $1M a year")

    # Outliers within each country (Tukey fences on log pay). People typing a monthly
    # figure into the yearly box are the main source of these.
    df["log_comp"] = np.log(df.ConvertedCompYearly)
    counts = df.Country.value_counts()
    big = df.Country.map(counts) >= 20
    grp = np.where(big, df.Country, "__small__")
    q1 = df.groupby(grp).log_comp.transform(lambda s: s.quantile(0.25))
    q3 = df.groupby(grp).log_comp.transform(lambda s: s.quantile(0.75))
    iqr = q3 - q1
    keep(df.log_comp.between(q1 - 1.5 * iqr, q3 + 1.5 * iqr), "Not an outlier for their country")

    counts = df.Country.value_counts()
    keep(df.Country.map(counts) >= MIN_COUNTRY_ROWS, f"Countries with {MIN_COUNTRY_ROWS}+ responses")

    # Features
    out = pd.DataFrame(index=df.index)
    info = {c: country_info(c) for c in df.Country.unique()}
    out["country"] = df.Country.map(lambda c: info[c][0])
    out["years_pro"] = df.years_pro.clip(0, 40)
    yc = df.years_code.fillna(df.years_pro + 4)
    out["years_code"] = np.maximum(yc, df.years_pro).clip(0, 50)
    out["role"] = df.DevType.map(ROLE_MAP).fillna("Other role")
    out["education"] = df.EdLevel.map(EDU_MAP).fillna("Other")
    out["org_size"] = df.OrgSize.map(ORG_MAP).fillna("Not sure")
    out["manager"] = df.ICorPM.map({"Individual contributor": "Individual contributor", "People manager": "People manager"}).fillna("Not sure")
    out["remote"] = df.RemoteWork.map(REMOTE_MAP).fillna("Not sure")
    out["industry"] = df.Industry.map(INDUSTRY_MAP).fillna("Other")
    out["employment"] = df.Employment.map({"Employed": "Employee", "Independent contractor, freelancer, or self-employed": "Self-employed"})

    techs = []
    tech_cols: dict[str, pd.Series] = {}
    for col, prefix in TECH_COLUMNS.items():
        items = df[col].fillna("").str.split(";")
        counts_t = items.explode().value_counts()
        for name, n in counts_t.items():
            if not name or n < MIN_TECH_USERS:
                continue
            if prefix == "plat" and name not in PLATFORM_KEEP:
                continue
            key = f"{prefix}_{tech_slug(name)}"
            tech_cols[key] = items.map(lambda xs, name=name: int(name in xs)).astype("int8")
            techs.append({"key": key, "name": TECH_LABEL.get(name, name), "group": prefix, "users": int(n)})

    out = pd.concat([out, pd.DataFrame(tech_cols, index=out.index)], axis=1)
    out["comp_usd"] = df.ConvertedCompYearly.astype(float)
    out["log_comp"] = df.log_comp
    out["currency"] = df.Currency.fillna("").str.split(r"\s|\t", regex=True).str[0]
    out["comp_local"] = df.CompTotal.astype(float)

    # Countries: short name, ISO code, the local currency most people used, and the
    # exchange rate implied by the survey's own conversion (CompTotal / ConvertedCompYearly).
    countries = []
    for name, g in out.groupby("country"):
        code = next((info[k][1] for k in info if info[k][0] == name), "")
        cur = g.currency[g.currency.ne("")].mode()
        cur = cur.iloc[0] if len(cur) else "USD"
        same = g[g.currency.eq(cur) & g.comp_local.gt(0)]
        rate = float(np.median(same.comp_local / same.comp_usd)) if len(same) >= 5 else 1.0
        if cur == "USD":
            rate = 1.0
        countries.append({
            "name": name, "code": code, "n": int(len(g)), "currency": cur, "rate": round(rate, 4),
            "median_usd": float(g.comp_usd.median()),
        })
    countries.sort(key=lambda c: -c["n"])

    CLEAN.parent.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    out.to_csv(CLEAN, index=False)
    (OUT / "prepare.json").write_text(json.dumps({"funnel": funnel, "countries": countries, "techs": techs}, indent=1, ensure_ascii=False))
    print(json.dumps(funnel, indent=1))
    print(len(countries), "countries,", len(techs), "technologies")
    print("missing ISO codes:", [c["name"] for c in countries if not c["code"]])
    print([(c["name"], c["currency"], c["rate"]) for c in countries[:12]])


if __name__ == "__main__":
    main()
