// Money formatting. Estimates are in US dollars; each country is shown in its own currency using
// the exchange rate implied by the survey (what respondents typed ÷ the survey's USD conversion).

import type { CountryInfo } from "./meta";

export interface MoneyParts { prefix: string; number: string; suffix: string; text: string }

const SYMBOL_FIRST = new Set(["USD", "GBP", "INR", "EUR", "JPY", "CNY", "AUD", "CAD", "NZD", "SGD", "BRL", "MXN", "ZAR", "ILS", "PHP", "NGN", "TWD", "KES", "EGP"]);

function symbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0).find((p) => p.type === "currency");
    return part?.value || currency;
  } catch {
    return currency;
  }
}

function sig(v: number, digits = 3): string {
  if (v === 0) return "0";
  const d = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(v))));
  return v.toFixed(Math.min(2, d)).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

/** Compact amount in a currency: ₹17.4L / ₹1.2Cr for India, $172K / €58.2K / ¥9.1M elsewhere. */
export function moneyParts(amountLocal: number, currency: string): MoneyParts {
  const sym = symbol(currency);
  const prefix = SYMBOL_FIRST.has(currency) || sym.length === 1 ? sym : "";
  const after = prefix ? "" : ` ${sym}`;
  if (!amountLocal) return { prefix, number: "0", suffix: after, text: `${prefix}0${after}` };
  let number: string, suffix: string;
  if (currency === "INR") {
    if (amountLocal >= 1e7) { number = sig(amountLocal / 1e7); suffix = "Cr"; }
    else { number = sig(amountLocal / 1e5); suffix = "L"; }
  } else if (amountLocal >= 1e9) { number = sig(amountLocal / 1e9); suffix = "B"; }
  else if (amountLocal >= 1e6) { number = sig(amountLocal / 1e6); suffix = "M"; }
  else if (amountLocal >= 1e3) { number = sig(amountLocal / 1e3); suffix = "K"; }
  else { number = String(Math.round(amountLocal)); suffix = ""; }
  return { prefix, number, suffix: suffix + after, text: `${prefix}${number}${suffix}${after}` };
}

export function local(usd: number, c: Pick<CountryInfo, "currency" | "rate"> | null | undefined): MoneyParts {
  if (!c) return moneyParts(usd, "USD");
  return moneyParts(usd * c.rate, c.currency);
}

export const usdText = (usd: number) => `$${Math.round(usd).toLocaleString("en-US")}`;
export const usdCompact = (usd: number) => moneyParts(usd, "USD").text;

export const pctText = (p: number, digits = 0) => `${p > 0 ? "+" : p < 0 ? "−" : ""}${Math.abs(p * 100).toFixed(digits)}%`;

/** Period wording: Indian pay is usually quoted per year in lakhs (LPA). */
export function perYear(currency: string) {
  return currency === "INR" ? "per year (LPA)" : "per year";
}
