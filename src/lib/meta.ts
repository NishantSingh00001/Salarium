// Static data published with the site: the model's features, market statistics and the model card.

import { useEffect, useState } from "react";
import type { FeatureSpec } from "../../shared/model";

export interface CountryInfo { name: string; code: string; currency: string; rate: number; n: number }
export interface Features { version: number; trained: string; features: FeatureSpec[]; countries: CountryInfo[] }

export interface Premium { name: string; pct: number; lo: number; hi: number; n: number; key?: string; group?: string }
export interface MarketCountry {
  name: string; code: string; currency: string; rate: number; n: number;
  p25: number; p50: number; p75: number; years_median: number; remote_share: number;
  curve: { label: string; n: number; median: number | null }[];
}
export interface Market { source: string; n: number; countries: MarketCountry[]; skills: Premium[]; roles: Premium[]; setups: Record<string, Premium[]>; note: string }

export interface ModelResult { mdape: number; mae_usd: number; r2_log: number; within_25: number; n: number }
export interface ModelCard {
  trained: string; source: string;
  funnel: { step: string; n: number }[];
  split: { train: number; calibration: number; test: number };
  features: { categorical: number; numeric: number; skills: number };
  params: Record<string, number>;
  results: Record<string, ModelResult>;
  range: { target: number; coverage_raw: number; coverage: number; adjust: number; median_ratio: number };
  below_point: number;
  per_country: { country: string; n: number; mdape: number; mdape_country_median: number; coverage: number }[];
  importance: { feature: string; label: string; mean_abs_shap: number }[];
  india: { country: string; n: number; mdape: number; mdape_country_median: number; coverage: number } | null;
}

const cache = new Map<string, Promise<unknown>>();

export function loadJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Couldn't load ${url}`);
      return r.json();
    }).catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url) as Promise<T>;
}

export function useJson<T>(url: string): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    loadJson<T>(url).then((data) => live && setState({ data, error: null })).catch((e) => live && setState({ data: null, error: (e as Error).message }));
    return () => { live = false; };
  }, [url]);
  return state;
}

export const useFeatures = () => useJson<Features>("/features.json");
export const useMarket = () => useJson<Market>("/market.json");
export const useModelCard = () => useJson<ModelCard>("/model-card.json");

export function valuesOf(f: Features | null, key: string): string[] {
  return f?.features.find((x) => x.key === key)?.values || [];
}
