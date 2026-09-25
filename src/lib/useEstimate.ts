// Fetches an estimate whenever the profile changes (debounced). While a new one loads, the
// previous result stays on screen, so nothing jumps.

import { useEffect, useRef, useState } from "react";
import type { Estimate, Profile } from "../../shared/predict";
import { api } from "./api";

let counted = false;

export function useEstimate(profile: Profile | null, delay = 220) {
  const [data, setData] = useState<Estimate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const key = profile ? JSON.stringify(profile) : "";

  useEffect(() => {
    if (!profile) return;
    setLoading(true);
    const t = setTimeout(() => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      const count = !counted;
      counted = true;
      api<Estimate>("/api/estimate", { body: { ...profile, count }, signal: c.signal })
        .then((e) => { setData(e); setError(null); setLoading(false); })
        .catch((e) => { if ((e as Error).name !== "AbortError") { setError((e as Error).message); setLoading(false); } });
    }, data ? delay : 0);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error };
}
